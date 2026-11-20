# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Mode runners for cascade, binder, RPC predicates, and Express/Direct baselines."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import os
import time
from typing import Any

from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import (
    DirectJsonFormat,
    ExpressFormat,
    to_message_dicts,
)
from a2ui.inference_formats.experimental.decision import (
    ActionSpec,
    DecisionBackend,
    DecisionBackendError,
    create_decision_backend,
)
from a2ui.inference_formats.experimental.decision_binder import ToolPointerBinder
from a2ui.inference_formats.experimental.decision_cascade import (
    CascadeTier,
    DecisionCascadeRouter,
)
from a2ui.inference_formats.express import ExpressCompiler, ExpressDecompiler
from a2ui.rpc import RendererToAgentMessageProcessor
from a2ui.rpc.experimental.decision import (
    SessionRateLimiter,
    build_predicate_agent_functions,
)
from modes import LlmCaller, RenderMode, RenderOutcome
from recording_backend import (
    PlaygroundMockBackend,
    RecordedBatchCall,
    RecordingDecisionBackend,
)
from surfaces import (
    EXPRESS_TEMPLATES,
    RPC_PREDICATE_CATALOG_ID,
    RPC_PREDICATE_SPECS,
    build_status_card_messages,
)


def _create_playground_backend(kind: str) -> DecisionBackend:
    """Creates a backend for `kind`, using `PlaygroundMockBackend` for `'mock'`."""
    normalized = kind.strip().lower()
    if normalized == "mock":
        return PlaygroundMockBackend()
    if normalized == "step0" and not os.environ.get("A2UI_DECISION_URL"):
        raise ValueError(
            "Backend 'step0' requires A2UI_DECISION_URL (for example,"
            " http://localhost:8000/v1/completions)."
        )
    return create_decision_backend(normalized)


def _decompile_express(catalogs: Sequence[CatalogApi], messages: Sequence[Any]) -> str:
    """Best-effort Express decompilation for the inspector's Stage 4 toggle."""
    try:
        return ExpressDecompiler(list(catalogs)).decompile(list(messages))
    except Exception:
        return ""


def _classify_rpc_reply(
    dumped: Mapping[str, Any],
) -> tuple[bool, str | None]:
    """Returns `(passed, fallback_reason)` for one dumped RPC reply."""
    body = dumped.get("agentFunctionResponse")
    if not isinstance(body, Mapping):
        return True, None
    if "error" in body:
        err = body["error"]
        code = err.get("code") if isinstance(err, Mapping) else None
        return False, str(code) if code else "rpc_error"
    if body.get("value") is False:
        return False, "predicate_false"
    return True, None


class PlaygroundRenderers:
    """Owns the active `DecisionBackend`, rate limiter, and per-mode runners."""

    def __init__(
        self,
        *,
        backend: DecisionBackend | None = None,
        backend_kind: str = "mock",
        llm: LlmCaller | None = None,
        rate_limiter: SessionRateLimiter | None = None,
    ) -> None:
        self._catalog = BasicCatalog("v1.0")
        self._backend: DecisionBackend = (
            backend if backend is not None else _create_playground_backend(backend_kind)
        )
        self._llm = llm
        self._rate_limiter = (
            rate_limiter
            if rate_limiter is not None
            else SessionRateLimiter(max_calls=10, window_seconds=60.0)
        )

    @property
    def backend_kind(self) -> str:
        return self._backend.backend_kind

    @property
    def model_id(self) -> str:
        return self._backend.model_id

    @property
    def endpoint_url(self) -> str | None:
        return getattr(self._backend, "endpoint_url", None)

    async def set_backend(self, kind: str) -> None:
        """Switches to `kind`, keeping the prior backend intact if creation fails."""
        new_backend = _create_playground_backend(kind)
        old_backend = self._backend
        self._backend = new_backend
        await old_backend.aclose()

    async def aclose(self) -> None:
        await self._backend.aclose()

    def _recorder(self) -> RecordingDecisionBackend:
        return RecordingDecisionBackend(self._backend)

    async def run_cascade(
        self,
        prompt: str,
        *,
        surface_id: str,
        budget_ms: float | None = None,
        session_id: str | None = None,
        data_payload: Mapping[str, Any] | None = None,
    ) -> tuple[RenderOutcome, list[RecordedBatchCall]]:
        """Executes Track 2A (`DecisionCascadeRouter`) plus downstream synthesis."""
        start = time.perf_counter()
        rec = self._recorder()
        router = DecisionCascadeRouter(rec, templates=EXPRESS_TEMPLATES)
        try:
            decision = await router.route(
                prompt, [self._catalog], latency_budget_ms=budget_ms
            )
        except DecisionBackendError as exc:
            elapsed = (time.perf_counter() - start) * 1000.0
            msg = f"Decision backend error: {exc}"
            return (
                RenderOutcome(
                    mode=RenderMode.CASCADE,
                    surface_id=surface_id,
                    messages=tuple(build_status_card_messages(surface_id, msg)),
                    ok=False,
                    error=msg,
                    stage="abstain_fallback",
                    fallback_reason="backend_error",
                    total_latency_ms=elapsed,
                ),
                rec.calls,
            )

        if decision.tier is CascadeTier.TEXT_ONLY:
            reply_text = await self._text_only_reply(prompt, session_id=session_id)
            elapsed = (time.perf_counter() - start) * 1000.0
            return (
                RenderOutcome(
                    mode=RenderMode.CASCADE,
                    surface_id=surface_id,
                    messages=tuple(
                        build_status_card_messages(
                            surface_id,
                            "**Text-only route**"
                            f" (`needs_ui={decision.needs_ui_probability:.2f}`)\n\n{reply_text}",
                        )
                    ),
                    text=reply_text,
                    stage="abstain_fallback",
                    confidence=decision.tier_confidence,
                    fallback_source="text_only",
                    fallback_reason=decision.reason,
                    total_latency_ms=elapsed,
                ),
                rec.calls,
            )

        if decision.tier is CascadeTier.TEMPLATE and decision.template is not None:
            compiler = ExpressCompiler([self._catalog])
            compiled = list(
                compiler.compile(decision.template.dsl, surface_id=surface_id)
            )
            msg_dicts = list(to_message_dicts(compiled))
            if data_payload is not None:
                safe_data = {
                    k: v
                    for k, v in data_payload.items()
                    if not any(
                        tok in k.lower()
                        for tok in ("key", "secret", "token", "password")
                    )
                }
                msg_dicts.append({
                    "version": "1.0",
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": safe_data,
                    },
                })
            dicts = tuple(msg_dicts)
            elapsed = (time.perf_counter() - start) * 1000.0
            return (
                RenderOutcome(
                    mode=RenderMode.CASCADE,
                    surface_id=surface_id,
                    messages=dicts,
                    stage="template_select",
                    confidence=decision.template_confidence or decision.tier_confidence,
                    selected_template_id=decision.template_id,
                    total_latency_ms=elapsed,
                    decompiled_express=decision.template.dsl,
                ),
                rec.calls,
            )

        catalogs = list(decision.catalogs) or [self._catalog]
        kept_names = sorted(catalogs[0].components)
        outcome = await self._run_format_llm(
            prompt,
            mode=RenderMode.CASCADE,
            catalogs=catalogs,
            surface_id=surface_id,
            session_id=session_id,
            stage="archetype",
            confidence=decision.tier_confidence,
            extra_summary=(
                f"tier={decision.tier.value}, kept={len(kept_names)} components"
            ),
            start=start,
        )
        return outcome, rec.calls

    async def run_binder_direct(
        self,
        *,
        intent: str,
        tool_name: str,
        tool_output: Any,
        actions: Sequence[ActionSpec] = (),
        surface_id: str = "main",
    ) -> tuple[RenderOutcome, list[RecordedBatchCall]]:
        """Executes Track 2B (`ToolPointerBinder`) with 0 LLM calls."""
        start = time.perf_counter()
        rec = self._recorder()
        binder = ToolPointerBinder(
            rec,
            transport_catalogs=[self._catalog],
            express_surfaces=EXPRESS_TEMPLATES,
        )
        try:
            result = await binder.bind_tool_output(
                intent,
                tool_name,
                tool_output,
                actions=actions,
                surface_id=surface_id,
            )
        except DecisionBackendError as exc:
            elapsed = (time.perf_counter() - start) * 1000.0
            msg = f"Decision backend error: {exc}"
            return (
                RenderOutcome(
                    mode=RenderMode.BINDER,
                    surface_id=surface_id,
                    messages=tuple(build_status_card_messages(surface_id, msg)),
                    ok=False,
                    error=msg,
                    stage="abstain_fallback",
                    fallback_reason="backend_error",
                    total_latency_ms=elapsed,
                ),
                rec.calls,
            )

        elapsed = (time.perf_counter() - start) * 1000.0
        if result.abstained or not result.messages:
            summary = f"Tool `{tool_name}` abstained from UI binding: {result.reason}"
            return (
                RenderOutcome(
                    mode=RenderMode.BINDER,
                    surface_id=surface_id,
                    messages=tuple(build_status_card_messages(surface_id, summary)),
                    text=summary,
                    stage="abstain_fallback",
                    confidence=result.confidence,
                    fallback_source="abstain",
                    fallback_reason=result.reason,
                    total_latency_ms=elapsed,
                ),
                rec.calls,
            )

        dicts = tuple(to_message_dicts(result.messages))
        return (
            RenderOutcome(
                mode=RenderMode.BINDER,
                surface_id=surface_id,
                messages=dicts,
                stage="template_select",
                confidence=result.confidence,
                selected_template_id=result.target_id,
                total_latency_ms=elapsed,
                decompiled_express=_decompile_express([self._catalog], result.messages),
            ),
            rec.calls,
        )

    async def run_rpc_call(
        self,
        rpc_messages: Sequence[Mapping[str, Any]],
        *,
        session_id: str,
    ) -> tuple[RenderOutcome, list[RecordedBatchCall]]:
        """Executes Track 2C (`a2ui.rpc.experimental.decision`) for `callAgentFunction`."""
        start = time.perf_counter()
        rec = self._recorder()
        fns = build_predicate_agent_functions(
            rec,
            RPC_PREDICATE_SPECS,
            session_id=session_id,
            rate_limiter=self._rate_limiter,
        )
        catalog = Catalog(RPC_PREDICATE_CATALOG_ID, "1.0").copy_with(
            agent_functions=fns
        )
        processor = RendererToAgentMessageProcessor([catalog])
        responses: list[dict[str, Any]] = []
        passed = True
        fallback_reason: str | None = None
        for msg in rpc_messages:
            result = await processor.process_message(dict(msg))
            for reply in result.replies:
                dumped = reply.model_dump(by_alias=True, exclude_unset=True)
                responses.append(dumped)
                reply_ok, reason = _classify_rpc_reply(dumped)
                if not reply_ok:
                    passed = False
                    fallback_reason = reason
        elapsed = (time.perf_counter() - start) * 1000.0
        return (
            RenderOutcome(
                mode=RenderMode.RPC,
                surface_id="main",
                messages=tuple(responses),
                ok=True,
                stage="archetype" if passed else "abstain_fallback",
                confidence=1.0 if passed else 0.0,
                fallback_reason=fallback_reason,
                operation="agent_function_response",
                total_latency_ms=elapsed,
            ),
            rec.calls,
        )

    async def run_baseline(
        self,
        prompt: str,
        *,
        mode: RenderMode,
        surface_id: str,
        session_id: str | None = None,
    ) -> tuple[RenderOutcome, list[RecordedBatchCall]]:
        """Runs a single-call Express or Direct JSON baseline render."""
        start = time.perf_counter()
        outcome = await self._run_format_llm(
            prompt,
            mode=mode,
            catalogs=[self._catalog],
            surface_id=surface_id,
            session_id=session_id,
            stage="archetype",
            confidence=1.0,
            extra_summary="",
            start=start,
        )
        return outcome, []

    async def _text_only_reply(self, prompt: str, *, session_id: str | None) -> str:
        if self._llm is None:
            return f"(Offline mock text-only reply for: {prompt})"
        turn = await self._llm(
            instruction_key="text_only",
            instruction="Answer concisely in plain text without generating UI.",
            user_text=prompt,
            session_id=session_id,
        )
        return turn.text.strip() or "(empty reply)"

    async def _run_format_llm(
        self,
        prompt: str,
        *,
        mode: RenderMode,
        catalogs: Sequence[CatalogApi],
        surface_id: str,
        session_id: str | None,
        stage: str,
        confidence: float,
        extra_summary: str,
        start: float,
    ) -> RenderOutcome:
        if self._llm is None:
            elapsed = (time.perf_counter() - start) * 1000.0
            note = (
                f"Mode `{mode.value}` selected `{extra_summary or 'LLM synthesis'}`."
                " Set `GEMINI_API_KEY` to enable live LLM generation, or use"
                " `/tool <name>` / `/form <name>` for 0-LLM turns."
            )
            return RenderOutcome(
                mode=mode,
                surface_id=surface_id,
                messages=tuple(build_status_card_messages(surface_id, note)),
                text=note,
                stage=stage,
                confidence=confidence,
                total_latency_ms=elapsed,
            )

        fmt: Any = (
            DirectJsonFormat(list(catalogs))
            if mode is RenderMode.DIRECT
            else ExpressFormat(list(catalogs))
        )
        instruction = fmt.prompt_generator.generate()
        turn = await self._llm(
            instruction_key=f"{mode.value}:{len(catalogs[0].components)}",
            instruction=instruction,
            user_text=f"Render surface '{surface_id}' for: {prompt}",
            session_id=session_id,
        )
        elapsed = (time.perf_counter() - start) * 1000.0
        try:
            parsed = list(fmt.parser.parse(turn.text))
            dicts = tuple(to_message_dicts(parsed))
        except Exception as exc:
            err = f"{mode.value} parse error: {exc}"
            return RenderOutcome(
                mode=mode,
                surface_id=surface_id,
                messages=tuple(build_status_card_messages(surface_id, err)),
                ok=False,
                error=err,
                stage="abstain_fallback",
                fallback_reason="parse_error",
                llm_calls=1,
                prompt_tokens=turn.prompt_tokens,
                output_tokens=turn.output_tokens,
                total_latency_ms=elapsed,
            )
        return RenderOutcome(
            mode=mode,
            surface_id=surface_id,
            messages=dicts,
            stage=stage,
            confidence=confidence,
            llm_calls=1,
            prompt_tokens=turn.prompt_tokens,
            output_tokens=turn.output_tokens,
            total_latency_ms=elapsed,
            decompiled_express=_decompile_express(catalogs, parsed),
        )

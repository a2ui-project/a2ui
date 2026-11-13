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

"""Stage 2 of the playground: render one decision block through a mode.

`decision` compiles the block through `DecisionSynthesizer` with no further
model call. `express` and `direct` ask a model for that format's source with
the same intent and payload, then validate it through the format's processor.
`status_surface` turns footer and help text into a small A2UI surface, because
the sample clients render surfaces only.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
import json
import logging
import os
import time
from typing import Any

from a2a.types import Part

from a2ui.a2a import create_a2ui_part
from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DEFAULT_GEMINI_DECISION_MODEL,
    DEFAULT_TYPESAFE_MODEL,
    ActionSpec,
    DecisionBackend,
    DecisionBackendError,
    DecisionBlock,
    DecisionFormat,
    DecisionFormatFactory,
    DecisionRecord,
    DecisionSynthesizer,
    DeterministicMockBackend,
    QuestionKind,
    SynthesisConfig,
    SynthesisOutput,
    create_decision_backend,
    surface_operation_for,
)
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.inference_formats.express import (
    ExpressDecompiler,
    ExpressFormatFactory,
)
from a2ui.parser import A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import RendererState, to_version_number
from modes import (
    LlmCaller,
    LlmTurn,
    RenderMode,
    RenderResult,
    TurnMetrics,
    format_decision_ms,
)

logger = logging.getLogger(__name__)

_STAGE2_RETRIES = 1
_MAX_SESSION_STATES = 100
_GEMINI_DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions"
_TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone"
_VERCEL_SYSTEMONE_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
DECISION_VERSION = "1.0"
"""The only protocol version the decision format renders."""
_DECISION_ERRORS = (A2uiError, ValueError, TypeError, DecisionBackendError)


def backend_display_name(backend: DecisionBackend) -> str:
    """Formats the display name for `backend` from its kind and model identifier.

    Args:
        backend: The active decision backend instance.

    Returns:
        The backend kind, followed by the parenthesized model identifier when
        it is distinct from the default or kind name.
    """
    label = getattr(backend, "backend_kind", type(backend).__name__)
    model_id = getattr(backend, "model_id", "")
    if model_id and model_id not in ("default", label):
        return f"{label} ({model_id})"
    return label


def _env_matches_backend(*kinds: str) -> bool:
    """Returns whether `A2UI_DECISION_BACKEND` matches one of `kinds`.

    Args:
        *kinds: Lowercase backend kind names that belong to the target preset.

    Returns:
        `True` if `A2UI_DECISION_BACKEND` is set to one of `kinds`.
    """
    configured = os.environ.get("A2UI_DECISION_BACKEND", "").strip().lower()
    return configured in kinds


def _build_gemini_backend() -> DecisionBackend:
    """Constructs the Gemini Decisions HTTP backend from environment variables.

    Generic `A2UI_DECISION_*` variables are read only when
    `A2UI_DECISION_BACKEND` is `"gemini"`, so runtime `/backend gemini`
    switching from a Jev startup configuration does not inherit Jev URLs,
    models, or credentials.

    Returns:
        A configured `DecisionBackend` targeting the Gemini Decisions endpoint.

    Raises:
        ValueError: If no Gemini API key or endpoint URL is configured.
    """
    use_decision_env = _env_matches_backend("gemini")
    decision_auth = (
        os.environ.get("A2UI_DECISION_AUTH") or os.environ.get("A2UI_DECISION_TOKEN")
        if use_decision_env
        else None
    )
    key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or decision_auth
    )
    gemini_url = os.environ.get("GEMINI_DECISION_URL") or (
        os.environ.get("A2UI_DECISION_URL") if use_decision_env else None
    )
    if not key and not gemini_url:
        raise ValueError("GEMINI_API_KEY is not set in the environment or ~/.env.")
    model = (
        os.environ.get("GEMINI_DECISION_MODEL")
        or (os.environ.get("A2UI_DECISION_MODEL") if use_decision_env else None)
        or DEFAULT_GEMINI_DECISION_MODEL
    )
    return create_decision_backend(
        "gemini",
        endpoint_url=gemini_url or _GEMINI_DECISIONS_URL,
        model=model,
        auth=key,
    )


def _build_jev_backend() -> DecisionBackend:
    """Constructs the Jev / SystemOne HTTP backend from environment variables.

    Generic `A2UI_DECISION_*` variables are read only when
    `A2UI_DECISION_BACKEND` is `"jev"` or `"systemone"`, so runtime
    `/backend jev` switching from a Gemini startup configuration does not
    inherit Gemini URLs, models, or credentials.

    Returns:
        A configured `DecisionBackend` targeting the SystemOne endpoint.

    Raises:
        ValueError: If no Jev API key or endpoint URL is configured.
    """
    use_decision_env = _env_matches_backend("jev", "systemone")
    decision_auth = (
        os.environ.get("A2UI_DECISION_AUTH") or os.environ.get("A2UI_DECISION_TOKEN")
        if use_decision_env
        else None
    )
    key = (
        os.environ.get("JEV_API_KEY")
        or os.environ.get("TYPESAFE_API_KEY")
        or decision_auth
    )
    jev_url = os.environ.get("JEV_URL") or (
        os.environ.get("A2UI_DECISION_URL") if use_decision_env else None
    )
    if not key and not jev_url:
        raise ValueError("JEV_API_KEY is not set in the environment or ~/.env.")
    token = key.strip() if isinstance(key, str) else ""
    default_url = (
        _VERCEL_SYSTEMONE_URL if token.startswith("vcp_") else _TYPESAFE_SYSTEMONE_URL
    )
    default_model = "jev" if token.startswith("vcp_") else DEFAULT_TYPESAFE_MODEL
    model = (
        os.environ.get("JEV_MODEL")
        or (os.environ.get("A2UI_DECISION_MODEL") if use_decision_env else None)
        or default_model
    )
    return create_decision_backend(
        "systemone",
        endpoint_url=jev_url or default_url,
        model=model,
        auth=key,
    )


def build_named_backend(name: str) -> DecisionBackend:
    """Constructs a named playground decision backend (`jev`, `gemini`, `mock`).

    Args:
        name: Preset backend name (`"mock"`, `"gemini"`, `"jev"`, or
            `"systemone"`).

    Returns:
        A configured `DecisionBackend` for the requested preset.

    Raises:
        ValueError: If `name` is unknown or required credentials are missing.
    """
    clean = name.strip().lower()
    if clean == "mock":
        return DeterministicMockBackend()
    if clean == "gemini":
        return _build_gemini_backend()
    if clean in ("jev", "systemone"):
        return _build_jev_backend()
    raise ValueError(f"Unknown decision backend `{name}`; choose jev, gemini, or mock.")


def stage2_user_text(block: DecisionBlock, surface_id: str) -> str:
    """Builds the stage-2 user prompt for an `express` or `direct` render.

    Args:
        block: The extracted stage-1 `DecisionBlock` to render.
        surface_id: Target A2UI surface identifier.

    Returns:
        The formatted user prompt containing intent, surface id, and JSON data.
    """
    payload = json.dumps(block.payload, indent=2)
    return (
        "Render this interface using the format rules in your instructions.\n"
        f"Intent: {block.intent}\n"
        f'Use surface id "{surface_id}".\n'
        "Bind only to the JSON pointers in this data model; do not invent other"
        " data:\n"
        f"```json\n{payload}\n```"
    )


def _record_line(record: DecisionRecord) -> str:
    """Formats one planner `DecisionRecord` as a single status line.

    Args:
        record: The planner decision record to summarize.

    Returns:
        A middle-dot-separated summary string with question id, winning answer,
        threshold, and outcome.
    """
    question = record.question
    if record.answer is None:
        winner = "unanswered"
    elif question.kind is QuestionKind.BOOLEAN:
        winner = f"yes p={record.answer.yes:.2f}"
    else:
        option, prob = record.answer.top()
        winner = f"{option} p={prob:.2f}"
    pieces = [f"`{question.id}`", winner]
    if record.threshold is not None:
        pieces.append(f"threshold {record.threshold:.2f}")
    if record.outcome:
        pieces.append(record.outcome)
    return " · ".join(pieces)


def _output_path(output: SynthesisOutput) -> str:
    """Formats the synthesis path summary for `/trace`.

    Args:
        output: Completed `SynthesisOutput` from the decision synthesizer.

    Returns:
        A Markdown snippet describing the chosen template, archetype, or
        fallback path.
    """
    conf = f"p={output.confidence:.2f}"
    stage = output.stage.value
    if stage == "template_select":
        tpl = f" `{output.selected_template_id}`" if output.selected_template_id else ""
        return f"**Path**: templates · template{tpl} ({conf})"
    if stage == "archetype" and output.layout_plan is not None:
        plan = output.layout_plan
        blocks = ", ".join(f"`{b.block_id}:{b.pattern}`" for b in plan.blocks)
        n = len(plan.blocks)
        block_desc = (
            f"{n} block{'' if n == 1 else 's'}: {blocks}" if blocks else "0 blocks"
        )
        return (
            f"**Path**: decision model · archetype `{plan.archetype}`"
            f" ({conf}, {block_desc})"
        )
    source = str(output.fallback_source) if output.fallback_source else "abstained"
    reason = f": {output.fallback_reason}" if output.fallback_reason else ""
    return f"**Path**: fallback (`{source}`) · decision model abstained{reason}"


def _output_summary_line(output: SynthesisOutput) -> str:
    """Formats a summary header line for `/trace` with path, backend, and latency.

    Args:
        output: Completed `SynthesisOutput` from the decision synthesizer.

    Returns:
        A single-line Markdown summary of the synthesis outcome.
    """
    calls = output.decision_calls
    call_label = f"{calls} call{'' if calls == 1 else 's'}"
    backend = f"`{output.backend_kind}`" + (
        f" (`{output.model_id}`)" if output.model_id else ""
    )
    timing = (
        f"**Decision time**: {format_decision_ms(output.decision_latency_ms)}"
        f" ({call_label})"
    )
    return f"{_output_path(output)} · **Backend**: {backend} · {timing}"


def trace_lines(output: SynthesisOutput) -> tuple[str, ...]:
    """Builds the `/trace` lines for `output`.

    Args:
        output: Completed `SynthesisOutput` from the decision synthesizer.

    Returns:
        A tuple starting with the summary header line followed by one line per
        planner `DecisionRecord`.
    """
    return (_output_summary_line(output),) + tuple(
        _record_line(record) for record in output.trace
    )


def _express_literal(text: str) -> str:
    """Quotes `text` as an Express string literal while preserving non-ASCII text.

    Args:
        text: Raw string value to quote.

    Returns:
        A double-quoted JSON/Express string literal.
    """
    return json.dumps(text, ensure_ascii=False)


@dataclass
class _Stage2Attempt:
    """One stage-2 model call and its validated result.

    Attributes:
        turn: The stage-2 `LlmTurn` returned by the model.
        parts: Validated A2A `Part` wrappers produced from the response.
        error: Validation or parsing error message, or `None` on success.
        messages: Raw A2UI protocol message dictionaries.
        decompiled_express: Best-effort Express DSL decompilation of `messages`.
    """

    turn: LlmTurn
    parts: list[Part]
    error: str | None
    messages: tuple[dict[str, Any], ...] = ()
    decompiled_express: str = ""


class Renderers:
    """Renders decision blocks through every mode for a set of protocol versions."""

    def __init__(
        self,
        *,
        versions: Sequence[str],
        backend: DecisionBackend,
        config: SynthesisConfig | None = None,
    ) -> None:
        """Initializes request processors for each configured protocol version.

        Args:
            versions: Supported A2UI protocol version strings (such as
                `("0.9", "1.0")`).
            backend: Initial `DecisionBackend` for `decision` and `tool` modes.
            config: Optional `SynthesisConfig` override for the decision format.
        """
        self._versions = tuple(versions)
        self._config = config
        self._raw_backend = backend
        self._decision_factory = DecisionFormatFactory(backend=backend, config=config)
        self._states: OrderedDict[str, RendererState] = OrderedDict()
        self._processors: dict[tuple[RenderMode, str], A2uiRequestProcessor] = {}
        for version in self._versions:
            key = to_version_number(version)
            if key == DECISION_VERSION:
                self._processors[(RenderMode.DECISION, key)] = self._build_processor(
                    version, self._decision_factory
                )
            self._processors[(RenderMode.EXPRESS, key)] = self._build_processor(
                version, ExpressFormatFactory()
            )
            self._processors[(RenderMode.DIRECT, key)] = self._build_processor(
                version, DirectJsonFormatFactory()
            )

    async def set_backend(self, backend: DecisionBackend) -> None:
        """Replaces the active decision backend and closes the previous factory.

        Args:
            backend: Replacement `DecisionBackend` instance.
        """
        old_factory = self._decision_factory
        self._raw_backend = backend
        self._decision_factory = DecisionFormatFactory(
            backend=backend, config=self._config
        )
        if (RenderMode.DECISION, DECISION_VERSION) in self._processors:
            self._processors[(RenderMode.DECISION, DECISION_VERSION)] = (
                self._build_processor(DECISION_VERSION, self._decision_factory)
            )
        await old_factory.aclose()

    @staticmethod
    def _build_processor(version: str, factory: Any) -> A2uiRequestProcessor:
        """Constructs an `A2uiRequestProcessor` for `version` and `factory`.

        Args:
            version: A2UI protocol version string.
            factory: Inference format factory (`DecisionFormatFactory`,
                `ExpressFormatFactory`, or `DirectJsonFormatFactory`).

        Returns:
            A configured `A2uiRequestProcessor` bound to `BasicCatalog(version)`.
        """
        generator = A2uiGenerator(
            [CatalogConfig(BasicCatalog(version))], inference_format_factory=factory
        )
        num = to_version_number(version)
        cap_key = "1.0" if num == "1.0" else f"v{num}"
        return generator.create_processor({
            cap_key: {
                "supportedCatalogIds": [
                    c.transformed_catalog.catalog_id for c in generator.catalogs
                ]
            }
        })

    @property
    def backend(self) -> DecisionBackend:
        """The active decision backend instance."""
        return self._raw_backend

    @property
    def backend_name(self) -> str:
        """The decision backend's display name including any non-default model id."""
        return backend_display_name(self._raw_backend)

    @property
    def backend_kind(self) -> str:
        """The active decision backend's `backend_kind`."""
        return self._raw_backend.backend_kind

    @property
    def versions(self) -> tuple[str, ...]:
        """Protocol version numbers this instance renders for."""
        return tuple(sorted({v for _, v in self._processors}))

    def processor(self, mode: RenderMode, version: str) -> A2uiRequestProcessor:
        """Returns the `A2uiRequestProcessor` for `mode` and `version`.

        Args:
            mode: Target render mode.
            version: A2UI protocol version string.

        Returns:
            The matching `A2uiRequestProcessor`.

        Raises:
            KeyError: If `version` or `(mode, version)` was not configured.
        """
        return self._processors[(mode, to_version_number(version))]

    def prompt_for(self, mode: RenderMode, version: str) -> str:
        """Returns the stage-2 system instruction prompt for `mode` and `version`.

        Args:
            mode: Target render mode (`EXPRESS` or `DIRECT`).
            version: A2UI protocol version string.

        Returns:
            The format's system prompt snippet.
        """
        return self.processor(mode, version).prompt_snippet

    def synthesizer_or_none(
        self, version: str = DECISION_VERSION
    ) -> DecisionSynthesizer | None:
        """Returns the `DecisionSynthesizer` for `version`, or `None` if unsupported.

        Args:
            version: A2UI protocol version string.

        Returns:
            The active `DecisionSynthesizer` when `version` is v1.0, otherwise
            `None`.
        """
        if to_version_number(version) != DECISION_VERSION:
            return None
        processor = self._processors.get((RenderMode.DECISION, DECISION_VERSION))
        if processor is None or not isinstance(processor.format, DecisionFormat):
            return None
        return processor.format.synthesizer

    def _synthesizer(self, version: str) -> DecisionSynthesizer:
        """Returns the `DecisionSynthesizer` for `version`.

        Args:
            version: A2UI protocol version string.

        Returns:
            The active `DecisionSynthesizer`.

        Raises:
            ValueError: If `version` is not v1.0.
            TypeError: If the decision processor format is not a `DecisionFormat`.
        """
        if to_version_number(version) != DECISION_VERSION:
            raise ValueError(
                f"The decision format renders A2UI v{DECISION_VERSION} only; this"
                f" client asked for v{to_version_number(version)}."
            )
        fmt = self.processor(RenderMode.DECISION, version).format
        if not isinstance(fmt, DecisionFormat):
            raise TypeError(f"Expected a DecisionFormat, got {type(fmt).__name__}.")
        return fmt.synthesizer

    def state_for(self, conversation_id: str) -> RendererState:
        """Returns the bounded LRU `RendererState` for one conversation.

        Stored on `Renderers` rather than `DecisionFormat` so surface state and
        `PlanCache` entries survive runtime `/backend` switches while evicting
        the oldest conversation states past `_MAX_SESSION_STATES`.

        Args:
            conversation_id: A2A conversation/context identifier.

        Returns:
            The conversation's `RendererState`.
        """
        state = self._states.get(conversation_id)
        if state is None:
            catalogs = self.processor(RenderMode.DECISION, DECISION_VERSION)
            state = RendererState(catalogs.active_catalogs)
            self._states[conversation_id] = state
        self._states.move_to_end(conversation_id)
        while len(self._states) > _MAX_SESSION_STATES:
            self._states.popitem(last=False)
        return state

    async def _synthesize(
        self,
        block: DecisionBlock,
        *,
        surface_id: str,
        version: str,
        conversation_id: str | None,
    ) -> SynthesisOutput:
        """Synthesizes `block` and updates the conversation's surface state in place.

        When `conversation_id` is provided, the block's target surface is looked
        up in that conversation's `RendererState` so a reused surface identifier
        updates in place (or recreates when `block.replace` is set) and applies
        the emitted messages back to `state`.

        Args:
            block: Decision block to synthesize.
            surface_id: Target A2UI surface identifier.
            version: A2UI protocol version string.
            conversation_id: Optional conversation identifier for stateful
                updates and `PlanCache` lookups.

        Returns:
            The resulting `SynthesisOutput`.
        """
        synthesizer = self._synthesizer(version)
        kwargs = block.to_synthesis_kwargs(default_surface_id=surface_id)
        kwargs["surface_id"] = surface_id
        if conversation_id is None:
            return await synthesizer.synthesize(block.intent, block.payload, **kwargs)
        state = self.state_for(conversation_id)
        operation, sends_data_model = surface_operation_for(block, state, surface_id)
        output = await synthesizer.synthesize(
            block.intent,
            block.payload,
            operation=operation,
            surface_sends_data_model=sends_data_model,
            state=state,
            **kwargs,
        )
        state.apply(output.messages)
        return output

    def _decision_result(
        self,
        block: DecisionBlock,
        started: float,
        mode: RenderMode,
        *,
        output: SynthesisOutput | None,
        version: str,
        error: str | None = None,
    ) -> RenderResult:
        """Packages a `SynthesisOutput` (or error) into a `RenderResult`.

        Args:
            block: Source `DecisionBlock`.
            started: `time.perf_counter()` timestamp when synthesis started.
            mode: Render mode (`DECISION` or `TOOL`).
            output: Completed `SynthesisOutput`, or `None` if synthesis failed.
            version: A2UI protocol version string.
            error: Optional error message when `output` is `None`.

        Returns:
            The packaged `RenderResult`.
        """
        if output is None:
            return RenderResult(
                metrics=self._decision_metrics(None, started, mode=mode),
                error=error,
            )
        msg_dicts = tuple(to_message_dicts(output.messages))
        parts = [create_a2ui_part(message, version=version) for message in msg_dicts]
        active_catalogs = self.processor(RenderMode.DECISION, version).active_catalogs
        try:
            decompiled = output.to_express(active_catalogs)
        except A2uiError:
            decompiled = ""
        return RenderResult(
            parts=parts,
            metrics=self._decision_metrics(output, started, mode=mode),
            trace_lines=trace_lines(output),
            decision_answers=output.decision_answers,
            output=output,
            messages=msg_dicts,
            decompiled_express=decompiled,
            error=None if parts else "The decision model produced no surface.",
        )

    async def render_decision(
        self,
        block: DecisionBlock,
        *,
        surface_id: str,
        version: str,
        conversation_id: str | None = None,
        mode: RenderMode = RenderMode.DECISION,
    ) -> RenderResult:
        """Compiles `block` with the decision synthesizer without an LLM call.

        Args:
            block: Decision block to compile.
            surface_id: Target A2UI surface identifier.
            version: A2UI protocol version string.
            conversation_id: Optional conversation identifier for stateful
                updates and `PlanCache` reuse.
            mode: Render mode label to record on metrics (`DECISION` or `TOOL`).

        Returns:
            The completed `RenderResult`.
        """
        started = time.perf_counter()
        try:
            output = await self._synthesize(
                block,
                surface_id=surface_id,
                version=version,
                conversation_id=conversation_id,
            )
        except _DECISION_ERRORS as exc:
            logger.warning("Decision render failed: %s", exc)
            return self._decision_result(
                block, started, mode, output=None, version=version, error=str(exc)
            )
        return self._decision_result(
            block, started, mode, output=output, version=version
        )

    async def render_tool_result(
        self,
        intent: str,
        payload: Any,
        *,
        surface_id: str,
        version: str = DECISION_VERSION,
        mutable_paths: Sequence[str] = (),
        actions: Sequence[ActionSpec] = (),
        conversation_id: str | None = None,
    ) -> RenderResult:
        """Renders tool output directly via the decision synthesizer.

        Args:
            intent: One-sentence description of the tool result view.
            payload: Structured JSON-serializable tool output data.
            surface_id: Target A2UI surface identifier.
            version: A2UI protocol version string (defaults to `"1.0"`).
            mutable_paths: Editable JSON Pointer paths for form bindings.
            actions: Action button specifications for the surface.
            conversation_id: Optional conversation identifier for stateful
                updates and `PlanCache` reuse.

        Returns:
            The completed `RenderResult`.
        """
        block = DecisionBlock(
            intent=intent,
            payload=payload,
            mutable_paths=tuple(mutable_paths),
            actions=tuple(actions),
        )
        return await self.render_decision(
            block,
            surface_id=surface_id,
            version=version,
            conversation_id=conversation_id,
            mode=RenderMode.TOOL,
        )

    def _decision_metrics(
        self,
        output: SynthesisOutput | None,
        started: float,
        mode: RenderMode = RenderMode.DECISION,
    ) -> TurnMetrics:
        """Builds `TurnMetrics` for a decision or tool synthesis run.

        Args:
            output: Completed `SynthesisOutput`, or `None` on failure.
            started: `time.perf_counter()` timestamp when synthesis started.
            mode: Render mode (`DECISION` or `TOOL`).

        Returns:
            The populated `TurnMetrics`.
        """
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        if output is None:
            return TurnMetrics(
                mode=mode,
                backend=self._raw_backend.backend_kind,
                model_id=self._raw_backend.model_id,
                llm_calls=0,
                latency_ms=elapsed_ms,
                decision_latency_ms=elapsed_ms,
            )
        plan = output.layout_plan
        return TurnMetrics(
            mode=mode,
            backend=output.backend_kind or self._raw_backend.backend_kind,
            model_id=output.model_id or None,
            llm_calls=0,
            latency_ms=elapsed_ms,
            archetype=plan.archetype if plan is not None and plan.archetype else None,
            confidence=output.confidence,
            block_count=len(plan.blocks) if plan is not None else None,
            fallback=str(output.fallback_source) if output.fallback_source else None,
            fallback_reason=output.fallback_reason,
            stage=output.stage.value,
            decision_latency_ms=output.decision_latency_ms or elapsed_ms,
            decision_calls=output.decision_calls,
            template_id=output.selected_template_id,
            operation=str(output.operation),
            cache_hit=output.cache_hit,
            fit_score=plan.fit_score if plan is not None else None,
        )

    async def _call_and_parse(
        self,
        mode: RenderMode,
        version: str,
        llm: LlmCaller,
        user_text: str,
    ) -> _Stage2Attempt:
        """Executes one stage-2 LLM call and validates its reply through the processor.

        Args:
            mode: Stage-2 render mode (`EXPRESS` or `DIRECT`).
            version: A2UI protocol version string.
            llm: Language model caller.
            user_text: Stage-2 user prompt text.

        Returns:
            The resulting `_Stage2Attempt`.
        """
        processor = self.processor(mode, version)
        turn = await llm(
            instruction_key=f"{mode}:{to_version_number(version)}",
            instruction=processor.prompt_snippet,
            user_text=user_text,
            session_id=None,
        )
        try:
            response_parts = processor.parse_response(turn.text)
        except (A2uiError, ValueError, json.JSONDecodeError) as exc:
            return _Stage2Attempt(turn=turn, parts=[], error=str(exc))
        parsed_models = [
            msg
            for part in response_parts
            if isinstance(part, A2uiPart)
            for msg in part.a2ui
        ]
        msg_dicts = tuple(to_message_dicts(parsed_models))
        parts = [create_a2ui_part(message, version=version) for message in msg_dicts]
        decompiled = ""
        if parsed_models:
            try:
                decompiled = ExpressDecompiler(processor.active_catalogs).decompile(
                    parsed_models
                )
            except A2uiError:
                decompiled = ""
        error = None if parts else "The reply contained no A2UI block."
        return _Stage2Attempt(
            turn=turn,
            parts=parts,
            error=error,
            messages=msg_dicts,
            decompiled_express=decompiled,
        )

    async def render_with_llm(
        self,
        mode: RenderMode,
        block: DecisionBlock,
        *,
        surface_id: str,
        version: str,
        llm: LlmCaller,
    ) -> RenderResult:
        """Renders `block` via a stage-2 LLM call, retrying once on validation failure.

        Args:
            mode: Stage-2 render mode (`EXPRESS` or `DIRECT`).
            block: Decision block containing intent and payload data.
            surface_id: Target A2UI surface identifier.
            version: A2UI protocol version string.
            llm: Language model caller.

        Returns:
            The resulting `RenderResult`.

        Raises:
            ValueError: If `mode` is `RenderMode.DECISION`.
        """
        if mode is RenderMode.DECISION:
            raise ValueError("render_with_llm renders express or direct, not decision.")
        user_text = stage2_user_text(block, surface_id)
        attempts: list[_Stage2Attempt] = []
        for _ in range(_STAGE2_RETRIES + 1):
            attempt = await self._call_and_parse(mode, version, llm, user_text)
            attempts.append(attempt)
            if attempt.error is None:
                break
            user_text = (
                f"{stage2_user_text(block, surface_id)}\n\nYour previous reply was"
                f" invalid: {attempt.error} Reply again following the format rules"
                " exactly."
            )
        last = attempts[-1]
        metrics = TurnMetrics(
            mode=mode,
            backend="llm",
            llm_calls=len(attempts),
            latency_ms=sum(a.turn.latency_ms for a in attempts),
            prompt_tokens=sum(a.turn.prompt_tokens for a in attempts),
            output_tokens=sum(a.turn.output_tokens for a in attempts),
            fallback="validation_retry" if len(attempts) > 1 else None,
        )
        return RenderResult(
            parts=last.parts,
            metrics=metrics,
            error=last.error,
            messages=last.messages,
            raw_stage2_text=last.turn.text,
            decompiled_express=last.decompiled_express,
        )

    def status_surface(
        self, lines: Sequence[str], *, surface_id: str, version: str
    ) -> list[Part]:
        """Compiles `lines` of Markdown text into a single-column A2UI surface.

        Args:
            lines: Sequence of Markdown text strings, one per `Text` component.
            surface_id: Target A2UI surface identifier.
            version: A2UI protocol version string.

        Returns:
            A list of A2UI `Part` wrappers creating and populating the surface.
        """
        texts = ", ".join(f"Text({_express_literal(line)})" for line in lines) or (
            'Text("")'
        )
        source = f'surface("{surface_id}")\nroot = Column([{texts}])'
        parser = self.processor(RenderMode.EXPRESS, version).parser
        messages = parser.compile(source)
        return [
            create_a2ui_part(message, version=version)
            for message in to_message_dicts(messages)
        ]

    async def aclose(self) -> None:
        """Closes the shared decision backend resources."""
        await self._decision_factory.aclose()

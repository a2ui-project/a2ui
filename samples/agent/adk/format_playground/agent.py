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

"""The format playground agent: commands, stage 1, and per-mode rendering."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import AsyncIterable, Sequence
import logging
import os
import time
from typing import Any
import uuid

from a2a.types import AgentCapabilities, AgentCard, AgentSkill, Part, TextPart
from google.adk.agents import run_config
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core import A2uiError
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    DecisionBlock,
    create_decision_backend,
)
from commands import DECISION_BACKENDS, apply_command, help_text, parse_command
from modes import (
    LlmCaller,
    LlmTurn,
    PlaygroundSettings,
    RenderMode,
    RenderResult,
    TurnMetrics,
    format_decision_ms,
    surface_id_for,
)
from renderers import Renderers, build_named_backend
from stage1 import extract_block, stage1_instruction, stage1_user_text

logger = logging.getLogger(__name__)

_STAGE1_KEY = "stage1"
_MAX_SESSIONS = 100
_VERSIONS = ("0.9", "1.0")
_SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]


def default_model_name() -> str:
    """The model name from `MODEL_NAME`, `LITELLM_MODEL`, or the sample default."""
    model_env = (
        os.getenv("MODEL_NAME") or os.getenv("LITELLM_MODEL") or "gemini-3.6-flash"
    )
    return model_env.split("/")[-1]


class AdkLlmCaller:
    """`LlmCaller` over the ADK: one `LlmAgent` and `Runner` per instruction key."""

    def __init__(
        self, model_name: str, app_name: str, user_id: str = "playground"
    ) -> None:
        self._model_name = model_name
        self._app_name = app_name
        self._user_id = user_id
        self._runners: dict[str, Runner] = {}

    def _runner_for(self, instruction_key: str, instruction: str) -> Runner:
        runner = self._runners.get(instruction_key)
        if runner is None:
            agent = LlmAgent(
                model=Gemini(
                    model=self._model_name,
                    retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2.0),
                ),
                name=(
                    f"playground_{instruction_key.replace(':', '_').replace('.', '_')}"
                ),
                description="Format playground stage agent.",
                instruction=instruction,
            )
            runner = Runner(
                app_name=self._app_name,
                agent=agent,
                artifact_service=InMemoryArtifactService(),
                session_service=InMemorySessionService(),
                memory_service=InMemoryMemoryService(),
            )
            self._runners[instruction_key] = runner
        return runner

    async def _session_for(self, runner: Runner, session_id: str | None) -> str:
        """Returns an existing session id, or creates one (fresh when `session_id` is None)."""
        sid = session_id or f"oneshot-{uuid.uuid4()}"
        session = await runner.session_service.get_session(
            app_name=self._app_name, user_id=self._user_id, session_id=sid
        )
        if session is None:
            await runner.session_service.create_session(
                app_name=self._app_name, user_id=self._user_id, session_id=sid
            )
        return sid

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        runner = self._runner_for(instruction_key, instruction)
        sid = await self._session_for(runner, session_id)
        started = time.perf_counter()
        chunks: list[str] = []
        prompt_tokens = output_tokens = 0
        async for event in runner.run_async(
            user_id=self._user_id,
            session_id=sid,
            new_message=types.Content(
                role="user", parts=[types.Part.from_text(text=user_text)]
            ),
            run_config=run_config.RunConfig(
                streaming_mode=run_config.StreamingMode.NONE
            ),
        ):
            if event.content and event.content.parts:
                chunks.extend(p.text for p in event.content.parts if p.text)
            usage = getattr(event, "usage_metadata", None)
            if usage is not None:
                prompt_tokens = int(usage.prompt_token_count or 0)
                output_tokens += int(usage.candidates_token_count or 0)
        return LlmTurn(
            text="".join(chunks),
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )


class PlaygroundAgent:
    """Chat agent that renders one request through the chosen inference mode."""

    def __init__(
        self,
        base_url: str,
        *,
        llm: LlmCaller | None = None,
        renderers: Renderers | None = None,
        model_name: str | None = None,
        default_mode: RenderMode = RenderMode.DECISION,
    ) -> None:
        self.base_url = base_url
        self.model_name = model_name or default_model_name()
        self.default_mode = default_mode
        self.llm: LlmCaller = (
            llm
            if llm is not None
            else AdkLlmCaller(self.model_name, "format_playground")
        )
        self.renderers = (
            renderers
            if renderers is not None
            else Renderers(versions=_VERSIONS, backend=create_decision_backend())
        )
        self._grammar = ArchetypeGrammar.default()
        self._stage1_instruction = stage1_instruction(self._grammar)
        self._settings: OrderedDict[str, PlaygroundSettings] = OrderedDict()
        self._last_trace: OrderedDict[str, tuple[str, ...]] = OrderedDict()
        self.agent_card = self._build_agent_card()

    def _build_agent_card(self) -> AgentCard:
        extensions = [
            get_a2ui_agent_extension(
                version,
                supported_catalog_ids=[
                    c.catalog_id
                    for c in self.renderers.processor(
                        RenderMode.DECISION, version
                    ).active_catalogs
                ],
            )
            for version in self.renderers.versions
        ]
        skill = AgentSkill(
            id="render_ui",
            name="Render a described interface",
            description=(
                "Describe an interface in plain language and it is rendered through"
                " the decision, express, or direct inference format. Commands:"
                " /mode, /backend, /compare, /trace, /help."
            ),
            tags=["a2ui", "playground", "decision"],
            examples=["Give me an address entry form", "Show my stock portfolio"],
        )
        return AgentCard(
            name="A2UI Format Playground",
            description="Renders chat requests through the A2UI inference formats.",
            url=self.base_url,
            version="1.0.0",
            default_input_modes=_SUPPORTED_CONTENT_TYPES,
            default_output_modes=_SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(streaming=True, extensions=extensions),
            skills=[skill],
        )

    # --- per-conversation state -------------------------------------------------

    def _settings_for(self, session_id: str) -> PlaygroundSettings:
        settings = self._settings.get(session_id)
        if settings is None:
            settings = PlaygroundSettings(mode=self.default_mode)
            self._remember(self._settings, session_id, settings)
        return settings

    @staticmethod
    def _remember(store: OrderedDict[str, Any], key: str, value: Any) -> None:
        store[key] = value
        store.move_to_end(key)
        while len(store) > _MAX_SESSIONS:
            store.popitem(last=False)

    # --- replies ---------------------------------------------------------------

    def _status(
        self,
        lines: Sequence[str],
        settings: PlaygroundSettings,
        version: str,
        suffix: str = "status",
    ) -> list[Part]:
        return self.renderers.status_surface(
            lines,
            surface_id=f"{surface_id_for(settings)}-{suffix}",
            version=version,
        )

    async def stream(
        self, query: str, session_id: str, ui_version: str | None
    ) -> AsyncIterable[dict[str, Any]]:
        """Handles one chat message and yields a single final item of parts."""
        if ui_version is None:
            yield {
                "is_task_complete": True,
                "parts": [
                    Part(
                        root=TextPart(
                            text=(
                                "This playground renders A2UI surfaces; connect with"
                                " a client that requests the A2UI extension."
                            )
                        )
                    )
                ],
            }
            return
        settings = self._settings_for(session_id)
        command = parse_command(query)
        if command is not None:
            parts = self._run_command(command, session_id, settings, ui_version)
        else:
            parts = await self._render_turn(query, session_id, settings, ui_version)
        yield {"is_task_complete": True, "parts": parts}

    def _run_command(
        self,
        command: Any,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
    ) -> list[Part]:
        new_settings, reply = apply_command(command, settings)
        self._remember(self._settings, session_id, new_settings)
        if command.name == "help":
            lines = help_text(
                new_settings, self.renderers.backend_name, self.model_name
            )
            if command.argument and command.argument.startswith("unknown:"):
                lines.insert(
                    0, f"Unknown command `{command.argument[len('unknown:'):]}`."
                )
        elif command.name == "backend":
            lines = self._switch_backend(command.argument)
        elif command.name == "trace":
            lines = list(self._last_trace.get(session_id, ())) or [
                "No decision turn yet. Render something in `decision` mode first."
            ]
        else:
            lines = [reply or ""]
        return self._status(lines, new_settings, version)

    def _switch_backend(self, argument: str | None) -> list[str]:
        if not argument:
            choices = ", ".join(DECISION_BACKENDS)
            return [
                f"Active decision backend: `{self.renderers.backend_name}`"
                f" (choose {choices})."
            ]
        try:
            backend = build_named_backend(argument)
        except ValueError as exc:
            return [str(exc)]
        self.renderers.set_backend(backend)
        return [f"Decision backend set to `{self.renderers.backend_name}`."]

    async def _render_turn(
        self,
        query: str,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
    ) -> list[Part]:
        settings = settings.next_turn()
        try:
            stage1 = await self.llm(
                instruction_key=_STAGE1_KEY,
                instruction=self._stage1_instruction,
                user_text=stage1_user_text(query),
                session_id=session_id,
            )
        except Exception as exc:  # the model call itself failed; keep the chat alive
            logger.exception("Stage 1 failed")
            self._remember(self._settings, session_id, settings)
            return self._status([f"Stage 1 failed: {exc}"], settings, version)
        block = extract_block(stage1.text)
        if block is None:
            self._remember(self._settings, session_id, settings)
            prose = stage1.text.strip() or "(empty reply)"
            return self._status(
                [
                    (
                        "I could not turn that into a decision block; try describing"
                        " the data you want to see."
                    ),
                    f"The model said: {prose[:500]}",
                ],
                settings,
                version,
            )
        modes = list(RenderMode) if settings.compare else [settings.mode]
        parts: list[Part] = []
        results: list[tuple[RenderMode, RenderResult]] = []
        for mode in modes:
            result = await self._render_mode(mode, block, settings, version)
            results.append((mode, result))
            parts.extend(result.parts)
            parts.extend(self._footer_parts(mode, result, stage1, settings, version))
            if mode is RenderMode.DECISION and result.trace_lines:
                self._remember(self._last_trace, session_id, result.trace_lines)
        if settings.compare:
            parts.extend(self._compare_summary(results, stage1, settings, version))
        self._remember(
            self._settings,
            session_id,
            settings.__class__(mode=settings.mode, turn=settings.turn),
        )
        return parts

    async def _render_mode(
        self,
        mode: RenderMode,
        block: DecisionBlock,
        settings: PlaygroundSettings,
        version: str,
    ) -> RenderResult:
        surface_id = surface_id_for(settings, mode)
        try:
            if mode is RenderMode.DECISION:
                return await self.renderers.render_decision(
                    block, surface_id=surface_id, version=version
                )
            return await self.renderers.render_with_llm(
                mode, block, surface_id=surface_id, version=version, llm=self.llm
            )
        except (A2uiError, ValueError) as exc:
            logger.warning("%s render failed: %s", mode, exc)
            return RenderResult(error=str(exc))

    def _footer_parts(
        self,
        mode: RenderMode,
        result: RenderResult,
        stage1: LlmTurn,
        settings: PlaygroundSettings,
        version: str,
    ) -> list[Part]:
        metrics = result.metrics or TurnMetrics(
            mode=mode, backend="llm", llm_calls=0, latency_ms=0.0
        )
        lines = [metrics.plus_stage1(stage1).footer()]
        if result.error:
            lines.append(f"Render failed: {result.error}")
        return self._status(lines, settings, version, suffix=f"{mode}-footer")

    def _compare_summary(
        self,
        results: Sequence[tuple[RenderMode, RenderResult]],
        stage1: LlmTurn,
        settings: PlaygroundSettings,
        version: str,
    ) -> list[Part]:
        lines = ["**Compare** (same intent and data through every mode)"]
        for mode, result in results:
            metrics = (
                result.metrics
                or TurnMetrics(mode=mode, backend="llm", llm_calls=0, latency_ms=0.0)
            ).plus_stage1(stage1)
            status = "ok" if result.ok else f"failed: {result.error}"
            extra_parts: list[str] = []
            if metrics.decision_latency_ms is not None:
                extra_parts.append(
                    f"decision {format_decision_ms(metrics.decision_latency_ms)}"
                )
            path = metrics.path_summary()
            if path is not None:
                extra_parts.append(path)
            extra = f" ({', '.join(extra_parts)})" if extra_parts else ""
            lines.append(
                f"`{mode}`: {metrics.llm_calls}"
                f" call{'s' if metrics.llm_calls != 1 else ''},"
                f" {metrics.latency_ms / 1000.0:.1f} s{extra},"
                f" {metrics.output_tokens} out tokens, {status}"
            )
        return self._status(lines, settings, version, suffix="compare")

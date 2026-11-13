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

import asyncio
from collections import OrderedDict
from collections.abc import AsyncIterable, Mapping, Sequence
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
from inspector_trace import Stage1Source, build_turn_trace, create_trace_part
from modes import (
    CHAT_MODES,
    LlmCaller,
    LlmToolTurn,
    LlmTurn,
    PlaygroundSettings,
    RenderMode,
    RenderResult,
    TurnMetrics,
    format_decision_ms,
    status_surface_id,
    surface_id_for,
)
from ratings import (
    RATINGS_PATH,
    RatingRecord,
    append_rating,
    summarize_ratings,
)
from renderers import Renderers, build_named_backend
from stage1 import (
    TOOL_MODE_INSTRUCTION,
    UI_ACTION_PREFIX,
    extract_block,
    extract_pasted_json,
    stage1_instruction,
    stage1_user_text,
)
from tools import (
    EXAMPLE_TOOL_NAMES,
    TOOL_ACTIONS,
    TOOL_INTENTS,
    TOOL_MUTABLE_PATHS,
    TOOLS,
    run_example_tool,
)

logger = logging.getLogger(__name__)

_STAGE1_KEY = "stage1"
_MAX_SESSIONS = 100
_VERSIONS = ("0.9", "1.0")
_SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]
_DEFAULT_THINKING_BUDGET = 1000


def default_model_name() -> str:
    """Resolves the stage-1 model name from environment variables or defaults.

    Returns:
        The model identifier string without a provider prefix.
    """
    model_env = (
        os.getenv("MODEL_NAME") or os.getenv("LITELLM_MODEL") or "gemini-3.6-flash"
    )
    return model_env.split("/")[-1]


def default_thinking_budget() -> int:
    """Resolves the maximum thinking token budget per ADK Gemini call.

    Returns:
        The configured integer thinking budget, defaulting to 1000.
    """
    raw = os.getenv("A2UI_PLAYGROUND_THINKING_BUDGET")
    return int(raw) if raw is not None else _DEFAULT_THINKING_BUDGET


class AdkLlmCaller:
    """`LlmCaller` implementation over ADK with one `Runner` per instruction key."""

    def __init__(
        self,
        model_name: str,
        app_name: str,
        user_id: str = "playground",
        *,
        thinking_budget: int | None = None,
    ) -> None:
        """Initializes the ADK caller with model and session settings.

        Args:
            model_name: Gemini model identifier.
            app_name: ADK application name used for in-memory sessions.
            user_id: ADK user identifier used for in-memory sessions.
            thinking_budget: Optional thinking token budget override.
        """
        self._model_name = model_name
        self._app_name = app_name
        self._user_id = user_id
        self._thinking_budget = (
            default_thinking_budget() if thinking_budget is None else thinking_budget
        )
        self._runners: dict[str, Runner] = {}

    def _runner_for(
        self,
        instruction_key: str,
        instruction: str,
        tools: Sequence[Any] | None = None,
    ) -> Runner:
        """Returns a cached ADK `Runner` for `instruction_key` and `tools`.

        Args:
            instruction_key: Cache key identifying the system prompt.
            instruction: System instruction text for the `LlmAgent`.
            tools: Optional sequence of callable tools exposed to the agent.

        Returns:
            The cached or newly created `Runner`.
        """
        cache_key = f"{instruction_key}:{len(tools or ())}"
        runner = self._runners.get(cache_key)
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
                tools=list(tools) if tools else [],
                generate_content_config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=self._thinking_budget
                    )
                ),
            )
            runner = Runner(
                app_name=self._app_name,
                agent=agent,
                artifact_service=InMemoryArtifactService(),
                session_service=InMemorySessionService(),
                memory_service=InMemoryMemoryService(),
            )
            self._runners[cache_key] = runner
        return runner

    async def _session_for(self, runner: Runner, session_id: str | None) -> str:
        """Resolves or creates an in-memory ADK session on `runner`.

        Args:
            runner: Target ADK `Runner`.
            session_id: Existing session identifier, or `None` to allocate a
                fresh one-shot session identifier.

        Returns:
            The active session identifier string.
        """
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
        """Runs a text-only turn against the ADK `Runner`.

        Args:
            instruction_key: Cache key for the system instruction.
            instruction: System instruction text.
            user_text: User prompt text.
            session_id: Conversation session identifier, or `None` for a
                stateless stage-2 turn.

        Returns:
            The completed `LlmTurn` with response text, tokens, and latency.
        """
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
                _append_part_texts(event.content.parts, chunks)
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

    async def call_with_tools(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
        tools: Sequence[Any],
    ) -> LlmToolTurn:
        """Runs a tool-enabled turn against the ADK `Runner`.

        Args:
            instruction_key: Cache key for the system instruction.
            instruction: System instruction text.
            user_text: User prompt text.
            session_id: Conversation session identifier, or `None` for a
                stateless call.
            tools: Sequence of callable tools exposed to the model.

        Returns:
            The completed `LlmToolTurn` with invoked tool metadata and usage.
        """
        runner = self._runner_for(instruction_key, instruction, tools=tools)
        sid = await self._session_for(runner, session_id)
        started = time.perf_counter()
        chunks: list[str] = []
        tool_name: str | None = None
        tool_args: dict[str, Any] = {}
        tool_result: Any = None
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
                tool_name, tool_args, tool_result = _collect_tool_event_parts(
                    event.content.parts,
                    chunks,
                    tool_name,
                    tool_args,
                    tool_result,
                )
            usage = getattr(event, "usage_metadata", None)
            if usage is not None:
                prompt_tokens = int(usage.prompt_token_count or 0)
                output_tokens += int(usage.candidates_token_count or 0)

        if tool_name and tool_result is None:
            tool_result = _execute_fallback_tool(tools, tool_name, tool_args)

        return LlmToolTurn(
            tool_name=tool_name,
            arguments=tool_args,
            result=tool_result,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            latency_ms=(time.perf_counter() - started) * 1000.0,
            text="".join(chunks),
        )


def _append_part_texts(parts: Sequence[Any], chunks: list[str]) -> None:
    """Appends non-empty string `text` attributes from `parts` onto `chunks`.

    Args:
        parts: Sequence of GenAI content part objects.
        chunks: Mutable list accumulating string fragments.
    """
    for part in parts:
        p_text = getattr(part, "text", None)
        if isinstance(p_text, str) and p_text:
            chunks.append(p_text)


def _collect_tool_event_parts(
    parts: Sequence[Any],
    chunks: list[str],
    tool_name: str | None,
    tool_args: dict[str, Any],
    tool_result: Any,
) -> tuple[str | None, dict[str, Any], Any]:
    """Collects text chunks, function call args, and function responses from `parts`.

    Args:
        parts: Sequence of GenAI content part objects from a runner event.
        chunks: Mutable list accumulating text fragments.
        tool_name: Previously observed tool name, if any.
        tool_args: Previously observed tool arguments dictionary.
        tool_result: Previously observed tool response payload, if any.

    Returns:
        An updated `(tool_name, tool_args, tool_result)` tuple.
    """
    for part in parts:
        p_text = getattr(part, "text", None)
        if isinstance(p_text, str):
            chunks.append(p_text)
        fn_call = getattr(part, "function_call", None)
        if fn_call:
            tool_name = fn_call.name
            tool_args = dict(fn_call.args or {})
        fn_resp = getattr(part, "function_response", None)
        if fn_resp:
            tool_result = fn_resp.response
    return tool_name, tool_args, tool_result


def _execute_fallback_tool(
    tools: Sequence[Any], tool_name: str, tool_args: dict[str, Any]
) -> Any:
    """Invokes the matching callable in `tools` when the runner returned no response.

    Args:
        tools: Sequence of registered tool callables.
        tool_name: Name of the tool function to invoke.
        tool_args: Keyword arguments to pass to the tool function.

    Returns:
        The tool's return value, or `None` if not found or if execution failed.
    """
    for tool in tools:
        if getattr(tool, "__name__", None) == tool_name:
            try:
                return tool(**tool_args)
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.warning("Failed executing tool %s: %s", tool_name, exc)
                return None
    return None


def _classify_stage1_source(query: str) -> Stage1Source:
    """Classifies whether `query` came from pasted JSON or a normal/action LLM turn.

    Args:
        query: Incoming stage-1 query text.

    Returns:
        `"pasted_json"` when `query` is not a UI action report and embeds JSON,
        otherwise `"llm"`.
    """
    if (
        not query.startswith(UI_ACTION_PREFIX)
        and extract_pasted_json(query) is not None
    ):
        return "pasted_json"
    return "llm"


class PlaygroundAgent:
    """Chat agent that renders one request through the chosen inference mode.

    Attributes:
        base_url: Base HTTP URL advertised in the A2A `AgentCard`.
        model_name: Stage-1 and stage-2 language model identifier.
        default_mode: Initial `RenderMode` for new conversation sessions.
        llm: `LlmCaller` used for stage-1, stage-2, and tool-mode calls.
        renderers: `Renderers` registry managing format processors and state.
        agent_card: Published A2A `AgentCard` with A2UI extension metadata.
    """

    def __init__(
        self,
        base_url: str,
        *,
        llm: LlmCaller | None = None,
        renderers: Renderers | None = None,
        model_name: str | None = None,
        default_mode: RenderMode = RenderMode.DECISION,
    ) -> None:
        """Initializes the playground agent and its per-version renderers.

        Args:
            base_url: Base HTTP URL for the agent card.
            llm: Optional custom `LlmCaller` (defaults to `AdkLlmCaller`).
            renderers: Optional preconfigured `Renderers` instance.
            model_name: Optional language model name override.
            default_mode: Default `RenderMode` for new conversations.
        """
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
        self._last_turn: OrderedDict[
            str, tuple[str, list[tuple[RenderMode, RenderResult, TurnMetrics]]]
        ] = OrderedDict()
        self.agent_card = self._build_agent_card()

    def _build_agent_card(self) -> AgentCard:
        """Constructs the A2A `AgentCard` advertising A2UI extensions.

        Returns:
            The configured `AgentCard`.
        """
        extensions = [
            get_a2ui_agent_extension(
                version,
                supported_catalog_ids=[
                    c.catalog_id
                    for c in self.renderers.processor(
                        RenderMode.EXPRESS, version
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

    # Per-conversation state helpers.

    def _settings_for(self, session_id: str) -> PlaygroundSettings:
        """Returns or initializes `PlaygroundSettings` for `session_id`.

        Args:
            session_id: Conversation session identifier.

        Returns:
            The active `PlaygroundSettings` for `session_id`.
        """
        settings = self._settings.get(session_id)
        if settings is None:
            settings = PlaygroundSettings(mode=self.default_mode)
            self._remember(self._settings, session_id, settings)
        return settings

    @staticmethod
    def _remember(store: OrderedDict[str, Any], key: str, value: Any) -> None:
        """Inserts or updates `key` in an LRU `OrderedDict` capped at `_MAX_SESSIONS`.

        Args:
            store: Target `OrderedDict` session store.
            key: Conversation session identifier.
            value: Value to store under `key`.
        """
        store[key] = value
        store.move_to_end(key)
        while len(store) > _MAX_SESSIONS:
            store.popitem(last=False)

    # Reply construction helpers.

    def _status(
        self,
        lines: Sequence[str],
        settings: PlaygroundSettings,
        version: str,
        suffix: str = "status",
    ) -> list[Part]:
        """Renders `lines` as a per-turn A2UI status surface.

        Args:
            lines: Markdown text lines to render.
            settings: Active conversation settings.
            version: A2UI protocol version string.
            suffix: Surface identifier suffix.

        Returns:
            A list of A2UI `Part` wrappers for the status surface.
        """
        return self.renderers.status_surface(
            lines,
            surface_id=status_surface_id(settings, suffix),
            version=version,
        )

    def _trace_part(
        self,
        *,
        turn: int,
        query: str,
        compare: bool,
        active_mode: RenderMode,
        stage1_source: Stage1Source,
        stage1_turn: LlmTurn | None,
        tool_name: str | None,
        tool_args: Mapping[str, Any] | None,
        block: DecisionBlock | None,
        stage1_error: str | None,
        candidates: Sequence[tuple[RenderMode, str, RenderResult, TurnMetrics]],
        version: str,
    ) -> Part:
        """Builds an in-band `application/x-a2ui-playground-trace+json` `DataPart`.

        Args:
            turn: 1-based turn number.
            query: User query or slash command for the turn.
            compare: Whether the turn rendered all three comparison modes.
            active_mode: Active `RenderMode` for the turn.
            stage1_source: How the `DecisionBlock` was produced.
            stage1_turn: Stage-1 `LlmTurn`, or `None` for direct tool calls.
            tool_name: Invoked tool name in `tool` mode, or `None`.
            tool_args: Invoked tool arguments in `tool` mode, or `None`.
            block: Extracted or constructed `DecisionBlock`, or `None`.
            stage1_error: Stage-1 error string, or `None`.
            candidates: Rendered `(mode, surface_id, result, metrics)` tuples.
            version: Negotiated A2UI protocol version string.

        Returns:
            An A2A `Part` wrapping the serialized `PlaygroundTurnTrace`.
        """
        return create_trace_part(
            build_turn_trace(
                turn=turn,
                query=query,
                compare=compare,
                active_mode=active_mode,
                stage1_source=stage1_source,
                model_name=self.model_name,
                stage1_turn=stage1_turn,
                tool_name=tool_name,
                tool_args=tool_args,
                block=block,
                stage1_error=stage1_error,
                candidates=candidates,
                synthesizer=self.renderers.synthesizer_or_none(version),
            )
        )

    def _finalize_tool_parts(
        self,
        *,
        query: str,
        settings: PlaygroundSettings,
        version: str,
        surface_id: str,
        result: RenderResult,
        metrics: TurnMetrics,
        stage1_source: Stage1Source,
        stage1_turn: LlmTurn | None,
        tool_name: str,
        tool_args: Mapping[str, Any],
        block: DecisionBlock,
        inspector_enabled: bool,
    ) -> list[Part]:
        """Packages a rendered tool result with either a footer or an inspector trace.

        Args:
            query: User query or `/tool <name>` command.
            settings: Updated conversation settings for the turn.
            version: A2UI protocol version string.
            surface_id: Target A2UI surface identifier.
            result: Completed `RenderResult` from `render_tool_result`.
            metrics: Combined `TurnMetrics` for the turn.
            stage1_source: `"direct_tool"` or `"tool_call"`.
            stage1_turn: Stage-1 `LlmTurn` when an LLM selected the tool.
            tool_name: Canonical tool function name.
            tool_args: Arguments passed to the tool.
            block: Constructed `DecisionBlock` for the tool output.
            inspector_enabled: Whether the client requested an in-band trace.

        Returns:
            A list of A2A `Part` items for the response.
        """
        parts = list(result.parts)
        if not inspector_enabled:
            footer_lines = [metrics.footer()]
            if result.error:
                footer_lines.append(f"Render failed: {result.error}")
            parts.extend(
                self._status(footer_lines, settings, version, suffix="tool-footer")
            )
            return parts
        if not result.parts:
            parts.extend(
                self._status(
                    [f"Render failed: {result.error or 'no surface produced'}"],
                    settings,
                    version,
                )
            )
        parts.append(
            self._trace_part(
                turn=settings.turn,
                query=query,
                compare=False,
                active_mode=RenderMode.TOOL,
                stage1_source=stage1_source,
                stage1_turn=stage1_turn,
                tool_name=tool_name,
                tool_args=tool_args,
                block=block,
                stage1_error=None,
                candidates=[(RenderMode.TOOL, surface_id, result, metrics)],
                version=version,
            )
        )
        return parts

    async def stream(
        self,
        query: str,
        session_id: str,
        ui_version: str | None,
        *,
        inspector_enabled: bool = False,
    ) -> AsyncIterable[dict[str, Any]]:
        """Handles one chat message and yields a single final response item.

        Args:
            query: User query, slash command, or formatted action/payload text.
            session_id: A2A conversation context identifier.
            ui_version: Negotiated A2UI protocol version, or `None` if missing.
            inspector_enabled: Whether to omit inline footers and attach an
                in-band `PlaygroundTurnTrace` `DataPart`.

        Yields:
            A dictionary with `is_task_complete=True` and response `parts`.
        """
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
            parts = await self._run_command(
                command,
                session_id,
                settings,
                ui_version,
                inspector_enabled=inspector_enabled,
            )
        elif settings.mode is RenderMode.TOOL and not settings.compare:
            parts = await self._render_tool_turn(
                query,
                session_id,
                settings,
                ui_version,
                inspector_enabled=inspector_enabled,
            )
        else:
            parts = await self._render_turn(
                query,
                session_id,
                settings,
                ui_version,
                inspector_enabled=inspector_enabled,
            )
        yield {"is_task_complete": True, "parts": parts}

    async def _run_command(
        self,
        command: Any,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
        *,
        inspector_enabled: bool = False,
    ) -> list[Part]:
        """Executes a slash command and returns its response parts.

        Args:
            command: Parsed `Command` instance.
            session_id: Conversation session identifier.
            settings: Current conversation settings.
            version: Negotiated A2UI protocol version string.
            inspector_enabled: Whether the client requested an in-band trace.

        Returns:
            A list of A2A `Part` items for the command response.
        """
        if command.name == "tool":
            return await self._render_direct_tool(
                command.argument,
                session_id,
                settings,
                version,
                inspector_enabled=inspector_enabled,
            )
        new_settings, reply = apply_command(command, settings)
        self._remember(self._settings, session_id, new_settings)
        if command.name == "help":
            lines = help_text(
                new_settings, self.renderers.backend_name, self.model_name
            )
            if command.argument and command.argument.startswith("unknown:"):
                lines.insert(
                    0, f"Unknown command `{command.argument[len('unknown:') :]}`."
                )
        elif command.name == "backend":
            lines = await self._switch_backend(command.argument)
        elif command.name == "trace":
            lines = list(self._last_trace.get(session_id, ())) or [
                "No decision turn yet. Render something in `decision` mode first."
            ]
        elif command.name == "rate":
            lines = await self._rate_turn(session_id, command.argument, command.text)
        elif command.name == "ratings":
            lines = await self._show_ratings()
        else:
            lines = [reply or ""]
        return self._status(lines, new_settings, version)

    async def _render_direct_tool(
        self,
        argument: str | None,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
        *,
        inspector_enabled: bool = False,
    ) -> list[Part]:
        """Executes a named example tool and renders its result with zero LLM calls.

        Args:
            argument: Tool alias or function name passed to `/tool`.
            session_id: Conversation session identifier.
            settings: Current conversation settings.
            version: Negotiated A2UI protocol version string.
            inspector_enabled: Whether the client requested an in-band trace.

        Returns:
            A list of A2A `Part` items containing the rendered surface and
            footer or inspector trace.
        """
        choices = ", ".join(EXAMPLE_TOOL_NAMES)
        if not argument:
            return self._status(
                [f"Usage: `/tool <name>` (choose {choices})."], settings, version
            )
        # Direct tool execution always targets a single tool render on "main"
        # and clears any pending one-shot /compare flag.
        next_settings = PlaygroundSettings(mode=settings.mode, turn=settings.turn + 1)
        invoked = run_example_tool(argument, next_settings.turn)
        if invoked is None:
            return self._status(
                [f"Unknown tool `{argument}`; choose {choices}."], settings, version
            )
        tool_name, payload = invoked
        surface_id = surface_id_for(next_settings, RenderMode.TOOL)
        intent = TOOL_INTENTS[tool_name]
        mutable_paths = tuple(TOOL_MUTABLE_PATHS.get(tool_name, ()))
        actions = tuple(TOOL_ACTIONS.get(tool_name, ()))
        block = DecisionBlock(
            intent=intent,
            payload=payload,
            mutable_paths=mutable_paths,
            actions=actions,
        )
        result = await self.renderers.render_tool_result(
            intent,
            payload,
            surface_id=surface_id,
            version=version,
            mutable_paths=mutable_paths,
            actions=actions,
            conversation_id=session_id,
        )
        metrics = result.metrics or TurnMetrics(
            mode=RenderMode.TOOL,
            backend=self.renderers.backend_kind,
            llm_calls=0,
            latency_ms=0.0,
        )
        if result.trace_lines:
            self._remember(self._last_trace, session_id, result.trace_lines)
        self._remember(
            self._last_turn,
            session_id,
            (f"/tool {tool_name}", [(RenderMode.TOOL, result, metrics)]),
        )
        self._remember(self._settings, session_id, next_settings)
        return self._finalize_tool_parts(
            query=f"/tool {tool_name}",
            settings=next_settings,
            version=version,
            surface_id=surface_id,
            result=result,
            metrics=metrics,
            stage1_source="direct_tool",
            stage1_turn=None,
            tool_name=tool_name,
            tool_args={},
            block=block,
            inspector_enabled=inspector_enabled,
        )

    async def _switch_backend(self, argument: str | None) -> list[str]:
        """Switches the active decision backend to the preset named by `argument`.

        Args:
            argument: Backend preset name (`"jev"`, `"gemini"`, or `"mock"`).

        Returns:
            Status lines reporting the active or newly configured backend.
        """
        if not argument:
            choices = ", ".join(DECISION_BACKENDS)
            return [
                f"`/backend` needs a backend name: choose {choices}.",
                f"Active decision backend: `{self.renderers.backend_name}`.",
            ]
        try:
            backend = build_named_backend(argument)
        except ValueError as exc:
            return [str(exc)]
        await self.renderers.set_backend(backend)
        return [f"Decision backend set to `{self.renderers.backend_name}`."]

    async def _render_mode_candidates(
        self,
        modes: Sequence[RenderMode],
        block: DecisionBlock,
        stage1: LlmTurn,
        settings: PlaygroundSettings,
        version: str,
        session_id: str,
        *,
        inspector_enabled: bool,
    ) -> tuple[
        list[Part],
        list[tuple[RenderMode, RenderResult, TurnMetrics]],
        list[tuple[RenderMode, str, RenderResult, TurnMetrics]],
    ]:
        """Renders `block` across `modes` and collects surface parts and metrics.

        Args:
            modes: Sequence of render modes to execute (1 for normal turns, 3
                for `/compare`).
            block: Extracted stage-1 `DecisionBlock`.
            stage1: Completed stage-1 `LlmTurn`.
            settings: Active conversation settings for this turn.
            version: Negotiated A2UI protocol version string.
            session_id: Conversation session identifier.
            inspector_enabled: Whether inline footers and compare cards should
                be omitted in favor of an inspector trace.

        Returns:
            A `(parts, turn_candidates, trace_candidates)` tuple.
        """
        parts: list[Part] = []
        results: list[tuple[RenderMode, RenderResult]] = []
        turn_candidates: list[tuple[RenderMode, RenderResult, TurnMetrics]] = []
        trace_candidates: list[tuple[RenderMode, str, RenderResult, TurnMetrics]] = []
        for mode in modes:
            surface_id = surface_id_for(settings, mode)
            result = await self._render_mode(mode, block, settings, version, session_id)
            results.append((mode, result))
            parts.extend(result.parts)
            if not inspector_enabled:
                parts.extend(
                    self._footer_parts(mode, result, stage1, settings, version)
                )
            if mode is RenderMode.DECISION and result.trace_lines:
                self._remember(self._last_trace, session_id, result.trace_lines)
            cand_metrics = (
                result.metrics
                or TurnMetrics(mode=mode, backend="llm", llm_calls=0, latency_ms=0.0)
            ).plus_stage1(stage1)
            turn_candidates.append((mode, result, cand_metrics))
            trace_candidates.append((mode, surface_id, result, cand_metrics))
        if not inspector_enabled and settings.compare:
            parts.extend(self._compare_summary(results, stage1, settings, version))
        elif inspector_enabled and all(not res.parts for _, res in results):
            error_lines = [
                f"Render failed ({m.value}): {r.error or 'no surface produced'}"
                for m, r in results
            ]
            parts.extend(self._status(error_lines, settings, version))
        return parts, turn_candidates, trace_candidates

    async def _render_turn(
        self,
        query: str,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
        *,
        inspector_enabled: bool = False,
    ) -> list[Part]:
        """Runs a two-stage chat render turn (`decision`, `express`, `direct`, or `/compare`).

        Args:
            query: User message text.
            session_id: Conversation session identifier.
            settings: Current conversation settings.
            version: Negotiated A2UI protocol version string.
            inspector_enabled: Whether to attach an in-band inspector trace.

        Returns:
            A list of A2A `Part` items for the completed turn.
        """
        settings = settings.next_turn()
        stage1_source = _classify_stage1_source(query)
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
            parts = self._status([f"Stage 1 failed: {exc}"], settings, version)
            if inspector_enabled:
                parts.append(
                    self._trace_part(
                        turn=settings.turn,
                        query=query,
                        compare=settings.compare,
                        active_mode=settings.mode,
                        stage1_source=stage1_source,
                        stage1_turn=None,
                        tool_name=None,
                        tool_args=None,
                        block=None,
                        stage1_error=f"Stage 1 failed: {exc}",
                        candidates=(),
                        version=version,
                    )
                )
            return parts
        block = extract_block(stage1.text)
        if block is None:
            self._remember(self._settings, session_id, settings)
            prose = stage1.text.strip() or "(empty reply)"
            parts = self._status(
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
            if inspector_enabled:
                parts.append(
                    self._trace_part(
                        turn=settings.turn,
                        query=query,
                        compare=settings.compare,
                        active_mode=settings.mode,
                        stage1_source=stage1_source,
                        stage1_turn=stage1,
                        tool_name=None,
                        tool_args=None,
                        block=None,
                        stage1_error=f"Could not extract decision block: {prose[:500]}",
                        candidates=(),
                        version=version,
                    )
                )
            return parts
        modes = list(CHAT_MODES) if settings.compare else [settings.mode]
        parts, turn_candidates, trace_candidates = await self._render_mode_candidates(
            modes,
            block,
            stage1,
            settings,
            version,
            session_id,
            inspector_enabled=inspector_enabled,
        )
        if inspector_enabled:
            parts.append(
                self._trace_part(
                    turn=settings.turn,
                    query=query,
                    compare=settings.compare,
                    active_mode=settings.mode,
                    stage1_source=stage1_source,
                    stage1_turn=stage1,
                    tool_name=None,
                    tool_args=None,
                    block=block,
                    stage1_error=None,
                    candidates=trace_candidates,
                    version=version,
                )
            )
        self._remember(self._last_turn, session_id, (query, turn_candidates))
        self._remember(
            self._settings,
            session_id,
            settings.__class__(mode=settings.mode, turn=settings.turn),
        )
        return parts

    def _no_tool_parts(
        self,
        query: str,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
        tool_turn: LlmToolTurn,
        *,
        inspector_enabled: bool,
    ) -> list[Part]:
        """Builds status and trace parts when a `tool` mode turn invoked no tool.

        Args:
            query: User message text.
            session_id: Conversation session identifier.
            settings: Updated conversation settings for the turn.
            version: Negotiated A2UI protocol version string.
            tool_turn: Completed `LlmToolTurn` with no tool call.
            inspector_enabled: Whether to attach an in-band inspector trace.

        Returns:
            A list of A2A `Part` items for the prose reply.
        """
        self._remember(self._settings, session_id, settings)
        prose = tool_turn.text.strip() or "No relevant tool was found for that request."
        metrics = TurnMetrics(
            mode=RenderMode.TOOL,
            backend="llm",
            llm_calls=1,
            latency_ms=tool_turn.latency_ms,
            prompt_tokens=tool_turn.prompt_tokens,
            output_tokens=tool_turn.output_tokens,
        )
        parts = self._status([prose], settings, version)
        if not inspector_enabled:
            parts.extend(
                self._status(
                    [metrics.footer()], settings, version, suffix="tool-footer"
                )
            )
        self._remember(
            self._last_turn,
            session_id,
            (
                query,
                [(
                    RenderMode.TOOL,
                    RenderResult(parts=list(parts), metrics=metrics),
                    metrics,
                )],
            ),
        )
        if inspector_enabled:
            stage1_equivalent = LlmTurn(
                text=tool_turn.text,
                prompt_tokens=tool_turn.prompt_tokens,
                output_tokens=tool_turn.output_tokens,
                latency_ms=tool_turn.latency_ms,
            )
            parts.append(
                self._trace_part(
                    turn=settings.turn,
                    query=query,
                    compare=False,
                    active_mode=RenderMode.TOOL,
                    stage1_source="tool_call",
                    stage1_turn=stage1_equivalent,
                    tool_name=None,
                    tool_args=None,
                    block=None,
                    stage1_error=None,
                    candidates=(),
                    version=version,
                )
            )
        return parts

    async def _render_tool_turn(
        self,
        query: str,
        session_id: str,
        settings: PlaygroundSettings,
        version: str,
        *,
        inspector_enabled: bool = False,
    ) -> list[Part]:
        """Runs a `tool` mode turn where the LLM selects a tool and the decision model renders it.

        Args:
            query: User message text.
            session_id: Conversation session identifier.
            settings: Current conversation settings.
            version: Negotiated A2UI protocol version string.
            inspector_enabled: Whether to attach an in-band inspector trace.

        Returns:
            A list of A2A `Part` items for the completed tool turn.
        """
        settings = settings.next_turn()
        try:
            tool_turn = await self.llm.call_with_tools(
                instruction_key="tool_mode",
                instruction=TOOL_MODE_INSTRUCTION,
                user_text=query,
                session_id=session_id,
                tools=TOOLS,
            )
        except Exception as exc:  # the model call itself failed; keep the chat alive
            logger.exception("Tool mode call failed")
            self._remember(self._settings, session_id, settings)
            parts = self._status([f"Tool call failed: {exc}"], settings, version)
            if inspector_enabled:
                parts.append(
                    self._trace_part(
                        turn=settings.turn,
                        query=query,
                        compare=False,
                        active_mode=RenderMode.TOOL,
                        stage1_source="tool_call",
                        stage1_turn=None,
                        tool_name=None,
                        tool_args=None,
                        block=None,
                        stage1_error=f"Tool call failed: {exc}",
                        candidates=(),
                        version=version,
                    )
                )
            return parts

        if not tool_turn.tool_name or tool_turn.result is None:
            return self._no_tool_parts(
                query,
                session_id,
                settings,
                version,
                tool_turn,
                inspector_enabled=inspector_enabled,
            )

        surface_id = surface_id_for(settings, RenderMode.TOOL)
        tool_result = tool_turn.result
        intent = TOOL_INTENTS.get(tool_turn.tool_name, "Tool Result")
        mutable_paths = tuple(TOOL_MUTABLE_PATHS.get(tool_turn.tool_name, ()))
        actions = tuple(TOOL_ACTIONS.get(tool_turn.tool_name, ()))
        block = DecisionBlock(
            intent=intent,
            payload=tool_result,
            mutable_paths=mutable_paths,
            actions=actions,
        )

        result = await self.renderers.render_tool_result(
            intent,
            tool_result,
            surface_id=surface_id,
            version=version,
            mutable_paths=mutable_paths,
            actions=actions,
            conversation_id=session_id,
        )

        stage1_equivalent = LlmTurn(
            text=tool_turn.text,
            prompt_tokens=tool_turn.prompt_tokens,
            output_tokens=tool_turn.output_tokens,
            latency_ms=tool_turn.latency_ms,
        )
        base_metrics = result.metrics or TurnMetrics(
            mode=RenderMode.TOOL,
            backend=self.renderers.backend_kind,
            llm_calls=0,
            latency_ms=0.0,
        )
        metrics = base_metrics.plus_stage1(stage1_equivalent)

        if result.trace_lines:
            self._remember(self._last_trace, session_id, result.trace_lines)

        self._remember(
            self._last_turn,
            session_id,
            (query, [(RenderMode.TOOL, result, metrics)]),
        )
        self._remember(
            self._settings,
            session_id,
            settings.__class__(mode=settings.mode, turn=settings.turn),
        )
        return self._finalize_tool_parts(
            query=query,
            settings=settings,
            version=version,
            surface_id=surface_id,
            result=result,
            metrics=metrics,
            stage1_source="tool_call",
            stage1_turn=stage1_equivalent,
            tool_name=tool_turn.tool_name,
            tool_args=tool_turn.arguments,
            block=block,
            inspector_enabled=inspector_enabled,
        )

    async def _rate_turn(
        self, session_id: str, argument: str | None, comment: str | None
    ) -> list[str]:
        """Records a user preference rating for the last turn in `session_id`.

        Args:
            session_id: Conversation session identifier.
            argument: Winning render mode name.
            comment: Optional free-form feedback comment.

        Returns:
            Status lines confirming or rejecting the rating.
        """
        if not argument:
            return [
                "Usage: `/rate <mode> [comment]` (e.g. `/rate decision Looks cleaner`)."
            ]
        winner = argument.lower()
        if winner not in [m.value for m in RenderMode]:
            choices = ", ".join(m.value for m in RenderMode)
            return [f"Unknown mode `{winner}`; choose {choices}."]
        last_turn = self._last_turn.get(session_id)
        if last_turn is None:
            return ["No previous turn to rate. Render an interface first."]
        query, candidates = last_turn
        candidate_modes = [mode.value for mode, _, _ in candidates]
        if winner not in candidate_modes:
            rendered = ", ".join(f"`{m}`" for m in candidate_modes)
            return [
                f"Mode `{winner}` was not rendered in the previous turn (rendered:"
                f" {rendered})."
            ]
        candidate_dicts = [
            {
                "mode": mode.value,
                "ok": res.ok,
                "error": res.error,
                "latency_ms": metrics.latency_ms,
                "llm_calls": metrics.llm_calls,
                "output_tokens": metrics.output_tokens,
            }
            for mode, res, metrics in candidates
        ]
        record = RatingRecord(
            session_id=session_id,
            request=query,
            winner=winner,
            comment=comment or "",
            candidates=candidate_dicts,
        )
        try:
            await asyncio.to_thread(append_rating, RATINGS_PATH, record)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.warning("Failed appending rating: %s", exc)
            return [f"Failed saving rating: {exc}"]
        suffix = f" with comment: {comment}" if comment else ""
        return [f"Recorded preference for `{winner}`{suffix}."]

    async def _show_ratings(self) -> list[str]:
        """Summarizes recorded mode preference win counts from `RATINGS_PATH`.

        Returns:
            Status lines listing win counts and percentages per mode.
        """
        wins = await asyncio.to_thread(summarize_ratings, RATINGS_PATH)
        if not wins:
            return ["No ratings recorded yet. Use `/rate <mode> [comment]` to vote."]
        total = sum(wins.values())
        lines = [
            f"**Mode preferences** ({total} total vote{'s' if total != 1 else ''}):"
        ]
        for mode in RenderMode:
            count = wins.get(mode.value, 0)
            pct = (count / total * 100.0) if total > 0 else 0.0
            lines.append(f"- `{mode.value}`: {count} ({pct:.1f}%)")
        return lines

    async def _render_mode(
        self,
        mode: RenderMode,
        block: DecisionBlock,
        settings: PlaygroundSettings,
        version: str,
        session_id: str,
    ) -> RenderResult:
        """Dispatches `block` to the renderer for `mode`.

        Args:
            mode: Target `RenderMode`.
            block: Decision block to render.
            settings: Active conversation settings.
            version: Negotiated A2UI protocol version string.
            session_id: Conversation session identifier.

        Returns:
            The resulting `RenderResult`.
        """
        surface_id = surface_id_for(settings, mode)
        # Compare turns render fresh per-turn surfaces, so they skip the
        # conversation's surface state.
        conversation_id = None if settings.compare else session_id
        try:
            if mode is RenderMode.DECISION:
                return await self.renderers.render_decision(
                    block,
                    surface_id=surface_id,
                    version=version,
                    conversation_id=conversation_id,
                )
            if mode is RenderMode.TOOL:
                return await self.renderers.render_tool_result(
                    block.intent,
                    block.payload,
                    surface_id=surface_id,
                    version=version,
                    mutable_paths=block.mutable_paths,
                    actions=block.actions,
                    conversation_id=conversation_id,
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
        """Builds the inline footer surface parts for `result` when the inspector is off.

        Args:
            mode: Render mode that produced `result`.
            result: Completed `RenderResult`.
            stage1: Completed stage-1 `LlmTurn`.
            settings: Active conversation settings.
            version: Negotiated A2UI protocol version string.

        Returns:
            A list of A2UI `Part` wrappers for the footer surface.
        """
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
        """Builds the inline `/compare` summary card when the inspector is off.

        Args:
            results: Sequence of `(mode, result)` pairs across `CHAT_MODES`.
            stage1: Completed stage-1 `LlmTurn`.
            settings: Active conversation settings.
            version: Negotiated A2UI protocol version string.

        Returns:
            A list of A2UI `Part` wrappers for the compare summary surface.
        """
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

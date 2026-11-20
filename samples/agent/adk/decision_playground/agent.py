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

"""Session-aware orchestrator for the A2UI decision playground."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
import json
from typing import Any

from commands import (
    VALID_BACKENDS,
    ParsedCommand,
    format_help,
    parse_budget_ms,
    parse_command,
    parse_render_mode,
)
from modes import COMPARE_MODES, PlaygroundSettings, RenderMode, RenderOutcome
from renderers import PlaygroundRenderers
from surfaces import (
    RPC_FORM_ALIASES,
    RPC_FORM_BY_ALIAS,
    build_rpc_form_messages,
    build_status_card_messages,
)
from tools import TOOL_ALIASES, TOOL_BY_ALIAS
from trace_adapter import build_candidate_trace, build_turn_trace

_MAX_SESSIONS = 128


@dataclass(frozen=True)
class AgentTurnResult:
    """Wire messages and optional inspector trace produced by one turn."""

    messages: list[dict[str, Any]]
    trace: dict[str, Any] | None = None


class PlaygroundAgent:
    """Routes slash commands, Wave 1 turns, and RPC calls per `context_id`."""

    def __init__(
        self,
        renderers: PlaygroundRenderers,
        *,
        initial_mode: RenderMode = RenderMode.CASCADE,
    ) -> None:
        self._renderers = renderers
        self._initial_mode = initial_mode
        self._sessions: OrderedDict[str, PlaygroundSettings] = OrderedDict()
        self._last_trace: dict[str, dict[str, Any]] = {}

    def get_settings(self, context_id: str) -> PlaygroundSettings:
        """Returns or initializes `PlaygroundSettings` for `context_id`."""
        settings = self._sessions.get(context_id)
        if settings is not None:
            self._sessions.move_to_end(context_id)
            return settings
        while len(self._sessions) >= _MAX_SESSIONS:
            evicted, _ = self._sessions.popitem(last=False)
            self._last_trace.pop(evicted, None)
        settings = PlaygroundSettings(
            mode=self._initial_mode,
            backend_kind=self._renderers.backend_kind,
        )
        self._sessions[context_id] = settings
        return settings

    def _set_settings(self, context_id: str, settings: PlaygroundSettings) -> None:
        self._sessions[context_id] = settings
        self._sessions.move_to_end(context_id)

    async def handle_rpc_messages(
        self,
        rpc_messages: Sequence[Mapping[str, Any]],
        *,
        context_id: str,
        include_trace: bool = False,
    ) -> AgentTurnResult:
        """Handles incoming `callAgentFunction` envelopes without calling an LLM."""
        settings = self.get_settings(context_id).next_turn()
        self._set_settings(context_id, settings)
        outcome, calls = await self._renderers.run_rpc_call(
            rpc_messages, session_id=context_id
        )
        candidate = build_candidate_trace(
            outcome,
            calls,
            backend_kind=self._renderers.backend_kind,
            model_id=self._renderers.model_id,
            endpoint_url=self._renderers.endpoint_url,
        )
        trace = build_turn_trace(
            turn=settings.turn,
            query="callAgentFunction",
            active_mode=settings.mode,
            compare=False,
            stage1_source="pasted_json",
            tool_name=None,
            payload=list(rpc_messages),
            candidates=[candidate],
        )
        self._last_trace[context_id] = trace
        return AgentTurnResult(
            messages=list(outcome.messages),
            trace=trace if include_trace else None,
        )

    async def handle_text_turn(
        self,
        text: str,
        *,
        context_id: str,
        pasted_payload: Any = None,
        include_trace: bool = False,
    ) -> AgentTurnResult:
        """Handles one text prompt, slash command, or pasted JSON payload."""
        cmd = parse_command(text)
        if cmd is not None:
            return await self._handle_command(
                cmd, context_id=context_id, include_trace=include_trace
            )
        return await self._handle_render_turn(
            text,
            context_id=context_id,
            pasted_payload=pasted_payload,
            include_trace=include_trace,
        )

    async def _handle_command(
        self,
        cmd: ParsedCommand,
        *,
        context_id: str,
        include_trace: bool,
    ) -> AgentTurnResult:
        settings = self.get_settings(context_id)
        if cmd.kind == "mode":
            return self._cmd_mode(cmd.arg, context_id, settings, include_trace)
        if cmd.kind == "backend":
            return await self._cmd_backend(cmd.arg, context_id, settings, include_trace)
        if cmd.kind == "budget":
            return self._cmd_budget(cmd.arg, context_id, settings, include_trace)
        if cmd.kind == "tool":
            return await self._cmd_tool(cmd.arg, context_id, settings, include_trace)
        if cmd.kind == "form":
            return self._cmd_form(cmd.arg, context_id, settings, include_trace)
        if cmd.kind == "compare":
            updated = replace(settings, compare=True)
            self._set_settings(context_id, updated)
            return self._status_result(
                "Next prompt will compare `cascade`, `express`, and `direct`.",
                settings=updated,
                query=cmd.raw,
                include_trace=include_trace,
            )
        if cmd.kind == "trace":
            last = self._last_trace.get(context_id)
            body = (
                f"```json\n{json.dumps(last, indent=2)[:2400]}\n```"
                if last
                else "No decision trace recorded yet."
            )
            return self._status_result(
                body, settings=settings, query=cmd.raw, include_trace=include_trace
            )
        if cmd.kind == "help":
            help_md = format_help(
                mode=settings.mode,
                backend_kind=self._renderers.backend_kind,
                model_id=self._renderers.model_id,
                budget_ms=settings.budget_ms,
                tool_aliases=TOOL_ALIASES,
                form_aliases=RPC_FORM_ALIASES,
            )
            return self._status_result(
                help_md, settings=settings, query=cmd.raw, include_trace=include_trace
            )
        return self._status_result(
            f"Unknown command `{cmd.raw}`. Type `/help` for available commands.",
            settings=settings,
            query=cmd.raw,
            include_trace=include_trace,
            ok=False,
        )

    def _cmd_mode(
        self,
        arg: str,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        parsed = parse_render_mode(arg)
        if parsed is None:
            valid = ", ".join(m.value for m in RenderMode)
            return self._status_result(
                f"Unknown mode `{arg}`. Choose from: {valid}.",
                settings=settings,
                query=f"/mode {arg}",
                include_trace=include_trace,
                ok=False,
            )
        updated = replace(settings, mode=parsed)
        self._set_settings(context_id, updated)
        if parsed is RenderMode.RPC:
            return self._cmd_form("bug", context_id, updated, include_trace)
        return self._status_result(
            f"Switched active mode to `{parsed.value}`.",
            settings=updated,
            query=f"/mode {parsed.value}",
            include_trace=include_trace,
        )

    async def _cmd_backend(
        self,
        arg: str,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        target = arg.strip().lower()
        if target not in VALID_BACKENDS:
            return self._status_result(
                f"Unknown backend `{arg}`. Choose from: {', '.join(VALID_BACKENDS)}.",
                settings=settings,
                query=f"/backend {arg}",
                include_trace=include_trace,
                ok=False,
            )
        try:
            await self._renderers.set_backend(target)
        except Exception as exc:
            return self._status_result(
                f"Failed to switch backend to `{target}`: {exc}. Keeping"
                f" `{self._renderers.backend_kind}`.",
                settings=settings,
                query=f"/backend {target}",
                include_trace=include_trace,
                ok=False,
            )
        updated = replace(settings, backend_kind=self._renderers.backend_kind)
        self._set_settings(context_id, updated)
        return self._status_result(
            f"Switched decision backend to `{self._renderers.backend_kind}`"
            f" (`{self._renderers.model_id}`).",
            settings=updated,
            query=f"/backend {target}",
            include_trace=include_trace,
        )

    def _cmd_budget(
        self,
        arg: str,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        ok, budget = parse_budget_ms(arg)
        if not ok:
            return self._status_result(
                f"Invalid budget `{arg}`. Use a positive number in ms or `off`.",
                settings=settings,
                query=f"/budget {arg}",
                include_trace=include_trace,
                ok=False,
            )
        updated = replace(settings, budget_ms=budget)
        self._set_settings(context_id, updated)
        label = f"{budget:g} ms" if budget is not None else "off"
        return self._status_result(
            f"Set cascade latency budget to `{label}`.",
            settings=updated,
            query=f"/budget {arg}",
            include_trace=include_trace,
        )

    async def _cmd_tool(
        self,
        arg: str,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        alias = arg.strip().lower()
        entry = TOOL_BY_ALIAS.get(alias)
        if entry is None:
            return self._status_result(
                f"Unknown tool `{arg}`. Choose from: {', '.join(TOOL_ALIASES)}.",
                settings=settings,
                query=f"/tool {arg}",
                include_trace=include_trace,
                ok=False,
            )
        updated = settings.next_turn()
        active_mode = (
            RenderMode.BINDER if updated.mode is RenderMode.RPC else updated.mode
        )
        updated = replace(updated, mode=active_mode)
        self._set_settings(context_id, updated)
        payload = entry.fn()
        prompt_with_data = (
            f"{entry.intent}\n\nData:\n```json\n{json.dumps(payload, indent=2)}\n```"
        )
        if active_mode is RenderMode.CASCADE:
            outcome, calls = await self._renderers.run_cascade(
                prompt_with_data,
                surface_id="main",
                budget_ms=updated.budget_ms,
                session_id=context_id,
                data_payload=payload if isinstance(payload, Mapping) else None,
            )
        elif active_mode in (RenderMode.EXPRESS, RenderMode.DIRECT):
            outcome, calls = await self._renderers.run_baseline(
                prompt_with_data,
                mode=active_mode,
                surface_id=f"turn-{updated.turn}-{active_mode.value}",
                session_id=context_id,
            )
        else:
            outcome, calls = await self._renderers.run_binder_direct(
                intent=entry.intent,
                tool_name=entry.fn.__name__,
                tool_output=payload,
                actions=entry.actions,
                surface_id="main",
            )
        candidate = build_candidate_trace(
            outcome,
            calls,
            backend_kind=self._renderers.backend_kind,
            model_id=self._renderers.model_id,
            endpoint_url=self._renderers.endpoint_url,
        )
        trace = build_turn_trace(
            turn=updated.turn,
            query=f"/tool {alias}",
            active_mode=active_mode,
            compare=False,
            stage1_source="direct_tool",
            tool_name=entry.fn.__name__,
            payload=payload,
            candidates=[candidate],
        )
        self._last_trace[context_id] = trace
        return AgentTurnResult(
            messages=list(outcome.messages),
            trace=trace if include_trace else None,
        )

    def _cmd_form(
        self,
        arg: str,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        alias = arg.strip().lower() or "bug"
        form = RPC_FORM_BY_ALIAS.get(alias)
        if form is None:
            return self._status_result(
                f"Unknown form `{arg}`. Choose from: {', '.join(RPC_FORM_ALIASES)}.",
                settings=settings,
                query=f"/form {arg}",
                include_trace=include_trace,
                ok=False,
            )
        updated = replace(settings.next_turn(), mode=RenderMode.RPC)
        self._set_settings(context_id, updated)
        msgs = build_rpc_form_messages(form, surface_id="main")
        outcome = RenderOutcome(
            mode=RenderMode.RPC,
            surface_id="main",
            messages=tuple(msgs),
            stage="template_select",
            selected_template_id=f"rpc_form:{form.alias}",
        )
        candidate = build_candidate_trace(
            outcome,
            [],
            backend_kind=self._renderers.backend_kind,
            model_id=self._renderers.model_id,
            endpoint_url=self._renderers.endpoint_url,
        )
        trace = build_turn_trace(
            turn=updated.turn,
            query=f"/form {alias}",
            active_mode=RenderMode.RPC,
            compare=False,
            stage1_source="direct_tool",
            tool_name=form.predicate.name,
            payload={"form": form.alias, "predicate": form.predicate.name},
            candidates=[candidate],
        )
        self._last_trace[context_id] = trace
        return AgentTurnResult(
            messages=msgs,
            trace=trace if include_trace else None,
        )

    async def _handle_render_turn(
        self,
        text: str,
        *,
        context_id: str,
        pasted_payload: Any,
        include_trace: bool,
    ) -> AgentTurnResult:
        settings = self.get_settings(context_id).next_turn()
        compare = settings.compare
        updated = replace(settings, compare=False)
        self._set_settings(context_id, updated)

        if compare:
            return await self._run_compare_turn(
                text,
                context_id=context_id,
                settings=updated,
                include_trace=include_trace,
            )

        if pasted_payload is not None or updated.mode is RenderMode.BINDER:
            payload = (
                pasted_payload
                if pasted_payload is not None
                else TOOL_BY_ALIAS["host"].fn()
            )
            outcome, calls = await self._renderers.run_binder_direct(
                intent=text or "Render payload",
                tool_name="pasted_payload"
                if pasted_payload is not None
                else "get_host_health",
                tool_output=payload,
                surface_id="main",
            )
            source = "pasted_json" if pasted_payload is not None else "tool_call"
        elif updated.mode is RenderMode.RPC:
            return self._cmd_form("bug", context_id, updated, include_trace)
        elif updated.mode in (RenderMode.EXPRESS, RenderMode.DIRECT):
            outcome, calls = await self._renderers.run_baseline(
                text,
                mode=updated.mode,
                surface_id=f"turn-{updated.turn}-{updated.mode.value}",
                session_id=context_id,
            )
            source = "llm"
            payload = None
        else:
            outcome, calls = await self._renderers.run_cascade(
                text,
                surface_id="main",
                budget_ms=updated.budget_ms,
                session_id=context_id,
            )
            source = "llm"
            payload = None

        candidate = build_candidate_trace(
            outcome,
            calls,
            backend_kind=self._renderers.backend_kind,
            model_id=self._renderers.model_id,
            endpoint_url=self._renderers.endpoint_url,
        )
        trace = build_turn_trace(
            turn=updated.turn,
            query=text,
            active_mode=updated.mode,
            compare=False,
            stage1_source=source,
            tool_name=None,
            payload=payload,
            candidates=[candidate],
        )
        self._last_trace[context_id] = trace
        return AgentTurnResult(
            messages=list(outcome.messages),
            trace=trace if include_trace else None,
        )

    async def _run_compare_turn(
        self,
        text: str,
        *,
        context_id: str,
        settings: PlaygroundSettings,
        include_trace: bool,
    ) -> AgentTurnResult:
        all_msgs: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        for mode in COMPARE_MODES:
            sid = f"turn-{settings.turn}-{mode.value}"
            if mode is RenderMode.CASCADE:
                outcome, calls = await self._renderers.run_cascade(
                    text,
                    surface_id=sid,
                    budget_ms=settings.budget_ms,
                    session_id=context_id,
                )
            else:
                outcome, calls = await self._renderers.run_baseline(
                    text, mode=mode, surface_id=sid, session_id=context_id
                )
            all_msgs.extend(outcome.messages)
            candidates.append(
                build_candidate_trace(
                    outcome,
                    calls,
                    backend_kind=self._renderers.backend_kind,
                    model_id=self._renderers.model_id,
                    endpoint_url=self._renderers.endpoint_url,
                )
            )
        trace = build_turn_trace(
            turn=settings.turn,
            query=text,
            active_mode=settings.mode,
            compare=True,
            stage1_source="llm",
            tool_name=None,
            payload=None,
            candidates=candidates,
        )
        self._last_trace[context_id] = trace
        return AgentTurnResult(
            messages=all_msgs,
            trace=trace if include_trace else None,
        )

    def _status_result(
        self,
        markdown: str,
        *,
        settings: PlaygroundSettings,
        query: str,
        include_trace: bool,
        ok: bool = True,
    ) -> AgentTurnResult:
        sid = f"turn-{settings.turn}-status"
        msgs = build_status_card_messages(sid, markdown)
        if not include_trace:
            return AgentTurnResult(messages=msgs, trace=None)
        outcome = RenderOutcome(
            mode=settings.mode,
            surface_id=sid,
            messages=tuple(msgs),
            text=markdown,
            ok=ok,
            error=None if ok else markdown,
        )
        candidate = build_candidate_trace(
            outcome,
            [],
            backend_kind=self._renderers.backend_kind,
            model_id=self._renderers.model_id,
            endpoint_url=self._renderers.endpoint_url,
        )
        trace = build_turn_trace(
            turn=settings.turn,
            query=query,
            active_mode=settings.mode,
            compare=False,
            stage1_source="direct_tool",
            tool_name=None,
            payload={"backend": self._renderers.backend_kind},
            candidates=[candidate],
        )
        return AgentTurnResult(messages=msgs, trace=trace)

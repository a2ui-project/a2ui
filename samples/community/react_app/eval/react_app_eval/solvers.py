# Copyright 2026 Google LLC
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

"""Solver steps: the ReactApp prompt fragment, and the server compile with its repair loop."""

from __future__ import annotations

import asyncio
from typing import Any

from a2ui.core import CatalogApi
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui_eval.runner import build_catalogs_and_examples, runner_options_from_metadata
from a2ui_eval.shared.utils import GIT_ROOT
from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppCompiler,
    ReactAppTransformer,
    RepairResult,
    compile_and_repair,
    react_app_bindings,
    react_app_prompt,
)
from inspect_ai.model import (
    ChatMessage,
    ChatMessageSystem,
    ChatMessageUser,
    get_model,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver

from .facts import iter_react_apps

__all__ = [
    "BINDINGS_KEY",
    "COMPILE_KEY",
    "react_app_server_compile",
    "react_app_system_prompt",
    "sample_catalogs",
    "shared_compiler",
]

BINDINGS_KEY = "react_app_bindings"
"""Metadata key of the `a2ui:bindings` declarations the sample was prompted with."""

COMPILE_KEY = "react_app_compile"
"""Metadata key of the server compile and repair record of a sample."""

_compiler: ReactAppCompiler | None = None


def shared_compiler() -> ReactAppCompiler:
    """The compile worker shared by the solvers and scorers of this process."""
    global _compiler
    if _compiler is None:
        _compiler = ReactAppCompiler()
    return _compiler


def sample_catalogs(metadata: dict[str, object], version: str) -> list[CatalogApi]:
    """Loads the catalogs a sample names, the way the runner does."""
    resolved_catalog_path = str(GIT_ROOT / str(metadata["catalog"]))
    options = runner_options_from_metadata(metadata, resolved_catalog_path)
    catalogs, _ = build_catalogs_and_examples(
        resolved_catalog_path, version, options.to_dict()
    )
    return catalogs


@solver
def react_app_system_prompt(version: str = "1.0", bindings: bool = False) -> Solver:
    """Appends `react_app_prompt(...)` to the system message.

    Runs after the runner's `format_system_prompt`, and only for samples whose
    catalogs include the ReactApp catalog, so the same chain serves samples
    without it. With `bindings`, the prompt includes the `a2ui:bindings`
    declarations, which are also kept in the metadata for the type check.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        catalogs = await asyncio.to_thread(sample_catalogs, state.metadata, version)
        if not any(c.catalog_id == REACT_APP_CATALOG_ID for c in catalogs):
            return state
        typed = (
            await asyncio.to_thread(react_app_bindings, catalogs) if bindings else None
        )
        if typed is not None and typed.names:
            state.metadata[BINDINGS_KEY] = typed.declarations
        fragment = await asyncio.to_thread(react_app_prompt, catalogs, bindings=typed)
        for index, message in enumerate(state.messages):
            if isinstance(message, ChatMessageSystem):
                state.messages[index] = ChatMessageSystem(
                    content=f"{message.text}\n\n{fragment}"
                )
                return state
        state.messages.insert(0, ChatMessageSystem(content=fragment))
        return state

    return solve


@solver
def react_app_server_compile(
    repair: bool = False, max_attempts: int = 2, version: str = "1.0"
) -> Solver:
    """Compiles each ReactApp of the payload on the server, and optionally repairs it.

    Runs after `compile_format_payload`. Rebuilds the sample's `ReactAppBindings`
    from its catalogs with `react_app_bindings` when `BINDINGS_KEY` is set, and
    delegates to `compile_and_repair` (when `repair` is True) or
    `ReactAppTransformer.process` (when `repair` is False). The record goes to
    `metadata["react_app_compile"]`.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        raw_messages = state.metadata.get("compiled_messages") or []
        if not list(iter_react_apps(raw_messages)):
            return state
        catalogs = await asyncio.to_thread(sample_catalogs, state.metadata, version)
        use_bindings = bool(state.metadata.get(BINDINGS_KEY))
        bindings = (
            await asyncio.to_thread(react_app_bindings, catalogs)
            if use_bindings
            else None
        )
        compiler = shared_compiler()
        transformer = ReactAppTransformer(compiler=compiler, bindings=bindings)
        transformer.transform_catalogs(catalogs)
        messages = to_message_models(raw_messages)
        model = get_model()

        async def ask(prompt: str, system_instruction: str | None = None) -> str:
            if system_instruction:
                chat: list[ChatMessage] = [
                    ChatMessageSystem(content=system_instruction),
                    ChatMessageUser(content=prompt),
                ]
                return (await model.generate(chat)).completion
            return (await model.generate(prompt)).completion

        repairs: list[RepairResult] = []
        if repair:
            updated_messages, repairs = await compile_and_repair(
                messages,
                transformer=transformer,
                generate=ask,
                max_attempts=max_attempts,
            )
        else:
            processed = await asyncio.to_thread(transformer.process, messages)
            updated_messages = processed.messages
        state.metadata["compiled_messages"] = to_message_dicts(updated_messages)

        compiles = (
            transformer.last_result.compiles
            if transformer.last_result is not None
            else []
        )
        repairs_by_id = {(r.surface_id, r.component_id): r for r in repairs}
        records: list[dict[str, Any]] = []
        for item in compiles:
            first_problems = [d.message for d in item.diagnostics][:10]
            record: dict[str, Any] = {
                "id": item.component_id,
                "first_ok": item.ok,
                "first_problems": first_problems,
                "compile_ms": item.result.round_trip_ms,
                "final_ok": item.ok,
                "attempts": 0,
                "repair_ms": 0,
            }
            repaired = repairs_by_id.get((item.surface_id, item.component_id))
            if repaired is not None:
                record.update(
                    final_ok=repaired.ok,
                    attempts=len(repaired.attempts),
                    repair_ms=repaired.total_ms,
                    final_problems=repaired.problems[:10],
                )
            records.append(record)
        state.metadata[COMPILE_KEY] = records
        return state

    return solve

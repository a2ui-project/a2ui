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

"""Solver step that adds the ReactApp prompt fragment to the system prompt."""

from __future__ import annotations

import asyncio

from a2ui.core import CatalogApi
from a2ui_eval.runner import build_catalogs_and_examples, runner_options_from_metadata
from a2ui_eval.shared.utils import GIT_ROOT
from a2ui_react_app import REACT_APP_CATALOG_ID, react_app_prompt
from inspect_ai.model import ChatMessageSystem
from inspect_ai.solver import Generate, Solver, TaskState, solver

__all__ = ["react_app_system_prompt", "sample_catalogs"]


def sample_catalogs(metadata: dict[str, object], version: str) -> list[CatalogApi]:
    """Loads the catalogs a sample names, the way the runner does."""
    resolved_catalog_path = str(GIT_ROOT / str(metadata["catalog"]))
    options = runner_options_from_metadata(metadata, resolved_catalog_path)
    catalogs, _ = build_catalogs_and_examples(
        resolved_catalog_path, version, options.to_dict()
    )
    return catalogs


@solver
def react_app_system_prompt(version: str = "1.0") -> Solver:
    """Appends `react_app_prompt(...)` to the system message.

    Runs after the runner's `format_system_prompt`, and only for samples whose
    catalogs include the ReactApp catalog, so the same chain serves samples
    without it.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        catalogs = await asyncio.to_thread(sample_catalogs, state.metadata, version)
        if not any(c.catalog_id == REACT_APP_CATALOG_ID for c in catalogs):
            return state
        fragment = await asyncio.to_thread(react_app_prompt, catalogs)
        for index, message in enumerate(state.messages):
            if isinstance(message, ChatMessageSystem):
                state.messages[index] = ChatMessageSystem(
                    content=f"{message.text}\n\n{fragment}"
                )
                return state
        state.messages.insert(0, ChatMessageSystem(content=fragment))
        return state

    return solve

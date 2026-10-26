# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Evaluation solver strategies."""

from __future__ import annotations

from typing import Callable

from inspect_ai.solver import Solver

from ..runner import validate_strategy
from .format import compile_format_payload, format_solver, format_system_prompt
from .subagent_tool import (
    PAYLOAD_STORE_KEY,
    a2ui_specialist,
    extract_subagent_payload,
    subagent_tool_solver,
)

STRATEGIES: dict[str, Callable[[str], list[Solver]]] = {
    "direct": lambda version: format_solver("direct_json", version),
    "subagent_tool": subagent_tool_solver,
    "express": lambda version: format_solver("express", version),
    "elemental": lambda version: format_solver("elemental", version),
    "atom": lambda version: format_solver("atom", version),
}


def get_solver(strategy: str, version: str) -> list[Solver]:
    """Returns the solver chain for the specified evaluation strategy."""
    if strategy not in STRATEGIES:
        raise ValueError(f"Unknown evaluation strategy: {strategy}")

    validate_strategy(strategy)
    return STRATEGIES[strategy](version)


__all__ = [
    "PAYLOAD_STORE_KEY",
    "STRATEGIES",
    "a2ui_specialist",
    "compile_format_payload",
    "extract_subagent_payload",
    "format_solver",
    "format_system_prompt",
    "get_solver",
    "subagent_tool_solver",
]

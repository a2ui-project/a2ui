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

from typing import Any, Callable

from inspect_ai.solver import Solver

from ..runner import validate_strategy
from .format import (
    compile_format_payload,
    format_solver,
    format_system_prompt,
)
from .skill_mode import read_a2ui_skill, skill_mode_strategy
from .subagent_tool import (
    PAYLOAD_STORE_KEY,
    a2ui_specialist,
    extract_subagent_payload,
    subagent_tool_strategy,
)

# Keyword options every strategy factory accepts. `get_solver` forwards them
# from the task; a factory ignores the ones it has no use for.
STRATEGY_OPTION_KEYS: tuple[str, ...] = (
    "max_validation_retries",
    "subagent_format",
)


def _format_strategy(format_name: str) -> Callable[..., list[Solver]]:
    """Builds the factory for a strategy that is one inference format."""

    def build(version: str, **options: Any) -> list[Solver]:
        return format_solver(
            format_name,
            version,
            max_validation_retries=options.get("max_validation_retries", 0),
        )

    return build


def _subagent_strategy(version: str, **options: Any) -> list[Solver]:
    return subagent_tool_strategy(
        version,
        subagent_format=options.get("subagent_format") or "direct_json",
        max_validation_retries=options.get("max_validation_retries", 0),
    )


def _skill_mode(version: str, **options: Any) -> list[Solver]:
    return skill_mode_strategy(
        "express",
        version,
        max_validation_retries=options.get("max_validation_retries", 0),
    )


STRATEGIES: dict[str, Callable[..., list[Solver]]] = {
    "direct": _format_strategy("direct_json"),
    "subagent_tool": _subagent_strategy,
    "express": _format_strategy("express"),
    "skill_mode": _skill_mode,
    "elemental": _format_strategy("elemental"),
    "atom": _format_strategy("atom"),
}


def get_solver(strategy: str, version: str, **options: Any) -> list[Solver]:
    """Returns the solver chain for the specified evaluation strategy.

    Args:
        strategy: A key of `STRATEGIES`.
        version: The protocol version the solvers target.
        **options: Any of `STRATEGY_OPTION_KEYS`: `max_validation_retries` and
            `subagent_format`.

    Raises:
        ValueError: If the strategy is unknown or an option name is not
            recognized.
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"Unknown evaluation strategy: {strategy}")
    unknown = sorted(set(options) - set(STRATEGY_OPTION_KEYS))
    if unknown:
        raise ValueError(f"Unknown strategy option(s): {', '.join(unknown)}")

    validate_strategy(strategy)
    return STRATEGIES[strategy](version, **options)


__all__ = [
    "PAYLOAD_STORE_KEY",
    "STRATEGIES",
    "STRATEGY_OPTION_KEYS",
    "a2ui_specialist",
    "compile_format_payload",
    "extract_subagent_payload",
    "format_solver",
    "format_system_prompt",
    "get_solver",
    "read_a2ui_skill",
    "skill_mode_strategy",
    "subagent_tool_strategy",
]

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

"""Base abstractions for cross-language A2UI Agent SDK evaluation bridges."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

SUPPORTED_SDKS: tuple[str, ...] = ("python", "ts", "dart")

SDK_ALIASES: dict[str, str] = {
    "dart": "dart",
    "py": "python",
    "python": "python",
    "ts": "ts",
    "typescript": "ts",
}

SDK_SUPPORTED_STRATEGIES: dict[str, frozenset[str]] = {
    "python": frozenset({"direct", "express", "subagent_tool", "elemental", "atom"}),
    "ts": frozenset({"direct", "express", "subagent_tool"}),
    "dart": frozenset({"direct", "express", "subagent_tool"}),
}

SDK_SUPPORTED_FORMATS: dict[str, frozenset[str]] = {
    "python": frozenset({"direct_json", "express", "elemental", "atom"}),
    "ts": frozenset({"direct_json", "express"}),
    "dart": frozenset({"direct_json", "express"}),
}


def normalize_sdk_name(sdk: str) -> str:
    """Normalizes an SDK identifier (e.g. 'typescript' -> 'ts')."""
    cleaned = sdk.strip().lower()
    if cleaned not in SDK_ALIASES:
        valid = ", ".join(SUPPORTED_SDKS)
        raise ValueError(f"Unknown SDK '{sdk}'. Valid choices: {valid}")
    return SDK_ALIASES[cleaned]


def validate_sdk_strategy(sdk: str, strategy: str) -> None:
    """Checks that the given strategy is supported by the target SDK."""
    norm_sdk = normalize_sdk_name(sdk)
    supported = SDK_SUPPORTED_STRATEGIES[norm_sdk]
    if strategy not in supported:
        valid = ", ".join(sorted(supported))
        raise ValueError(
            f"Strategy '{strategy}' is not supported by SDK '{norm_sdk}'."
            f" Supported strategies for '{norm_sdk}': {valid}"
        )


def validate_sdk_format(sdk: str, format_name: str) -> None:
    """Checks that the given inference format is supported by the target SDK."""
    norm_sdk = normalize_sdk_name(sdk)
    supported = SDK_SUPPORTED_FORMATS[norm_sdk]
    if format_name not in supported:
        valid = ", ".join(sorted(supported))
        raise ValueError(
            f"Inference format '{format_name}' is not supported by SDK"
            f" '{norm_sdk}'. Supported formats for '{norm_sdk}': {valid}"
        )


class AgentSdkBridge(ABC):
    """Interface for executing agent SDK prompt generation and payload validation."""

    sdk_name: str

    def prepare(self) -> None:
        """Performs any one-time compilation or build steps before evaluation."""

    @abstractmethod
    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
    ) -> str:
        """Generates the format-specific and catalog-specific system prompt snippet."""

    @abstractmethod
    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = 5.0,
        require_complete_tags: bool = False,
    ) -> dict[str, Any]:
        """Parses an LLM completion and strictly validates compiled A2UI payloads.

        Returns:
            A dictionary with keys:
              - 'compiled_jsons': list[dict[str, Any]]
              - 'parts': list[dict[str, Any]] with {'text': str, 'a2ui_json': list | None}
        """

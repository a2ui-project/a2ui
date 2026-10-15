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

SDK_SUPPORTED_STRATEGIES: dict[str, tuple[str, ...]] = {
    "python": ("direct", "subagent_tool", "express", "elemental", "atom"),
    "ts": ("direct", "subagent_tool", "express"),
    "dart": ("direct", "subagent_tool", "express"),
}

SDK_SUPPORTED_FORMATS: dict[str, frozenset[str]] = {
    "python": frozenset({"direct_json", "express", "elemental", "atom"}),
    "ts": frozenset({"direct_json", "express"}),
    "dart": frozenset({"direct_json", "express"}),
}

# Protocol versions each SDK can generate prompts for and validate against.
SDK_SUPPORTED_VERSIONS: dict[str, frozenset[str]] = {
    "python": frozenset({"0.9.1", "1.0"}),
    "ts": frozenset({"0.9.1", "1.0"}),
    "dart": frozenset({"0.9.1"}),
}

# Hard-kill budget, in seconds, for a single parse-and-validate call. The same
# value is used for every SDK so that timeouts behave identically across them.
DEFAULT_PARSE_TIMEOUT_SEC: float = 15.0


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


def normalize_protocol_version(version: str) -> str:
    """Normalizes a protocol version string (e.g. 'v0.9.1' -> '0.9.1')."""
    cleaned = version.strip().lower()
    if cleaned.startswith("v"):
        cleaned = cleaned[1:]
    return cleaned


def validate_sdk_version(sdk: str, version: str) -> str:
    """Checks that the target SDK supports the given protocol version.

    Args:
        sdk: The SDK identifier or alias (e.g. 'typescript').
        version: The protocol version, with or without a 'v' prefix.

    Returns:
        The normalized protocol version (e.g. '0.9.1').

    Raises:
        ValueError: If the SDK is unknown or does not support the version.
    """
    norm_sdk = normalize_sdk_name(sdk)
    norm_version = normalize_protocol_version(version)
    supported = SDK_SUPPORTED_VERSIONS[norm_sdk]
    if norm_version not in supported:
        valid = ", ".join(sorted(supported))
        raise ValueError(
            f"Protocol version '{version}' is not supported by SDK '{norm_sdk}'."
            f" Supported versions for '{norm_sdk}': {valid}"
        )
    return norm_version


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
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
    ) -> dict[str, Any]:
        """Parses an LLM completion and optionally validates the compiled payloads.

        Args:
            format_name: The inference format of the completion (e.g. 'express').
            version: The protocol version (e.g. '0.9.1' or '1.0').
            resolved_catalog_path: Absolute path to the catalog JSON file.
            surface_id: The default surface ID for formats that need one.
            completion: The raw LLM completion text.
            timeout_sec: Hard-kill budget for the call, in seconds.
            require_complete_tags: Whether to fail when the opening and closing
                A2UI tags are not both present.
            validate: Whether to run the compiled messages through a strict
                message processor. When False, the completion is only parsed.

        Raises:
            ValueError: If parsing fails, no A2UI payload is found, or (when
                `validate` is True) the payload fails strict validation.

        Returns:
            A dictionary with keys:
              - 'compiled_jsons': list[dict[str, Any]]
              - 'parts': list[dict[str, Any]] with {'text': str, 'a2ui_json': list | None}
        """

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
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
from typing import Any

# This module is imported by the Python bridge's worker processes, so it must
# stay free of evaluation dependencies (notably inspect_ai).
_REPO_ROOT = Path(__file__).resolve().parents[3]

SUPPORTED_SDKS: tuple[str, ...] = ("python", "ts", "dart")

SDK_ALIASES: dict[str, str] = {
    "dart": "dart",
    "py": "python",
    "python": "python",
    "ts": "ts",
    "typescript": "ts",
}

SDK_SUPPORTED_STRATEGIES: dict[str, tuple[str, ...]] = {
    "python": (
        "direct",
        "subagent_tool",
        "express",
        "skill_mode",
        "elemental",
        "atom",
    ),
    "ts": ("direct", "subagent_tool", "express"),
    "dart": ("direct", "subagent_tool", "express"),
}

# Strategies run when none are named on the command line: the production
# formats only. The experimental `elemental` and `atom` strategies and the
# Python-only `skill_mode` stay supported but must be requested explicitly.
SDK_DEFAULT_STRATEGIES: dict[str, tuple[str, ...]] = {
    "python": ("direct", "subagent_tool", "express"),
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


def _tuple_or_none(values: Sequence[str] | None) -> tuple[str, ...] | None:
    return None if values is None else tuple(str(v) for v in values)


def _resolve_repo_path(path: str, repo_root: Path) -> str:
    candidate = Path(path)
    if candidate.is_absolute():
        return str(candidate)
    return str((repo_root / candidate).resolve())


@dataclass(frozen=True)
class CatalogSpec:
    """One catalog given to a bridge, with the pruning and examples applied to it.

    Attributes:
        path: Absolute path to the catalog JSON document.
        catalog_id: Catalog id to use when the document states none.
        allowed_components: Component names to keep, or None to keep them all.
        allowed_functions: Function names to keep, or None to keep them all.
        examples: Absolute paths to JSON files holding few-shot example payloads
            (a list of agent-to-renderer messages) for this catalog.
    """

    path: str
    catalog_id: str | None = None
    allowed_components: tuple[str, ...] | None = None
    allowed_functions: tuple[str, ...] | None = None
    examples: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> CatalogSpec:
        """Builds a spec from its `to_dict` form (or a dataset `catalogs` entry)."""
        return cls(
            path=str(data["path"]),
            catalog_id=data.get("catalog_id"),
            allowed_components=_tuple_or_none(data.get("allowed_components")),
            allowed_functions=_tuple_or_none(data.get("allowed_functions")),
            examples=tuple(str(e) for e in data.get("examples") or ()),
        )


@dataclass(frozen=True)
class BridgeOptions:
    """Inference-layer options for prompt generation and payload validation.

    Attributes:
        catalogs: The active catalogs, in order. The first is the default.
        allowed_messages: Message types the model may write (for example
            `updateDataModel`), or None to allow all of them.
        initial_renderer_state: Messages applied to a fresh renderer state
            before the model's turn is validated, so a turn can update an
            existing surface.
        stream_chunk_size: When set, the bridge also feeds the completion
            through the format's streaming parser in slices of this many
            characters and fails if the streamed parse disagrees.
    """

    catalogs: tuple[CatalogSpec, ...] = ()
    allowed_messages: tuple[str, ...] | None = None
    initial_renderer_state: tuple[dict[str, Any], ...] | None = None
    stream_chunk_size: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Returns a JSON-serializable form, for sending to a bridge runner."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> BridgeOptions:
        """Rebuilds options from their `to_dict` form; None gives the defaults."""
        if not data:
            return cls()
        state = data.get("initial_renderer_state")
        return cls(
            catalogs=tuple(
                CatalogSpec.from_dict(c) for c in data.get("catalogs") or ()
            ),
            allowed_messages=_tuple_or_none(data.get("allowed_messages")),
            initial_renderer_state=(
                None if state is None else tuple(dict(m) for m in state)
            ),
            stream_chunk_size=data.get("stream_chunk_size"),
        )

    def cache_key(self) -> str:
        """A deterministic string identifying these options, for prompt caches."""
        return json.dumps(self.to_dict(), sort_keys=True, default=str)


@dataclass(frozen=True)
class Stage2Assertions:
    """Deterministic checks on compiled A2UI messages, run before the LLM judge.

    Each field lists names that must (or must not) appear in the compiled
    payload. An empty field is not checked.
    """

    required_components: tuple[str, ...] = ()
    forbidden_components: tuple[str, ...] = ()
    required_bindings: tuple[str, ...] = ()
    required_actions: tuple[str, ...] = ()
    message_types: tuple[str, ...] = ()
    catalog_ids: tuple[str, ...] = ()

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any] | None) -> Stage2Assertions:
        """Builds assertions from a dataset `assertions` block; None gives none."""
        if not data:
            return cls()
        return cls(**{
            f.name: tuple(str(v) for v in data.get(f.name) or ())
            for f in cls.__dataclass_fields__.values()
        })

    @property
    def is_empty(self) -> bool:
        """True when no field asserts anything."""
        return not any(getattr(self, f) for f in self.__dataclass_fields__)


def bridge_options_from_metadata(
    metadata: Mapping[str, Any],
    resolved_catalog_path: str,
    repo_root: Path | None = None,
) -> BridgeOptions:
    """Builds the bridge options a sample asks for from its metadata.

    Args:
        metadata: The sample metadata written by `load_a2ui_dataset`. Reads
            `catalog_specs`, `allowed_messages`, `initial_state` and
            `stream_chunk_size`; every key is optional.
        resolved_catalog_path: The absolute catalog path used when the sample
            names no `catalog_specs`.
        repo_root: Root against which relative catalog and example paths are
            resolved. Defaults to the repository root.

    Returns:
        Options whose catalog and example paths are absolute.
    """
    root = repo_root or _REPO_ROOT
    specs: list[CatalogSpec] = []
    for raw in metadata.get("catalog_specs") or ():
        spec = CatalogSpec.from_dict(raw)
        specs.append(
            CatalogSpec(
                path=_resolve_repo_path(spec.path, root),
                catalog_id=spec.catalog_id,
                allowed_components=spec.allowed_components,
                allowed_functions=spec.allowed_functions,
                examples=tuple(_resolve_repo_path(e, root) for e in spec.examples),
            )
        )
    if not specs:
        specs.append(CatalogSpec(path=resolved_catalog_path))
    initial_state = metadata.get("initial_state")
    return BridgeOptions(
        catalogs=tuple(specs),
        allowed_messages=_tuple_or_none(metadata.get("allowed_messages")),
        initial_renderer_state=(
            None if initial_state is None else tuple(dict(m) for m in initial_state)
        ),
        stream_chunk_size=metadata.get("stream_chunk_size"),
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
        *,
        options: BridgeOptions | None = None,
    ) -> str:
        """Generates the format-specific and catalog-specific system prompt snippet.

        Args:
            format_name: The inference format (e.g. 'express').
            version: The protocol version (e.g. '0.9.1' or '1.0').
            resolved_catalog_path: Absolute path to the catalog JSON file, used
                when `options` names no catalogs.
            surface_id: The default surface ID for formats that need one.
            options: Multi-catalog, pruning, example and message-type options.
                None means a single unpruned catalog with no examples.
        """

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
        options: BridgeOptions | None = None,
    ) -> dict[str, Any]:
        """Parses an LLM completion and optionally validates the compiled payloads.

        Args:
            format_name: The inference format of the completion (e.g. 'express').
            version: The protocol version (e.g. '0.9.1' or '1.0').
            resolved_catalog_path: Absolute path to the catalog JSON file, used
                when `options` names no catalogs.
            surface_id: The default surface ID for formats that need one.
            completion: The raw LLM completion text.
            timeout_sec: Hard-kill budget for the call, in seconds.
            require_complete_tags: Whether to fail when the opening and closing
                A2UI tags are not both present.
            validate: Whether to run the compiled messages through a strict
                message processor. When False, the completion is only parsed.
            options: Multi-catalog, pruning, initial renderer state and
                streaming options. None means a single unpruned catalog, an
                empty renderer state and no streaming check.

        Raises:
            ValueError: If parsing fails, no A2UI payload is found, or (when
                `validate` is True) the payload fails strict validation.

        Returns:
            A dictionary with keys:
              - 'compiled_jsons': list[dict[str, Any]]
              - 'parts': list[dict[str, Any]] with {'text': str, 'a2ui_json': list | None}
        """

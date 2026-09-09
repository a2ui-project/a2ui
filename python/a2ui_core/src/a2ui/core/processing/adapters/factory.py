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

from collections.abc import Mapping, Sequence
from typing import Any
from .base import VersionAdapter
from .v0_8 import V0Point8Adapter
from .v0_9 import V0Point9Adapter
from .v1_0 import V1Point0Adapter
from ...exceptions import A2uiErrorDetail, A2uiValidationError
from ...schema import AgentToRendererMessage, ProtocolVersion

DEFAULT_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion.V0_9


class VersionAdapterFactory:
    """Resolves version adapters for protocol specification versions."""

    _adapters: dict[ProtocolVersion | str, VersionAdapter] = {
        ProtocolVersion.V0_8: V0Point8Adapter(),
        ProtocolVersion.V0_9: V0Point9Adapter(),
        ProtocolVersion.V0_9_1: V0Point9Adapter(),
        ProtocolVersion.V1_0: V1Point0Adapter(),
    }

    @classmethod
    def register_adapter(cls, adapter: VersionAdapter) -> None:
        """Dynamically registers a version adapter."""
        from ...common.semver import normalize_version_string, to_canonical_version

        cls._adapters[adapter.version] = adapter
        ver_str = (
            adapter.version.value
            if hasattr(adapter.version, "value")
            else str(adapter.version)
        )
        canonical = to_canonical_version(ver_str)
        if canonical:
            cls._adapters[canonical] = adapter
            cls._adapters[f"v{canonical}"] = adapter
        normalized = normalize_version_string(ver_str)
        if normalized:
            cls._adapters[normalized] = adapter
            cls._adapters[f"v{normalized}"] = adapter

    @classmethod
    def all_known_actions(cls) -> frozenset[str]:
        """Returns the aggregated set of all action keys supported by all registered adapters."""
        actions: set[str] = set()
        for adapter in cls._adapters.values():
            if hasattr(adapter, "valid_actions"):
                actions.update(adapter.valid_actions)
        return frozenset(actions)

    @classmethod
    def get_adapter(cls, version: ProtocolVersion | str) -> VersionAdapter:
        """Resolves the version adapter for the specified protocol version enum or string."""
        from ...common.semver import normalize_version_string, to_canonical_version

        adapter = cls._adapters.get(version)
        if not adapter:
            if isinstance(version, str):
                parsed_ver = cls._parse_version(version)
                if parsed_ver:
                    adapter = cls._adapters.get(parsed_ver)
                if not adapter:
                    canonical = to_canonical_version(version)
                    if canonical:
                        adapter = cls._adapters.get(canonical) or cls._adapters.get(
                            f"v{canonical}"
                        )
                    if not adapter:
                        norm = normalize_version_string(version)
                        if norm:
                            adapter = cls._adapters.get(norm) or cls._adapters.get(
                                f"v{norm}"
                            )
            elif isinstance(version, ProtocolVersion):
                canonical = to_canonical_version(version.value)
                if canonical:
                    adapter = cls._adapters.get(canonical) or cls._adapters.get(
                        f"v{canonical}"
                    )

        if not adapter:
            seen: set[str] = set()
            supported_list: list[str] = []
            for k in cls._adapters.keys():
                val = k.value if hasattr(k, "value") else str(k)
                canon = to_canonical_version(val)
                v_str = (
                    f"v{canon}"
                    if canon
                    else (val if val.startswith("v") else f"v{val}")
                )
                if v_str not in seen:
                    seen.add(v_str)
                    supported_list.append(v_str)
            supported = ", ".join(sorted(supported_list))
            raise A2uiValidationError(
                f"[VersionAdapterFactory] Unsupported protocol version '{version}'."
                f" Supported versions: {supported}."
            )
        return adapter

    @classmethod
    def resolve_from_payload(
        cls,
        payload: (
            AgentToRendererMessage
            | Sequence[AgentToRendererMessage]
            | Mapping[str, Any]
            | Sequence[Mapping[str, Any]]
        ),
    ) -> VersionAdapter:
        """Resolves the version adapter directly from an incoming message payload."""
        raw: Any = payload
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump(by_alias=True, exclude_none=True)

        # 1. Reject non-collection types (None, int, str, etc.)
        if not isinstance(raw, (list, dict)):
            raise A2uiValidationError(
                "[VersionAdapterFactory] Message payload is missing a valid 'version'"
                f" string: expected object or list, got {type(payload).__name__}.",
                details=[
                    A2uiErrorDetail(
                        path="messages.0.version",
                        code="invalid_payload_type",
                        message=(
                            f"Expected object or list, got {type(payload).__name__}"
                        ),
                    )
                ],
            )

        # 2. Extract first item from list or unwrap {'messages': [...]}
        item: Any
        idx: int = 0
        if isinstance(raw, list):
            if not raw:
                raise A2uiValidationError(
                    "[VersionAdapterFactory] Message payload is missing a valid"
                    " 'version' string: message list is empty.",
                    details=[
                        A2uiErrorDetail(
                            path="messages.0.version",
                            code="empty_payload",
                            message="Message list is empty",
                        )
                    ],
                )
            item = raw[0]
        elif "messages" in raw and isinstance(raw["messages"], list):
            return cls.resolve_from_payload(raw["messages"])
        else:
            item = raw

        if hasattr(item, "model_dump"):
            item = item.model_dump(by_alias=True, exclude_none=True)

        # 3. Ensure candidate item is a dictionary
        if not isinstance(item, dict):
            raise A2uiValidationError(
                "[VersionAdapterFactory] Message payload is missing a valid 'version'"
                f" string: message item at index {idx} is not an object.",
                details=[
                    A2uiErrorDetail(
                        path=f"messages.{idx}.version",
                        code="invalid_payload_type",
                        message="Message item is not an object",
                    )
                ],
            )

        # 4. Check explicit version property
        if "version" in item:
            ver = item["version"]
            if not isinstance(ver, str):
                raise A2uiValidationError(
                    "[VersionAdapterFactory] Message payload is missing a valid"
                    " 'version' string: 'version' property must be a string, got"
                    f" {type(ver).__name__}.",
                    details=[
                        A2uiErrorDetail(
                            path=f"messages.{idx}.version",
                            code="type_mismatch",
                            message=(
                                "Expected string for 'version', got"
                                f" {type(ver).__name__}"
                            ),
                        )
                    ],
                )
            return cls.get_adapter(ver)

        # 5. Check v0.8 legacy action keys
        if any(
            k in item
            for k in (
                "beginRendering",
                "surfaceUpdate",
                "dataModelUpdate",
                "deleteSurface",
            )
        ):
            return cls.get_adapter(ProtocolVersion.V0_8)

        # 6. Missing version and no legacy action key
        raise A2uiValidationError(
            "[VersionAdapterFactory] Message payload is missing a valid 'version'"
            " string: no version header or legacy v0.8 action found.",
            details=[
                A2uiErrorDetail(
                    path=f"messages.{idx}.version",
                    code="missing_field",
                    message="Missing required version field",
                )
            ],
        )

    @classmethod
    def _parse_version(cls, version_str: str) -> ProtocolVersion | None:
        """Parses a version string into a ProtocolVersion enum.

        Args:
            version_str: The version string to parse.

        Returns:
            The matched ProtocolVersion enum member, or None if unrecognized.
        """
        from ...common.semver import to_canonical_version

        canonical = to_canonical_version(version_str)
        if canonical:
            canonical_map = {
                "0.8": ProtocolVersion.V0_8,
                "0.9": ProtocolVersion.V0_9,
                "0.9.1": ProtocolVersion.V0_9_1,
                "1.0": ProtocolVersion.V1_0,
            }
            if canonical in canonical_map:
                return canonical_map[canonical]

        clean = (
            f"v{version_str[1:]}"
            if version_str.startswith(("v", "V"))
            else f"v{version_str}"
        )
        try:
            return ProtocolVersion(clean)
        except ValueError:
            return None

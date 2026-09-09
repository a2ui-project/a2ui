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
        cls._adapters[adapter.version] = adapter

    @classmethod
    def get_adapter(cls, version: ProtocolVersion | str) -> VersionAdapter:
        """Resolves the version adapter for the specified protocol version enum or string."""
        adapter = None
        if isinstance(version, str):
            parsed_ver = cls._parse_version(version)
            if parsed_ver:
                adapter = cls._adapters.get(parsed_ver)
            if not adapter:
                adapter = cls._adapters.get(version)
        elif isinstance(version, ProtocolVersion):
            adapter = cls._adapters.get(version)

        if not adapter:
            supported = ", ".join(
                v.value for v in cls._adapters.keys() if hasattr(v, "value")
            )
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
        if payload is None or isinstance(payload, (int, float, str)):
            raise A2uiValidationError(
                "[VersionAdapterFactory] Message payload is missing a valid 'version'"
                " string.",
                details=[
                    A2uiErrorDetail(
                        path="messages.0.version",
                        code="missing_field",
                        message="Missing required version field",
                    )
                ],
            )

        raw_payload: Any = payload
        if hasattr(raw_payload, "model_dump"):
            raw_payload = raw_payload.model_dump(by_alias=True, exclude_none=True)

        if isinstance(raw_payload, list):
            if not raw_payload:
                raise A2uiValidationError(
                    "[VersionAdapterFactory] Message payload is missing a valid"
                    " 'version' string.",
                    details=[
                        A2uiErrorDetail(
                            path="messages.0.version",
                            code="missing_field",
                            message="Missing required version field",
                        )
                    ],
                )
            for idx, item in enumerate(raw_payload):
                raw_item: Any = item
                if hasattr(raw_item, "model_dump"):
                    raw_item = raw_item.model_dump(by_alias=True, exclude_none=True)
                if isinstance(raw_item, dict):
                    v = raw_item.get("version")
                    if not v or not isinstance(v, str):
                        if not any(
                            k in raw_item
                            for k in (
                                "beginRendering",
                                "surfaceUpdate",
                                "dataModelUpdate",
                                "deleteSurface",
                            )
                        ):
                            raise A2uiValidationError(
                                "[VersionAdapterFactory] Message payload is missing a"
                                " valid 'version' string.",
                                details=[
                                    A2uiErrorDetail(
                                        path=f"messages.{idx}.version",
                                        code="missing_field",
                                        message="Missing required version field",
                                    )
                                ],
                            )
                    return cls._resolve_from_single_action(raw_item)

        if isinstance(raw_payload, dict):
            if "messages" in raw_payload and isinstance(raw_payload["messages"], list):
                return cls.resolve_from_payload(raw_payload["messages"])
            v = raw_payload.get("version")
            if not v or not isinstance(v, str):
                if not any(
                    k in raw_payload
                    for k in (
                        "beginRendering",
                        "surfaceUpdate",
                        "dataModelUpdate",
                        "deleteSurface",
                    )
                ):
                    raise A2uiValidationError(
                        "[VersionAdapterFactory] Message payload is missing a valid"
                        " 'version' string.",
                        details=[
                            A2uiErrorDetail(
                                path="messages.0.version",
                                code="missing_field",
                                message="Missing required version field",
                            )
                        ],
                    )
            return cls._resolve_from_single_action(raw_payload)

        raise A2uiValidationError(
            "[VersionAdapterFactory] Message payload is missing a valid 'version'"
            " string.",
            details=[
                A2uiErrorDetail(
                    path="messages.0.version",
                    code="missing_field",
                    message="Missing required version field",
                )
            ],
        )

    @classmethod
    def _resolve_from_single_action(cls, item: dict[str, Any]) -> VersionAdapter:
        """Resolves version adapter from a single message dictionary if explicit version or action keys match."""
        if "version" in item and isinstance(item["version"], str):
            ver_str = item["version"]
            ver_enum = cls._parse_version(ver_str)
            if not ver_enum:
                supported = ", ".join(
                    v.value for v in cls._adapters.keys() if hasattr(v, "value")
                )
                raise A2uiValidationError(
                    f"[VersionAdapterFactory] Unsupported protocol version '{ver_str}'."
                    f" Supported versions: {supported}."
                )
            return cls.get_adapter(ver_enum)
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
        raise A2uiValidationError(
            "[VersionAdapterFactory] Message payload is missing a valid 'version'"
            " string.",
            details=[
                A2uiErrorDetail(
                    path="messages.0.version",
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

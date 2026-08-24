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

from typing import Any, Dict, Optional
from .base import VersionAdapter
from .v0_8 import V0_8VersionAdapter
from .v0_9 import V0_9VersionAdapter
from .v1_0 import V1_0VersionAdapter
from ...exceptions import A2uiValidationError
from ...schema import ProtocolVersion, AgentToRendererMessagePayload

DEFAULT_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion.V0_9


class VersionAdapterFactory:
    """Resolves version adapters for protocol specification versions."""

    _adapters: Dict[ProtocolVersion, VersionAdapter] = {
        ProtocolVersion.V0_8: V0_8VersionAdapter(),
        ProtocolVersion.V0_9: V0_9VersionAdapter(),
        ProtocolVersion.V0_9_1: V0_9VersionAdapter(),
        ProtocolVersion.V1_0: V1_0VersionAdapter(),
    }

    @classmethod
    def register_adapter(cls, adapter: VersionAdapter) -> None:
        """Dynamically registers a version adapter."""
        cls._adapters[adapter.version] = adapter

    @classmethod
    def get_adapter(cls, version: ProtocolVersion) -> VersionAdapter:
        """Resolves the version adapter for the specified protocol version enum."""
        adapter = cls._adapters.get(version)
        if not adapter:
            supported = ", ".join(v.value for v in cls._adapters.keys())
            raise A2uiValidationError(
                f"[VersionAdapterFactory] Unsupported protocol version '{version}'."
                f" Supported versions: {supported}."
            )
        return adapter

    @classmethod
    def resolve_from_payload(
        cls, payload: AgentToRendererMessagePayload
    ) -> VersionAdapter:
        """Resolves the version adapter directly from an incoming message payload."""
        if not payload:
            return cls.get_adapter(DEFAULT_PROTOCOL_VERSION)

        if hasattr(payload, "model_dump"):
            payload = payload.model_dump(by_alias=True, exclude_none=True)

        if isinstance(payload, list):
            for item in payload:
                if hasattr(item, "model_dump"):
                    item = item.model_dump(by_alias=True, exclude_none=True)
                if isinstance(item, dict):
                    if "version" in item and isinstance(item["version"], str):
                        ver_enum = cls._parse_version(item["version"])
                        if ver_enum:
                            return cls.get_adapter(ver_enum)
                    if any(
                        k in item
                        for k in (
                            "beginRendering",
                            "surfaceUpdate",
                            "dataModelUpdate",
                        )
                    ):
                        return cls.get_adapter(ProtocolVersion.V0_8)
            return cls.get_adapter(DEFAULT_PROTOCOL_VERSION)

        if isinstance(payload, dict):
            if "messages" in payload and isinstance(payload["messages"], list):
                return cls.resolve_from_payload(payload["messages"])
            if "version" in payload and isinstance(payload["version"], str):
                ver_enum = cls._parse_version(payload["version"])
                if ver_enum:
                    return cls.get_adapter(ver_enum)
            if any(
                k in payload
                for k in (
                    "beginRendering",
                    "surfaceUpdate",
                    "dataModelUpdate",
                )
            ):
                return cls.get_adapter(ProtocolVersion.V0_8)

        # Default fallback for legacy payloads lacking explicit version header
        return cls.get_adapter(DEFAULT_PROTOCOL_VERSION)

    @classmethod
    def _parse_version(cls, version_str: str) -> Optional[ProtocolVersion]:
        """Parses a version string into an ProtocolVersion enum."""
        if not version_str.startswith("v"):
            version_str = f"v{version_str}"
        try:
            return ProtocolVersion(version_str)
        except ValueError:
            return None

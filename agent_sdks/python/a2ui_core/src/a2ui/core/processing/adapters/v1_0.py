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

"""VersionAdapter implementation for A2UI protocol v1.0."""

from typing import Any, Dict
from a2ui.core.schema.constants import A2uiProtocolVersion
from .base import VersionAdapter


class VersionAdapterV10(VersionAdapter):
    """Version adapter for A2UI protocol v1.0 payloads."""

    @property
    def version(self) -> A2uiProtocolVersion:
        """Returns the protocol version supported by this adapter."""
        return A2uiProtocolVersion.V1_0

    def extract_surface_properties(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts surface properties metadata from createSurface payload.

        Args:
            payload: CreateSurface envelope or payload dictionary.

        Returns:
            Extracted surface properties dictionary.
        """
        create_payload = payload.get("createSurface", payload)
        if isinstance(create_payload, dict):
            props = create_payload.get(
                "surfaceProperties",
                create_payload.get("metadata", create_payload.get("theme", {})),
            )
            if isinstance(props, dict):
                return props
        return {}

    def extract_initial_state(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts initial data model dictionary from createSurface payload.

        Args:
            payload: CreateSurface envelope or payload dictionary.

        Returns:
            Extracted initial data model dictionary.
        """
        create_payload = payload.get("createSurface", payload)
        if isinstance(create_payload, dict):
            data_model = create_payload.get("dataModel", {})
            if isinstance(data_model, dict):
                return data_model
        return {}

    def extract_message_type(self, payload: Dict[str, Any]) -> str:
        """Extracts message type key from envelope dictionary.

        Args:
            payload: Message envelope dictionary.

        Returns:
            Message type key string.
        """
        for key in payload.keys():
            if key != "version":
                return key
        return ""

    def normalize_message(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Normalizes v1.0 message payload into standard dictionary structure.

        Args:
            payload: Input message envelope dictionary.

        Returns:
            Normalized dictionary payload.
        """
        normalized = dict(payload)
        normalized["version"] = self.version.value
        return normalized

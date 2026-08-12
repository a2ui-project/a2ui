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
        """Extracts surface properties metadata from message payload.

        Args:
            payload: CreateSurface envelope or payload dictionary.

        Returns:
            Extracted surface properties dictionary.
        """
        if not isinstance(payload, dict):
            return {}
        if "createSurface" in payload:
            cs = payload["createSurface"]
            if isinstance(cs, dict):
                return {
                    "surface_id": cs.get("surfaceId"),
                    "catalog_id": cs.get("catalogId"),
                    "send_data_model": cs.get("sendDataModel"),
                    "metadata": cs.get("metadata"),
                }
        elif "updateComponents" in payload:
            uc = payload["updateComponents"]
            if isinstance(uc, dict):
                return {"surface_id": uc.get("surfaceId")}
        elif "updateDataModel" in payload:
            ud = payload["updateDataModel"]
            if isinstance(ud, dict):
                return {"surface_id": ud.get("surfaceId")}
        elif "deleteSurface" in payload:
            ds = payload["deleteSurface"]
            if isinstance(ds, dict):
                return {"surface_id": ds.get("surfaceId")}
        return {}

    def extract_initial_state(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts initial state dictionary from message payload.

        Args:
            payload: CreateSurface envelope or payload dictionary.

        Returns:
            Extracted initial data model dictionary.
        """
        if not isinstance(payload, dict):
            return {}
        if "createSurface" in payload:
            cs = payload["createSurface"]
            if isinstance(cs, dict):
                return {
                    "components": cs.get("components"),
                    "data_model": cs.get("dataModel"),
                }
        elif "updateComponents" in payload:
            uc = payload["updateComponents"]
            if isinstance(uc, dict):
                return {"components": uc.get("components")}
        elif "updateDataModel" in payload:
            ud = payload["updateDataModel"]
            if isinstance(ud, dict):
                path = ud.get("path", "/")
                return {"data_model": {path: ud.get("value")}}
        return {}

    def extract_message_type(self, payload: Dict[str, Any]) -> str:
        """Extracts message type key from envelope dictionary.

        Args:
            payload: Message envelope dictionary.

        Returns:
            Message type key string.
        """
        if not isinstance(payload, dict):
            return ""
        for msg_type in (
            "createSurface",
            "updateComponents",
            "updateDataModel",
            "deleteSurface",
            "callRendererFunction",
            "agentFunctionResponse",
            "action",
            "callAgentFunction",
            "rendererFunctionResponse",
            "error",
        ):
            if msg_type in payload:
                return msg_type
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

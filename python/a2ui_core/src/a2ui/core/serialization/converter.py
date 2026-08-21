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

"""Bidirectional converter between Python dictionary payloads and Protobuf message objects."""

from typing import Any
from google.protobuf import json_format
from a2ui.core.proto.v1_0 import agent_to_renderer_pb2
from a2ui.core.proto.v1_0 import renderer_to_agent_pb2
from a2ui.core.exceptions import A2uiValidationError


def _normalize_payload_for_proto(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalizes flat A2UI component dictionaries into Protobuf Component message structure."""
    normalized = dict(payload)
    std_component_keys = {
        "id",
        "component",
        "catalogId",
        "catalog_id",
        "accessibility",
        "metadata",
        "properties",
    }

    def _normalize_comp(comp: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(comp, dict):
            return comp
        extra_keys = {k: v for k, v in comp.items() if k not in std_component_keys}
        if extra_keys:
            comp_norm = {k: v for k, v in comp.items() if k in std_component_keys}
            props = dict(comp.get("properties", {}))
            props.update(extra_keys)
            comp_norm["properties"] = props
            return comp_norm
        return comp

    if "createSurface" in normalized and isinstance(normalized["createSurface"], dict):
        cs = dict(normalized["createSurface"])
        if "components" in cs and isinstance(cs["components"], list):
            cs["components"] = [_normalize_comp(c) for c in cs["components"]]
        normalized["createSurface"] = cs

    if "updateComponents" in normalized and isinstance(
        normalized["updateComponents"], dict
    ):
        uc = dict(normalized["updateComponents"])
        if "components" in uc and isinstance(uc["components"], list):
            uc["components"] = [_normalize_comp(c) for c in uc["components"]]
        normalized["updateComponents"] = uc

    return normalized


def _denormalize_payload_from_proto(payload: dict[str, Any]) -> dict[str, Any]:
    """Flattens Protobuf Component.properties back into top-level component properties."""
    denormalized = dict(payload)

    def _denormalize_comp(comp: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(comp, dict):
            return comp
        comp_flat = dict(comp)
        if "properties" in comp_flat and isinstance(comp_flat["properties"], dict):
            props = comp_flat.pop("properties")
            comp_flat.update(props)
        return comp_flat

    if "createSurface" in denormalized and isinstance(
        denormalized["createSurface"], dict
    ):
        cs = dict(denormalized["createSurface"])
        if "components" in cs and isinstance(cs["components"], list):
            cs["components"] = [_denormalize_comp(c) for c in cs["components"]]
        denormalized["createSurface"] = cs

    if "updateComponents" in denormalized and isinstance(
        denormalized["updateComponents"], dict
    ):
        uc = dict(denormalized["updateComponents"])
        if "components" in uc and isinstance(uc["components"], list):
            uc["components"] = [_denormalize_comp(c) for c in uc["components"]]
        denormalized["updateComponents"] = uc

    return denormalized


def dict_to_agent_message(
    payload: dict[str, Any], ignore_unknown_fields: bool = False
) -> agent_to_renderer_pb2.AgentToRendererMessage:
    """Converts an A2UI dictionary into an AgentToRendererMessage Protobuf instance.

    Args:
        payload: Dictionary conforming to A2UI Agent-to-Renderer schema.
        ignore_unknown_fields: If True, unknown fields are silently ignored.

    Returns:
        AgentToRendererMessage protobuf instance.

    Raises:
        A2uiValidationError: If conversion fails due to invalid schema structure.
    """
    try:
        norm_payload = _normalize_payload_for_proto(payload)
        message = agent_to_renderer_pb2.AgentToRendererMessage()
        json_format.ParseDict(
            norm_payload, message, ignore_unknown_fields=ignore_unknown_fields
        )
        return message
    except Exception as e:
        raise A2uiValidationError(
            f"Failed to parse dictionary into AgentToRendererMessage: {e}"
        ) from e


def agent_message_to_dict(
    message: agent_to_renderer_pb2.AgentToRendererMessage,
    preserving_proto_field_name: bool = False,
) -> dict[str, Any]:
    """Converts an AgentToRendererMessage Protobuf instance into a Python dictionary.

    Args:
        message: AgentToRendererMessage protobuf instance.
        preserving_proto_field_name: If True, preserves snake_case proto field names.
            If False (default), converts to camelCase JSON field names.

    Returns:
        Python dictionary conforming to A2UI JSON schema.
    """
    raw_dict = json_format.MessageToDict(
        message,
        preserving_proto_field_name=preserving_proto_field_name,
        use_integers_for_enums=False,
    )
    return _denormalize_payload_from_proto(raw_dict)


def dict_to_renderer_message(
    payload: dict[str, Any], ignore_unknown_fields: bool = False
) -> renderer_to_agent_pb2.RendererToAgentMessage:
    """Converts an A2UI dictionary into a RendererToAgentMessage Protobuf instance.

    Args:
        payload: Dictionary conforming to A2UI Renderer-to-Agent schema.
        ignore_unknown_fields: If True, unknown fields are silently ignored.

    Returns:
        RendererToAgentMessage protobuf instance.

    Raises:
        A2uiValidationError: If conversion fails due to invalid schema structure.
    """
    try:
        message = renderer_to_agent_pb2.RendererToAgentMessage()
        json_format.ParseDict(
            payload, message, ignore_unknown_fields=ignore_unknown_fields
        )
        return message
    except Exception as e:
        raise A2uiValidationError(
            f"Failed to parse dictionary into RendererToAgentMessage: {e}"
        ) from e


def renderer_message_to_dict(
    message: renderer_to_agent_pb2.RendererToAgentMessage,
    preserving_proto_field_name: bool = False,
) -> dict[str, Any]:
    """Converts a RendererToAgentMessage Protobuf instance into a Python dictionary.

    Args:
        message: RendererToAgentMessage protobuf instance.
        preserving_proto_field_name: If True, preserves snake_case proto field names.
            If False (default), converts to camelCase JSON field names.

    Returns:
        Python dictionary conforming to A2UI JSON schema.
    """
    return json_format.MessageToDict(
        message,
        preserving_proto_field_name=preserving_proto_field_name,
        use_integers_for_enums=False,
    )

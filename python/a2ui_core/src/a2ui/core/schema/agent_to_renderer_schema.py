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

"""Provides dynamic agent_to_renderer (server_to_client) JSON schema generation from Pydantic models."""

from __future__ import annotations

import copy
import importlib
import json
from typing import Any, Final, NamedTuple, cast, get_args

from ..exceptions import A2uiError
from . import ProtocolVersion
from ._dynamic_types import clean_schema_node
from ._json_schema import inline_marked_defs, spec_schema
from .common_types_schema import (
    _raw_symbol_schema,
    _strip_const_implied_keywords,
    get_common_types_symbols,
    get_dynamic_type_index,
)

# Agent-to-renderer schema module and $id URI (None for v0.8) by protocol version.
_AGENT_TO_RENDERER_SPECS: Final[dict[ProtocolVersion, tuple[str, str | None]]] = {
    ProtocolVersion.V0_8: ("a2ui.core.schema.v0_8.server_to_client", None),
    ProtocolVersion.V0_9: (
        "a2ui.core.schema.v0_9.server_to_client",
        "https://a2ui.org/specification/v0_9/server_to_client.json",
    ),
    ProtocolVersion.V0_9_1: (
        "a2ui.core.schema.v0_9.server_to_client",
        "https://a2ui.org/specification/v0_9/server_to_client.json",
    ),
    ProtocolVersion.V1_0: (
        "a2ui.core.schema.v1_0.agent_to_renderer",
        "https://a2ui.org/specification/v1_0/agent_to_renderer.json",
    ),
}


def _rewrite_common_type_refs(node: Any, common_names: frozenset[str]) -> Any:
    """Rewrites local `#/$defs/<Name>` references to `common_types.json#/$defs/<Name>`."""
    if isinstance(node, list):
        return [_rewrite_common_type_refs(item, common_names) for item in node]
    if not isinstance(node, dict):
        return node
    rewritten = {k: _rewrite_common_type_refs(v, common_names) for k, v in node.items()}
    ref = rewritten.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        target = ref[len("#/$defs/") :]
        if target in common_names:
            rewritten["$ref"] = f"common_types.json#/$defs/{target}"
    return rewritten


def _normalize_message_version(
    def_schema: dict[str, Any], protocol_version: ProtocolVersion
) -> None:
    """Normalizes the `version` property schema on a message definition."""
    props = def_schema.get("properties")
    if not isinstance(props, dict) or "version" not in props:
        return
    version_prop = props["version"]
    if not isinstance(version_prop, dict):
        return
    # `a2ui.core.schema.v0_9` serves both v0.9 and v0.9.1 using
    # `Literal["v0.9", "v0.9.1"]`. The v0.9 specification pins `"const": "v0.9"`,
    # whereas v0.9.1 publishes `"enum": ["v0.9", "v0.9.1"]`.
    if protocol_version == ProtocolVersion.V0_9:
        props["version"] = {"const": protocol_version.value}
    elif "enum" in version_prop:
        props["version"] = {"enum": list(version_prop["enum"])}


def _build_agent_to_renderer_schema(
    protocol_version: ProtocolVersion,
) -> dict[str, Any]:
    """Re-generates the agent_to_renderer JSON schema from Pydantic models."""
    spec_info = _AGENT_TO_RENDERER_SPECS.get(protocol_version)
    if spec_info is None:
        raise A2uiError(
            "agent_to_renderer schema is not available for protocol version"
            f" '{protocol_version}'."
        )
    module_name, schema_id = spec_info
    mod = importlib.import_module(module_name)
    defs_manifest: dict[str, Any] | None = getattr(mod, "AGENT_TO_RENDERER_DEFS", None)
    if not defs_manifest:
        raise A2uiError(
            f"Schema module '{module_name}' does not define AGENT_TO_RENDERER_DEFS."
        )

    dynamic_index = get_dynamic_type_index(protocol_version)
    common_names: frozenset[str] = (
        frozenset(get_common_types_symbols(protocol_version))
        if schema_id is not None
        else frozenset()
    )

    raw_defs: dict[str, Any] = {}
    helper_defs: dict[str, Any] = {}
    with spec_schema():
        for def_name, symbol in defs_manifest.items():
            raw_defs[def_name], nested = _raw_symbol_schema(def_name, symbol)
            for nested_name, nested_def in nested.items():
                if nested_name not in defs_manifest and nested_name not in common_names:
                    helper_defs.setdefault(nested_name, nested_def)

    cleaned_defs: dict[str, Any] = {
        def_name: cast(
            dict[str, Any], clean_schema_node(raw, dynamic_index=dynamic_index)
        )
        for def_name, raw in raw_defs.items()
    }
    cleaned_helpers: dict[str, Any] = {
        helper_name: clean_schema_node(helper_def, dynamic_index=dynamic_index)
        for helper_name, helper_def in helper_defs.items()
    }
    inlined_defs = inline_marked_defs({"$defs": {**cleaned_defs, **cleaned_helpers}})[
        "$defs"
    ]

    published_defs: dict[str, Any] = {
        def_name: _strip_const_implied_keywords(
            _rewrite_common_type_refs(inlined_defs[def_name], common_names)
        )
        for def_name in defs_manifest
    }

    description = (mod.__doc__ or "").strip()
    if schema_id is None:
        return {
            "title": "A2UI Message Schema",
            "description": description,
            "type": "object",
            "additionalProperties": False,
            "properties": published_defs,
        }

    for def_schema in published_defs.values():
        _normalize_message_version(def_schema, protocol_version)

    message_union = getattr(mod, "AgentToRendererMessage", None)
    if message_union is None:
        raise A2uiError(
            f"Schema module '{module_name}' does not define AgentToRendererMessage."
        )
    one_of = [{"$ref": f"#/$defs/{cls.__name__}"} for cls in get_args(message_union)]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": schema_id,
        "title": "A2UI Message Schema",
        "description": description,
        "type": "object",
        "oneOf": one_of,
        "$defs": published_defs,
    }


class _CachedAgentToRenderer(NamedTuple):
    schema: dict[str, Any]
    json: str


_SCHEMA_CACHE: dict[ProtocolVersion, _CachedAgentToRenderer] = {}


def _get_agent_to_renderer_schema(
    protocol_version: ProtocolVersion,
) -> _CachedAgentToRenderer:
    """Returns the cached agent_to_renderer schema for a protocol version."""
    if protocol_version not in _SCHEMA_CACHE:
        schema = _build_agent_to_renderer_schema(protocol_version)
        _SCHEMA_CACHE[protocol_version] = _CachedAgentToRenderer(
            schema=schema,
            json=json.dumps(schema, indent=2),
        )
    return _SCHEMA_CACHE[protocol_version]


def get_agent_to_renderer_schema_map(
    protocol_version: ProtocolVersion,
) -> dict[str, Any]:
    """Returns the agent_to_renderer (server_to_client) JSON schema as a dictionary.

    Args:
        protocol_version: The protocol version. Use `to_protocol_version` to
            convert a version string.

    Returns:
        A fresh copy of the schema generated from the build-time Pydantic models.

    Raises:
        A2uiError: If the protocol version is not supported.
    """
    return copy.deepcopy(_get_agent_to_renderer_schema(protocol_version).schema)


def get_agent_to_renderer_schema_json(
    protocol_version: ProtocolVersion,
) -> str:
    """Returns the agent_to_renderer (server_to_client) JSON schema as a JSON string.

    Args:
        protocol_version: The protocol version. Use `to_protocol_version` to
            convert a version string.

    Raises:
        A2uiError: If the protocol version is not supported.
    """
    return _get_agent_to_renderer_schema(protocol_version).json


__all__ = [
    "get_agent_to_renderer_schema_json",
    "get_agent_to_renderer_schema_map",
]

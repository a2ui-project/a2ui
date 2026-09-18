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

"""FastMCP Perception-Action Loop Server for A2UI.

Provides agent-native MCP tools:
- a2ui_list_components: live ground truth for catalog component schemas and reference topology
- a2ui_validate: structured diagnostics with difflib did-you-mean suggestions and host target enforcement
- a2ui_render: renders A2UI payload to PNG ImageContent for multimodal agents
- a2ui_simulate_action: in-memory action resolution and dispatching via SurfaceModel and NodeGraph
"""

from __future__ import annotations

import concurrent.futures
import datetime
import difflib
from typing import Any, Dict, List, Optional, Set, Union

from a2ui.cli.catalog import (
    extract_component_properties,
    extract_component_required_fields,
    resolve_catalog,
    simplify_property_type,
)
from a2ui.core import A2uiValidationError
from a2ui.core.processing import MessageProcessor
from a2ui.core.state import NodeGraph
from a2ui.core.validating.catalog_schema_validator import CatalogSchemaValidator
from a2ui.render.engine import render_payload_to_png
from a2ui.targets import HostTargetProfile, TargetProfileError
from a2ui.validation.validator import A2uiValidator
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.utilities.types import Image

mcp = FastMCP("a2ui-mcp")


def _extract_messages(payload: Any) -> List[Dict[str, Any]]:
    """Normalizes payload into a list of A2UI message dicts."""
    if isinstance(payload, list):
        return [m for m in payload if isinstance(m, dict)]
    if isinstance(payload, dict):
        if "messages" in payload and isinstance(payload["messages"], list):
            return [m for m in payload["messages"] if isinstance(m, dict)]
        if "root" in payload and isinstance(payload["root"], dict):
            data = payload["root"].get("data")
            if isinstance(data, list):
                return [m for m in data if isinstance(m, dict)]
            if isinstance(data, dict):
                return _extract_messages(data)
        if any(
            k in payload
            for k in (
                "createSurface",
                "updateComponents",
                "updateDataModel",
                "deleteSurface",
            )
        ):
            return [payload]
        if "components" in payload and isinstance(payload["components"], list):
            return [{
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": payload.get("surfaceId", "default-surface"),
                    "components": payload["components"],
                },
            }]
    return []


@mcp.tool()
def a2ui_list_components(
    catalog: str = "basic",
    filter: Optional[str] = None,
) -> dict:
    """Lists components and schemas from a catalog to eliminate agent hallucination.

    Args:
        catalog: Catalog name ("basic", "gemini_enterprise_composite"), file path, or URL.
        filter: Optional substring to filter component names (e.g., "Material").

    Returns:
        Dictionary containing catalog metadata, components inventory, property schemas,
        required fields, and reference topology.
    """
    try:
        catalog_name, schema, a2ui_cat, core_cat = resolve_catalog(catalog)
    except Exception as exc:
        return {
            "error": f"Failed to resolve catalog '{catalog}': {exc}",
            "catalog": catalog,
            "components": {},
            "reference_topology": {
                "components_with_refs": 0,
                "references": {},
            },
        }

    validator = CatalogSchemaValidator(core_cat)
    ref_fields = validator.extract_ref_fields()
    required_fields = extract_component_required_fields(schema)
    components_dict = schema.get("components", {})

    catalog_meta_id = schema.get("catalogId", schema.get("$id", catalog_name))

    filter_str = str(filter) if filter is not None else None

    described_components: Dict[str, Any] = {}
    for comp_name, comp_schema in sorted(components_dict.items()):
        if filter_str and filter_str not in comp_name:
            continue

        comp_props = extract_component_properties(comp_schema, schema)
        req_set = required_fields.get(comp_name, set())

        prop_details: Dict[str, Any] = {}
        for p_name, p_schema in sorted(comp_props.items()):
            prop_details[p_name] = {
                "type": simplify_property_type(p_schema),
                "required": p_name in req_set,
                "description": p_schema.get("description", ""),
            }

        ref_info = ref_fields.get(comp_name)
        single_refs = sorted(list(ref_info[0])) if ref_info else []
        list_refs = sorted(list(ref_info[1])) if ref_info else []
        raw_nested = getattr(ref_info, "nested_refs", {}) if ref_info else {}
        nested_refs = {
            nk: sorted(list(nv)) if isinstance(nv, (set, frozenset)) else nv
            for nk, nv in raw_nested.items()
        }

        described_components[comp_name] = {
            "description": comp_schema.get("description", ""),
            "required_fields": sorted(list(req_set)),
            "properties": prop_details,
            "references": {
                "single": single_refs,
                "list": list_refs,
                "nested": nested_refs,
            },
        }

    # Reference topology summary
    topology_summary: Dict[str, Any] = {
        "components_with_refs": len(ref_fields),
        "references": {},
    }
    for comp_name, refs in sorted(ref_fields.items()):
        topology_summary["references"][comp_name] = {
            "single": sorted(list(refs[0])),
            "list": sorted(list(refs[1])),
            "nested": {
                nk: sorted(list(nv)) if isinstance(nv, (set, frozenset)) else nv
                for nk, nv in getattr(refs, "nested_refs", {}).items()
            },
        }

    return {
        "catalog_id": catalog_meta_id,
        "name": catalog_name,
        "version": "0.9",
        "component_count": len(described_components),
        "components": described_components,
        "reference_topology": topology_summary,
    }


@mcp.tool()
def a2ui_validate(
    payload: Union[dict, list],
    catalog: str = "basic",
    target: Optional[str] = None,
) -> dict:
    """Validates an A2UI payload against catalog schemas, target profiles, and did-you-mean hints.

    Args:
        payload: The A2UI payload (JSON object, list of messages, or dict containing messages).
        catalog: The catalog to validate against (defaults to "basic").
        target: Optional host target profile name (e.g. "gemini-enterprise") or path.

    Returns:
        Structured diagnostics dictionary with 'valid', 'errors', and suggestions.
    """
    if not payload:
        return {
            "valid": False,
            "status": "error",
            "error_count": 1,
            "errors": [{
                "type": "empty_payload",
                "message": "Payload is empty or contains no valid A2UI messages.",
                "suggestion": None,
            }],
        }

    all_errors: List[Dict[str, Any]] = []
    catalog_to_use = catalog or "basic"

    # 1. Target Profile Enforcement
    target_profile: Optional[HostTargetProfile] = None
    if target:
        try:
            target_profile = HostTargetProfile.load(target)
            if catalog == "basic" and target_profile.catalog:
                catalog_to_use = target_profile.catalog
        except TargetProfileError as exc:
            return {
                "valid": False,
                "status": "error",
                "error_count": 1,
                "errors": [{
                    "type": "target_profile_error",
                    "message": str(exc),
                    "suggestion": None,
                }],
            }
        except Exception as exc:
            return {
                "valid": False,
                "status": "error",
                "error_count": 1,
                "errors": [{
                    "type": "target_profile_error",
                    "message": f"Failed to load target profile '{target}': {exc}",
                    "suggestion": None,
                }],
            }

        t_errors = target_profile.validate_payload(payload)
        for te in t_errors:
            all_errors.append({
                "type": "target_profile_incompatibility",
                "target": target_profile.name,
                "message": te,
                "suggestion": None,
            })

    # 2. Extract messages
    messages = _extract_messages(payload)
    if not messages:
        all_errors.append({
            "type": "empty_payload",
            "message": "Payload does not contain valid A2UI message structures.",
            "suggestion": None,
        })
        return {
            "valid": False,
            "status": "error",
            "error_count": len(all_errors),
            "errors": all_errors,
        }

    # 3. Resolve Catalog
    try:
        catalog_name, catalog_schema, a2ui_cat, core_cat = resolve_catalog(
            catalog_to_use
        )
    except Exception as exc:
        all_errors.append({
            "type": "catalog_error",
            "message": f"Catalog resolution error for '{catalog_to_use}': {exc}",
            "suggestion": None,
        })
        return {
            "valid": False,
            "status": "error",
            "error_count": len(all_errors),
            "errors": all_errors,
        }

    # 4. Component and Property Inspection with difflib suggestions
    valid_component_names = list(core_cat.components.keys())
    has_unknown_component = False

    for msg in messages:
        if "updateComponents" not in msg or not isinstance(
            msg["updateComponents"], dict
        ):
            continue
        components = msg["updateComponents"].get("components", [])
        if not isinstance(components, list):
            continue

        for comp in components:
            if not isinstance(comp, dict):
                continue
            c_id = str(comp.get("id", "unknown"))
            c_type = comp.get("component")

            if not c_type:
                all_errors.append({
                    "type": "missing_component_type",
                    "id": c_id,
                    "message": (
                        f"Component '{c_id}' is missing required 'component' field."
                    ),
                    "suggestion": None,
                })
                continue

            if c_type not in core_cat.components:
                has_unknown_component = True
                matches = difflib.get_close_matches(
                    str(c_type), valid_component_names, n=3, cutoff=0.35
                )
                suggestion = matches[0] if matches else None
                msg_str = f"Unknown component type '{c_type}' (id: '{c_id}')."
                if suggestion:
                    msg_str += f" Did you mean '{suggestion}'?"
                all_errors.append({
                    "type": "unknown_component",
                    "component": c_type,
                    "id": c_id,
                    "message": msg_str,
                    "suggestion": suggestion,
                })
            else:
                comp_schema = catalog_schema.get("components", {}).get(c_type, {})
                valid_props = set(
                    extract_component_properties(comp_schema, catalog_schema).keys()
                ) | {
                    "id",
                    "component",
                }

                for prop_name in comp.keys():
                    if prop_name not in valid_props:
                        prop_str = str(prop_name)
                        p_matches = difflib.get_close_matches(
                            prop_str, list(valid_props), n=3, cutoff=0.35
                        )
                        p_suggestion = p_matches[0] if p_matches else None
                        p_msg_str = (
                            f"Invalid property '{prop_name}' on component '{c_type}'"
                            f" (id: '{c_id}')."
                        )
                        if p_suggestion:
                            p_msg_str += f" Did you mean '{p_suggestion}'?"
                        all_errors.append({
                            "type": "invalid_property",
                            "component": c_type,
                            "property": prop_name,
                            "id": c_id,
                            "message": p_msg_str,
                            "suggestion": p_suggestion,
                        })

    # 5. Upstream Schema Validation
    if not has_unknown_component:
        try:
            validator = A2uiValidator(a2ui_cat)
            validator.validate(messages)
        except A2uiValidationError as exc:
            if hasattr(exc, "details") and exc.details:
                for d in exc.details:
                    all_errors.append({
                        "type": "schema_validation_error",
                        "path": getattr(d, "path", ""),
                        "code": getattr(d, "code", "schema_error"),
                        "message": getattr(d, "message", str(d)),
                        "suggestion": None,
                    })
            else:
                for line in str(exc).splitlines():
                    if line.strip():
                        all_errors.append({
                            "type": "schema_validation_error",
                            "message": line.strip(),
                            "suggestion": None,
                        })
        except Exception as exc:
            all_errors.append({
                "type": "validation_exception",
                "message": str(exc),
                "suggestion": None,
            })

    is_valid = len(all_errors) == 0
    return {
        "valid": is_valid,
        "status": "ok" if is_valid else "error",
        "error_count": len(all_errors),
        "errors": all_errors,
    }


@mcp.tool()
def a2ui_render(
    payload: Union[dict, list],
    catalog: str = "basic",
    width: int = 800,
) -> Image:
    """Renders an A2UI payload to PNG and returns a FastMCP Image to close the visual loop.

    Args:
        payload: The A2UI payload (JSON object, list of messages, or dict containing messages).
        catalog: Catalog name to use for rendering (default: "basic").
        width: Viewport width in pixels (default: 800).

    Returns:
        FastMCP Image object containing raw PNG bytes.
    """
    # Execute rendering in a separate worker thread so Playwright sync API
    # safely operates isolated from any surrounding asyncio event loop.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            render_payload_to_png,
            payload=payload,
            width=width,
            catalog_id=catalog,
        )
        png_bytes = future.result()
    return Image(data=png_bytes, format="png")


@mcp.tool()
def a2ui_simulate_action(
    payload: Union[dict, list],
    component_id: str,
) -> dict:
    """Simulates an action dispatch on a component without requiring a browser.

    Resolves action bindings via a2ui_core's MessageProcessor, SurfaceModel, and
    NodeGraph, invokes the action closure, and returns the structured action event.

    Args:
        payload: The A2UI payload containing component and action declarations.
        component_id: The ID of the component to trigger (e.g. "action_button").

    Returns:
        Structured action event dict: {name, surfaceId, sourceComponentId, timestamp, context}.
    """
    if not payload:
        return {
            "error": "Payload is empty or None",
            "status": "error",
            "success": False,
        }

    messages = _extract_messages(payload)
    if not messages:
        return {
            "error": "No valid A2UI messages found in payload",
            "status": "error",
            "success": False,
        }

    # Identify created surfaces and referenced surfaces
    created_surfaces: Set[str] = set()
    referenced_surfaces: Set[str] = set()
    inferred_catalog = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"

    for msg in messages:
        if "createSurface" in msg and isinstance(msg["createSurface"], dict):
            cs = msg["createSurface"]
            sid = cs.get("surfaceId")
            if sid:
                created_surfaces.add(str(sid))
            cat = cs.get("catalogId")
            if cat and isinstance(cat, str):
                inferred_catalog = cat
        if "updateComponents" in msg and isinstance(msg["updateComponents"], dict):
            sid = msg["updateComponents"].get("surfaceId")
            if sid:
                referenced_surfaces.add(str(sid))
        if "updateDataModel" in msg and isinstance(msg["updateDataModel"], dict):
            sid = msg["updateDataModel"].get("surfaceId")
            if sid:
                referenced_surfaces.add(str(sid))

    # Synthesize missing createSurface messages if needed
    prepended_messages: List[Dict[str, Any]] = []
    missing_surfaces = referenced_surfaces - created_surfaces
    if not created_surfaces and not missing_surfaces:
        missing_surfaces = {"default-surface"}

    for sid in sorted(missing_surfaces):
        prepended_messages.append({
            "version": "v0.9",
            "createSurface": {
                "surfaceId": sid,
                "catalogId": inferred_catalog,
            },
        })

    all_messages = prepended_messages + messages

    # Load core catalogs
    catalogs = []
    try:
        _, _, _, basic_cat = resolve_catalog("basic")
        catalogs.append(basic_cat)
    except Exception:
        pass
    try:
        _, _, _, ge_cat = resolve_catalog("gemini_enterprise_composite")
        catalogs.append(ge_cat)
    except Exception:
        pass

    emitted_actions: List[Dict[str, Any]] = []

    def action_sink(action_event: Dict[str, Any]) -> None:
        emitted_actions.append(action_event)

    processor = MessageProcessor(catalogs=catalogs, action_handler=action_sink)
    try:
        processor.process_messages(all_messages)
    except Exception as exc:
        return {
            "error": f"Failed to process messages: {exc}",
            "status": "error",
            "success": False,
        }

    # Locate component across surfaces
    target_surface = None
    target_comp = None
    for sid, surf in processor.model.surfaces.items():
        comp = surf.components_model.get(component_id)
        if comp is not None:
            target_surface = surf
            target_comp = comp
            break

    if target_surface is None or target_comp is None:
        return {
            "error": f"Component '{component_id}' not found in any surface",
            "status": "error",
            "success": False,
        }

    # Subscribe surface on_action as well
    target_surface.on_action.subscribe(action_sink)

    # Resolve node and action closure
    graph = NodeGraph(target_surface)
    node = graph.get_or_create_node(component_id, "/")

    action_callable = None
    props = node.props.value or {}
    if callable(props.get("action")):
        action_callable = props["action"]
    else:
        for k, v in props.items():
            if callable(v):
                action_callable = v
                break

    if action_callable is None:
        return {
            "error": f"Component '{component_id}' has no action defined",
            "status": "error",
            "action": None,
            "event": None,
        }

    try:
        action_callable()
    except Exception as exc:
        return {
            "error": f"Action invocation raised error: {exc}",
            "status": "error",
            "success": False,
        }

    if emitted_actions:
        return emitted_actions[-1]

    # Fallback event if closure executed without triggering sink
    return {
        "name": "action_dispatched",
        "surfaceId": target_surface.id,
        "sourceComponentId": component_id,
        "timestamp": (
            datetime.datetime.now(datetime.timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        ),
        "context": {},
    }


if __name__ == "__main__":
    mcp.run()

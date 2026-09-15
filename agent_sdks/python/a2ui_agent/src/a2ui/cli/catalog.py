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

"""Catalog inspection and comparison commands."""

from __future__ import annotations

import importlib.resources
import json
import os
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

from a2ui.core.catalog import Catalog
from a2ui.core.validating.catalog_schema_validator import CatalogSchemaValidator
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.schema.catalog_provider import FileSystemCatalogProvider
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.utils import find_repo_root

from .formatters import (
    print_error,
    print_header,
    print_info,
    print_json,
    print_success,
    print_table,
    print_warning,
)


def _find_file(relative_candidates: List[str]) -> Optional[str]:
    """Attempts to find a file from repository root or current directory."""
    root = find_repo_root(os.getcwd()) or find_repo_root(__file__) or os.getcwd()
    for rel in relative_candidates:
        p1 = os.path.join(root, rel)
        if os.path.isfile(p1):
            return p1
        p2 = os.path.abspath(rel)
        if os.path.isfile(p2):
            return p2
    return None


def resolve_catalog(
    catalog_identifier: str,
) -> Tuple[str, Dict[str, Any], A2uiCatalog, Catalog]:
    """Resolves a catalog identifier into schema dict, A2uiCatalog, and core Catalog.

    Args:
        catalog_identifier: Name ("basic", "gemini_enterprise_composite"), path, or URL.

    Returns:
        Tuple of (catalog_name, catalog_schema, A2uiCatalog, Catalog).

    Raises:
        ValueError: If catalog cannot be resolved or loaded.
    """
    catalog_path: Optional[str] = None
    catalog_name = catalog_identifier

    # Handle standard alias names
    norm = catalog_identifier.lower().replace("-", "_")
    if norm in ("basic", "standard"):
        catalog_name = "basic"
        catalog_path = _find_file([
            "specification/v0_9/catalogs/basic/catalog.json",
            "agent_sdks/python/a2ui_agent/src/a2ui/assets/0.9/catalog.json",
        ])
    elif norm in (
        "gemini_enterprise_composite",
        "gemini_enterprise",
        "gemini_composite",
    ):
        catalog_name = "gemini_enterprise_composite"
        catalog_path = _find_file([
            "samples/community/agent/adk/gemini_enterprise/v0_9/gemini_enterprise_composite_catalog.json",
            "agent_sdks/python/a2ui_agent/src/a2ui/targets/profiles/gemini_enterprise_composite_catalog.json",
        ])
    elif os.path.isfile(catalog_identifier):
        catalog_path = catalog_identifier
        catalog_name = os.path.splitext(os.path.basename(catalog_identifier))[0]
    elif catalog_identifier.startswith(("http://", "https://")):
        # Check if matching known URLs
        if "specification/v0_9/catalogs/basic/catalog.json" in catalog_identifier:
            catalog_name = "basic"
            catalog_path = _find_file([
                "specification/v0_9/catalogs/basic/catalog.json",
                "agent_sdks/python/a2ui_agent/src/a2ui/assets/0.9/catalog.json",
            ])
        elif "gemini_enterprise_composite_catalog.json" in catalog_identifier:
            catalog_name = "gemini_enterprise_composite"
            catalog_path = _find_file([
                "samples/community/agent/adk/gemini_enterprise/v0_9/gemini_enterprise_composite_catalog.json",
                "agent_sdks/python/a2ui_agent/src/a2ui/targets/profiles/gemini_enterprise_composite_catalog.json",
            ])
        else:
            # Download remote catalog
            try:
                import httpx

                resp = httpx.get(catalog_identifier, timeout=10.0)
                resp.raise_for_status()
                schema = resp.json()
                catalog_name = schema.get("catalogId", catalog_identifier)
                core_cat = Catalog.from_json(schema, spec_version="0.9")
                cfg = CatalogConfig(
                    name=catalog_name,
                    provider=FileSystemCatalogProvider(catalog_identifier),
                )
                a2ui_cat = A2uiCatalog(
                    version="0.9",
                    name=catalog_name,
                    catalog_schema=schema,
                    s2c_schema={},
                    common_types_schema={},
                )
                return catalog_name, schema, a2ui_cat, core_cat
            except Exception as e:
                raise ValueError(
                    f"Failed to fetch remote catalog '{catalog_identifier}': {e}"
                ) from e

    if not catalog_path or not os.path.isfile(catalog_path):
        raise ValueError(
            f"Could not resolve catalog '{catalog_identifier}'. Expected valid file"
            " path, URL, or alias ('basic', 'gemini_enterprise_composite')."
        )

    with open(catalog_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    core_cat = Catalog.from_json(schema, spec_version="0.9")
    cfg = CatalogConfig(
        name=catalog_name, provider=FileSystemCatalogProvider(catalog_path)
    )
    a2ui_cat = A2uiCatalog.from_config(cfg, version="0.9")

    return catalog_name, schema, a2ui_cat, core_cat


def extract_component_required_fields(
    catalog_schema: Dict[str, Any],
) -> Dict[str, Set[str]]:
    """Recursively extracts required property names for each component in catalog schema.

    Traverses component definitions including allOf, anyOf, and oneOf blocks,
    and strips protocol metadata properties ('id', 'component').

    Args:
        catalog_schema: The parsed JSON schema of the catalog.

    Returns:
        Dict mapping component name to set of required property names.
    """
    result: Dict[str, Set[str]] = {}
    components = catalog_schema.get("components", {})
    if not isinstance(components, dict):
        return result

    for comp_name, comp_def in components.items():
        reqs = _extract_reqs_recursive(comp_def) - {"id", "component"}
        result[comp_name] = reqs
    return result


def _extract_reqs_recursive(schema: Any) -> Set[str]:
    """Helper to recursively extract 'required' fields from a schema node."""
    reqs: Set[str] = set()
    if not isinstance(schema, dict):
        return reqs

    if "required" in schema and isinstance(schema["required"], list):
        reqs.update(str(r) for r in schema["required"])

    for key in ("allOf", "anyOf", "oneOf"):
        if key in schema and isinstance(schema[key], list):
            for sub in schema[key]:
                reqs.update(_extract_reqs_recursive(sub))

    return reqs


def extract_component_properties(
    comp_schema: Any,
    catalog_schema: Optional[Dict[str, Any]] = None,
    visited: Optional[Set[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Extracts all property schemas for a component, traversing allOf/anyOf/oneOf and local $defs."""
    if visited is None:
        visited = set()
    props: Dict[str, Dict[str, Any]] = {}
    if not isinstance(comp_schema, dict):
        return props

    if (
        "$ref" in comp_schema
        and isinstance(comp_schema["$ref"], str)
        and catalog_schema
    ):
        ref = comp_schema["$ref"]
        if ref.startswith("#/$defs/"):
            def_name = ref.split("/")[-1]
            if def_name not in visited:
                visited.add(def_name)
                defs = catalog_schema.get("$defs", {})
                if def_name in defs:
                    props.update(
                        extract_component_properties(
                            defs[def_name], catalog_schema, visited
                        )
                    )

    if "properties" in comp_schema and isinstance(comp_schema["properties"], dict):
        for k, v in comp_schema["properties"].items():
            if k not in ("id", "component") and isinstance(v, dict):
                props[k] = v

    for key in ("allOf", "anyOf", "oneOf"):
        if key in comp_schema and isinstance(comp_schema[key], list):
            for sub in comp_schema[key]:
                sub_props = extract_component_properties(sub, catalog_schema, visited)
                props.update(sub_props)

    return props


def simplify_property_type(prop_def: Any) -> str:
    """Returns a concise human-readable description of a property's type."""
    if not isinstance(prop_def, dict):
        return "any"
    if "$ref" in prop_def and isinstance(prop_def["$ref"], str):
        ref = prop_def["$ref"]
        return ref.split("/")[-1].replace(".json", "")
    if "enum" in prop_def and isinstance(prop_def["enum"], list):
        vals = [str(x) for x in prop_def["enum"][:4]]
        if len(prop_def["enum"]) > 4:
            vals.append("...")
        return f"enum({', '.join(vals)})"
    if "oneOf" in prop_def and isinstance(prop_def["oneOf"], list):
        types = [simplify_property_type(x) for x in prop_def["oneOf"]]
        return " | ".join(dict.fromkeys(types))
    if "anyOf" in prop_def and isinstance(prop_def["anyOf"], list):
        types = [simplify_property_type(x) for x in prop_def["anyOf"]]
        return " | ".join(dict.fromkeys(types))
    if "type" in prop_def:
        t = prop_def["type"]
        if t == "array":
            items = prop_def.get("items", {})
            return f"array[{simplify_property_type(items)}]"
        return str(t)
    return "any"


def describe_catalog(catalog_id: str, as_json: bool = False) -> int:
    """Describes a catalog inventory, properties, required flags, and ref topology."""
    try:
        catalog_name, schema, a2ui_cat, core_cat = resolve_catalog(catalog_id)
    except Exception as e:
        print_error(str(e))
        return 1

    validator = CatalogSchemaValidator(core_cat)
    ref_fields = validator.extract_ref_fields()
    required_fields = extract_component_required_fields(schema)
    components_dict = schema.get("components", {})

    catalog_meta_id = schema.get("catalogId", schema.get("$id", catalog_name))

    described_components: Dict[str, Any] = {}
    for comp_name, comp_schema in sorted(components_dict.items()):
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

    output_data = {
        "catalog_id": catalog_meta_id,
        "name": catalog_name,
        "version": "0.9",
        "component_count": len(components_dict),
        "components": described_components,
        "reference_topology": topology_summary,
    }

    if as_json:
        print_json(output_data)
        return 0

    # Human-readable output
    print_header(
        f"Catalog: {catalog_name}",
        f"ID: {catalog_meta_id} ({len(components_dict)} components)",
    )

    # Inventory Table
    inv_rows = []
    for comp_name, data in described_components.items():
        reqs = ", ".join(data["required_fields"]) or "(none)"
        ref_parts = []
        if data["references"]["single"]:
            ref_parts.append(f"single: {', '.join(data['references']['single'])}")
        if data["references"]["list"]:
            ref_parts.append(f"list: {', '.join(data['references']['list'])}")
        ref_str = "; ".join(ref_parts) or "-"
        inv_rows.append([comp_name, str(len(data["properties"])), reqs, ref_str])

    print_table(
        f"{catalog_name} Component Inventory",
        ["Component", "Props", "Required Fields", "Child References"],
        inv_rows,
    )

    # Reference Topology Table
    topo_rows = []
    for comp_name, ref_data in topology_summary["references"].items():
        single = ", ".join(ref_data["single"]) or "-"
        list_r = ", ".join(ref_data["list"]) or "-"
        nested = str(ref_data["nested"]) if ref_data["nested"] else "-"
        topo_rows.append([comp_name, single, list_r, nested])

    print_table(
        "Reference Topology (Parent-Child Relationships)",
        ["Component", "Single References", "List References", "Nested References"],
        topo_rows,
    )

    print_success(
        f"Described {len(components_dict)} components with {len(ref_fields)}"
        " referencing containers."
    )
    return 0


def diff_catalogs(left: str, right: str, as_json: bool = False) -> int:
    """Compares two catalogs, reporting added/removed components and property changes."""
    try:
        left_name, left_schema, _, _ = resolve_catalog(left)
        right_name, right_schema, _, _ = resolve_catalog(right)
    except Exception as e:
        print_error(str(e))
        return 1

    left_comps = left_schema.get("components", {})
    right_comps = right_schema.get("components", {})

    left_keys = set(left_comps.keys())
    right_keys = set(right_comps.keys())

    added_components = sorted(list(right_keys - left_keys))
    removed_components = sorted(list(left_keys - right_keys))
    shared_components = sorted(list(left_keys & right_keys))

    left_reqs = extract_component_required_fields(left_schema)
    right_reqs = extract_component_required_fields(right_schema)

    modified_components: Dict[str, Any] = {}
    for comp_name in shared_components:
        lp = extract_component_properties(left_comps[comp_name], left_schema)
        rp = extract_component_properties(right_comps[comp_name], right_schema)

        added_props = sorted(list(set(rp.keys()) - set(lp.keys())))
        removed_props = sorted(list(set(lp.keys()) - set(rp.keys())))

        # Check required changes or type differences
        prop_diffs: Dict[str, Any] = {}
        for p in sorted(list(set(lp.keys()) & set(rp.keys()))):
            lt = simplify_property_type(lp[p])
            rt = simplify_property_type(rp[p])
            l_req = p in left_reqs.get(comp_name, set())
            r_req = p in right_reqs.get(comp_name, set())
            if lt != rt or l_req != r_req:
                prop_diffs[p] = {
                    "left": {"type": lt, "required": l_req},
                    "right": {"type": rt, "required": r_req},
                }

        if added_props or removed_props or prop_diffs:
            modified_components[comp_name] = {
                "added_properties": added_props,
                "removed_properties": removed_props,
                "property_changes": prop_diffs,
            }

    diff_data = {
        "left": {
            "name": left_name,
            "catalog_id": left_schema.get(
                "catalogId", left_schema.get("$id", left_name)
            ),
            "component_count": len(left_comps),
        },
        "right": {
            "name": right_name,
            "catalog_id": right_schema.get(
                "catalogId", right_schema.get("$id", right_name)
            ),
            "component_count": len(right_comps),
        },
        "added_components": added_components,
        "removed_components": removed_components,
        "modified_components": modified_components,
        "summary": {
            "added_count": len(added_components),
            "removed_count": len(removed_components),
            "modified_count": len(modified_components),
            "shared_count": len(shared_components),
        },
    }

    if as_json:
        print_json(diff_data)
        return 0

    # Human-readable output
    print_header(
        f"Catalog Diff: {left_name} → {right_name}",
        f"{len(added_components)} added, {len(removed_components)} removed,"
        f" {len(modified_components)} modified",
    )

    if added_components:
        print(f"\n[+] Added Components ({len(added_components)}):")
        for i, c in enumerate(added_components, 1):
            print(f"  {i:2d}. {c}")

    if removed_components:
        print(f"\n[-] Removed Components ({len(removed_components)}):")
        for i, c in enumerate(removed_components, 1):
            print(f"  {i:2d}. {c}")

    if modified_components:
        print(f"\n[*] Modified Components ({len(modified_components)}):")
        for comp_name, changes in modified_components.items():
            print(f"  • {comp_name}: ")
            if changes["added_properties"]:
                print(f"      Added props: {', '.join(changes['added_properties'])}")
            if changes["removed_properties"]:
                print(
                    f"      Removed props: {', '.join(changes['removed_properties'])}"
                )
            if changes["property_changes"]:
                for p, p_diff in changes["property_changes"].items():
                    print(
                        f"      Prop '{p}' changed: {p_diff['left']} →"
                        f" {p_diff['right']}"
                    )

    if not added_components and not removed_components and not modified_components:
        print_success("Catalogs are identical.")
    else:
        print_info(
            f"Diff complete: {len(added_components)} added, {len(removed_components)}"
            " removed."
        )

    return 0

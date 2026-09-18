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

"""Payload validation command wrapping A2uiValidator and HostTargetProfiles."""

from __future__ import annotations

import difflib
import json
import os
import sys
from typing import Any, Dict, List, Optional

from a2ui.core import A2uiValidationError
from a2ui.targets import HostTargetProfile, TargetProfileError
from a2ui.validation.validator import A2uiValidator

from .catalog import extract_component_properties, resolve_catalog
from .formatters import (
    print_error,
    print_header,
    print_info,
    print_json,
    print_success,
    print_warning,
)


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
    return []


def _infer_catalog_id(payload: Any) -> Optional[str]:
    """Infers catalog ID from createSurface message if present."""
    messages = _extract_messages(payload)
    for msg in messages:
        if "createSurface" in msg and isinstance(msg["createSurface"], dict):
            cs = msg["createSurface"]
            if "catalogId" in cs and isinstance(cs["catalogId"], str):
                return cs["catalogId"]
    return None


def check_payload(
    payload_path: str,
    target: Optional[str] = None,
    catalog_override: Optional[str] = None,
    as_json: bool = False,
) -> int:
    """Validates an A2UI payload file against schemas, did-you-mean suggestions, and target profiles.

    Args:
        payload_path: File path to payload JSON, or "-" for stdin.
        target: Optional host target profile name (e.g. "gemini-enterprise") or profile path.
        catalog_override: Optional catalog identifier overriding target default.
        as_json: Whether to emit output as JSON.

    Returns:
        0 if clean and valid, 1 on any error.
    """
    # 1. Read Payload
    content: str
    if payload_path == "-":
        content = sys.stdin.read()
    else:
        if not os.path.isfile(payload_path):
            err_msg = f"File not found: {payload_path}"
            if as_json:
                print_json({
                    "valid": False,
                    "status": "error",
                    "errors": [{"type": "file_not_found", "message": err_msg}],
                })
            else:
                print_error(err_msg)
            return 1
        with open(payload_path, "r", encoding="utf-8") as f:
            content = f.read()

    # 2. Parse JSON
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as e:
        err_msg = f"Invalid JSON syntax in {payload_path}: {e}"
        if as_json:
            print_json({
                "valid": False,
                "status": "error",
                "errors": [{"type": "syntax_error", "message": err_msg}],
            })
        else:
            print_error(err_msg)
        return 1

    all_errors: List[Dict[str, Any]] = []

    # 3. Target Profile Enforcement
    target_profile: Optional[HostTargetProfile] = None
    target_name = target
    catalog_to_use: str = catalog_override or "basic"

    if target:
        try:
            target_profile = HostTargetProfile.load(target)
            target_name = target_profile.name
            if not catalog_override:
                catalog_to_use = target_profile.catalog
        except TargetProfileError as e:
            err_msg = str(e)
            if as_json:
                print_json({
                    "valid": False,
                    "status": "error",
                    "errors": [{"type": "target_profile_error", "message": err_msg}],
                })
            else:
                print_error(err_msg)
            return 1

        # Run target profile checks
        t_errors = target_profile.validate_payload(payload)
        for te in t_errors:
            all_errors.append({
                "type": "target_profile_incompatibility",
                "target": target_name,
                "message": te,
                "suggestion": None,
            })
    else:
        inferred = _infer_catalog_id(payload)
        if inferred and not catalog_override:
            catalog_to_use = inferred

    # 4. Catalog Resolution
    try:
        catalog_name, catalog_schema, a2ui_cat, core_cat = resolve_catalog(
            catalog_to_use
        )
    except Exception as e:
        err_msg = f"Catalog resolution error for '{catalog_to_use}': {e}"
        if as_json:
            print_json({
                "valid": False,
                "status": "error",
                "errors": [{"type": "catalog_error", "message": err_msg}],
            })
        else:
            print_error(err_msg)
        return 1

    # 5. Component and Property Inspection with difflib Did-You-Mean suggestions
    valid_component_names = list(core_cat.components.keys())
    messages = _extract_messages(payload)

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
                # Unknown component type!
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
                # Component is valid; verify properties!
                comp_schema = catalog_schema.get("components", {}).get(c_type, {})
                valid_props = set(
                    extract_component_properties(comp_schema, catalog_schema).keys()
                ) | {"id", "component"}

                for prop_name in comp.keys():
                    if prop_name not in valid_props:
                        p_matches = difflib.get_close_matches(
                            prop_name, list(valid_props), n=3, cutoff=0.35
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

    # 6. Run Upstream A2uiValidator
    # Only run schema validation if no unknown component was found (to avoid duplicate confusing messages)
    has_unknown_component = any(e["type"] == "unknown_component" for e in all_errors)
    if not has_unknown_component:
        try:
            validator = A2uiValidator(a2ui_cat)
            validator.validate(payload)
        except A2uiValidationError as e:
            if hasattr(e, "details") and e.details:
                for d in e.details:
                    all_errors.append({
                        "type": "schema_validation_error",
                        "path": getattr(d, "path", ""),
                        "code": getattr(d, "code", "schema_error"),
                        "message": getattr(d, "message", str(d)),
                        "suggestion": None,
                    })
            else:
                for line in str(e).splitlines():
                    if line.strip():
                        all_errors.append({
                            "type": "schema_validation_error",
                            "path": "",
                            "code": "schema_error",
                            "message": line.strip(),
                            "suggestion": None,
                        })
        except Exception as e:
            for line in str(e).splitlines():
                if line.strip():
                    all_errors.append({
                        "type": "validator_error",
                        "path": "",
                        "code": "validator_error",
                        "message": line.strip(),
                        "suggestion": None,
                    })

    # 7. Deduplicate identical error messages
    unique_errors: List[Dict[str, Any]] = []
    seen_messages: Set[str] = set()
    for err in all_errors:
        m = err["message"]
        if m not in seen_messages:
            seen_messages.add(m)
            unique_errors.append(err)

    # 8. Output and Exit Code
    if unique_errors:
        if as_json:
            print_json({
                "valid": False,
                "status": "error",
                "target": target_name,
                "catalog": catalog_name,
                "error_count": len(unique_errors),
                "errors": unique_errors,
            })
        else:
            print_header(
                f"Validation Failed: {payload_path}",
                f"Target: {target_name or 'default'} | Catalog: {catalog_name}",
            )
            for err in unique_errors:
                print_error(err["message"])
                if err.get("suggestion"):
                    print_info(f"Suggestion: Did you mean '{err['suggestion']}'?")
            print_warning(f"Found {len(unique_errors)} validation error(s).")
        return 1

    if as_json:
        print_json({
            "valid": True,
            "status": "ok",
            "target": target_name,
            "catalog": catalog_name,
            "error_count": 0,
            "errors": [],
        })
    else:
        print_success(
            f"Payload '{payload_path}' is valid! (Target: {target_name or 'default'},"
            f" Catalog: {catalog_name})"
        )

    return 0

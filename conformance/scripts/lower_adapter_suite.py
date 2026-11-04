#!/usr/bin/env python3
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

"""Lowers conformance/core/adapter_conformance.yaml cases from v1.0 to v0.9."""

import argparse
import copy
import json
from pathlib import Path
import sys
from typing import Any

import jsonschema
from referencing import Registry, Resource
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INPUT_PATH = REPO_ROOT / "conformance" / "core" / "adapter_conformance.yaml"
OUTPUT_PATH = REPO_ROOT / "conformance" / "adapter" / "adapter_conformance_v0_9.yaml"

EXCLUDED: dict[str, str] = {
    "v10_theme_dropped_in_permissive_mode_renders_like_none": "v0.9 theme is valid",
    "agent_function_action_failure_reports_expression_error": (
        "agent functions are v1.0 only"
    ),
    "multi_catalog_mixed_surface_rendering": (
        "component-level catalogId overrides are v1.0 only"
    ),
    "validation_results_error_disables_warning_allows": (
        "check severity warning and info are v1.0 only"
    ),
    "dynamic_repeater_list_insert_delete_reorder_and_index": (
        "index function in expressions is v1.0 only"
    ),
    "user_activation_gated_function_gesture_vs_programmatic": (
        "requiresUserActivation is v1.0 only"
    ),
}

ALLOWED_VALIDATION_FAILURES: dict[str, str] = {
    "fallback_states_unknown_type_and_cyclic_diagnostics": (
        "deliberately tests unknown component type fallback"
    ),
}

RESERVED_KEYS = {
    "@path": "path",
    "@call": "call",
}

V09_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
V10_BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"


def _rename_keys(node: Any) -> Any:
    if isinstance(node, list):
        return [_rename_keys(x) for x in node]
    if isinstance(node, dict):
        is_child_list = "componentId" in node
        res: dict[str, Any] = {}
        for k, v in node.items():
            key_str = str(k)
            new_k: str = (
                key_str if is_child_list else RESERVED_KEYS.get(key_str, key_str)
            )
            res[new_k] = _rename_keys(v)
        return res
    return node


def _build_validator() -> jsonschema.Draft202012Validator:
    v09_json_dir = REPO_ROOT / "specification" / "v0_9" / "json"
    catalog_path = (
        REPO_ROOT / "specification" / "v0_9" / "catalogs" / "basic" / "catalog.json"
    )

    with open(v09_json_dir / "server_to_client.json", encoding="utf-8") as f:
        s2c = json.load(f)
    with open(v09_json_dir / "common_types.json", encoding="utf-8") as f:
        common = json.load(f)
    with open(catalog_path, encoding="utf-8") as f:
        cat = json.load(f)

    # Augment basic catalog with incrementCounter function used by the test harness
    increment_counter_schema = {
        "properties": {
            "call": {"const": "incrementCounter"},
            "args": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "step": {"type": "number"},
                    "amount": {"type": "number"},
                },
            },
        },
        "required": ["call"],
    }
    cat["$defs"]["anyFunction"]["oneOf"].append(increment_counter_schema)

    registry = Registry()
    for res in [s2c, common, cat]:
        if "$id" in res:
            registry = registry.with_resource(res["$id"], Resource.from_contents(res))

    registry = registry.with_resource(
        "https://a2ui.org/specification/v0_9/catalog.json",
        Resource.from_contents(cat),
    )
    registry = registry.with_resource(
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        Resource.from_contents(cat),
    )
    registry = registry.with_resource(
        "common_types.json",
        Resource.from_contents(common),
    )

    return jsonschema.Draft202012Validator(s2c, registry=registry)


def lower_case(case: dict[str, Any]) -> dict[str, Any] | None:
    """Lowers a single v1.0 adapter conformance case to v0.9."""
    name = case.get("name", "")
    if name in EXCLUDED:
        return None

    lowered = copy.deepcopy(case)
    lowered["protocolVersion"] = "v0.9"
    if "catalogPaths" in lowered:
        lowered["catalogPaths"] = ["specification/v0_9/catalogs/basic/catalog.json"]

    if "steps" in lowered:
        for step in lowered["steps"]:
            if "messages" in step:
                lowered_msgs: list[dict[str, Any]] = []
                for msg in step["messages"]:
                    m = _rename_keys(msg)
                    m["version"] = "v0.9"
                    if "createSurface" in m:
                        cs = m["createSurface"]
                        if cs.get("catalogId") == V10_BASIC_CATALOG_ID or not cs.get(
                            "catalogId"
                        ):
                            cs["catalogId"] = V09_BASIC_CATALOG_ID
                        comps = cs.pop("components", None)
                        dm = cs.pop("dataModel", None)
                        lowered_msgs.append({"version": "v0.9", "createSurface": cs})
                        if comps is not None:
                            lowered_msgs.append({
                                "version": "v0.9",
                                "updateComponents": {
                                    "surfaceId": cs["surfaceId"],
                                    "components": comps,
                                },
                            })
                        if dm is not None:
                            lowered_msgs.append({
                                "version": "v0.9",
                                "updateDataModel": {
                                    "surfaceId": cs["surfaceId"],
                                    "path": "/",
                                    "value": dm,
                                },
                            })
                    else:
                        lowered_msgs.append(m)
                step["messages"] = lowered_msgs

            if "expectOutbound" in step:
                lowered_ob: list[dict[str, Any]] = []
                for ob in step["expectOutbound"]:
                    ob_c = _rename_keys(ob)
                    if "version" in ob_c:
                        ob_c["version"] = "v0.9"
                    lowered_ob.append(ob_c)
                step["expectOutbound"] = lowered_ob

    return lowered


class _IndentDumper(yaml.SafeDumper):

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> Any:
        return super().increase_indent(flow, False)


def generate_suite() -> str:
    with open(INPUT_PATH, encoding="utf-8") as f:
        cases = yaml.safe_load(f)

    validator = _build_validator()
    lowered_cases: list[dict[str, Any]] = []

    for case in cases:
        name = case.get("name", "")
        lowered = lower_case(case)
        if lowered is None:
            continue

        # Validate all lowered messages against v0.9 server_to_client.json
        for step in lowered.get("steps", []):
            for msg in step.get("messages", []):
                try:
                    validator.validate(msg)
                except Exception as e:
                    if name in ALLOWED_VALIDATION_FAILURES:
                        pass
                    else:
                        raise RuntimeError(
                            f"Unlisted validation failure in case '{name}': {e}"
                        ) from e

        lowered_cases.append(lowered)

    header = (
        "# Copyright 2024 Google LLC\n"
        "#\n"
        '# Licensed under the Apache License, Version 2.0 (the "License");\n'
        "# you may not use this file except in compliance with the License.\n"
        "# You may obtain a copy of the License at\n"
        "#\n"
        "#     https://www.apache.org/licenses/LICENSE-2.0\n"
        "#\n"
        "# Unless required by applicable law or agreed to in writing, software\n"
        '# distributed under the License is distributed on an "AS IS" BASIS,\n'
        "# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n"
        "# See the License for the specific language governing permissions and\n"
        "# limitations under the License.\n\n"
        "# Generated by conformance/scripts/lower_adapter_suite.py. Do not edit"
        " directly.\n# Lowered v0.9 framework adapter conformance suite.\n\n"
    )
    content = header + yaml.dump(
        lowered_cases,
        Dumper=_IndentDumper,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
        width=1000,
    )
    return content


def main(check: bool = False) -> None:
    content = generate_suite()
    if check:
        if not OUTPUT_PATH.exists():
            sys.stderr.write(f"Missing generated file: {OUTPUT_PATH}\n")
            sys.exit(1)
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            existing = f.read()
        if yaml.safe_load(existing) != yaml.safe_load(content):
            sys.stderr.write(
                f"{OUTPUT_PATH} is out of date. Run"
                " conformance/scripts/lower_adapter_suite.py to update.\n"
            )
            sys.exit(1)
        print(f"Verified {OUTPUT_PATH} is up to date.")
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Generated {OUTPUT_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit with code 1 if output on disk differs from generated content.",
    )
    args = parser.parse_args()
    main(check=args.check)

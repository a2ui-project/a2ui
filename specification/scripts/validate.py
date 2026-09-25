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


import os
import json
import subprocess
import glob
import sys
import shutil


def run_ajv(schema_path, data_paths, refs=None):
    """Runs ajv validate via subprocess. Batch validates multiple data paths."""
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    # Try to find local ajv in root node_modules or specification/v0_9/test
    local_ajvs = [
        os.path.join(repo_root, "node_modules", ".bin", "ajv"),
        os.path.join(
            repo_root, "specification", "v0_9", "test", "node_modules", ".bin", "ajv"
        ),
    ]
    local_ajv = next((path for path in local_ajvs if os.path.exists(path)), None)

    if local_ajv:
        cmd = [
            local_ajv,
            "validate",
            "-s",
            schema_path,
            "--spec=draft2020",
            "--strict=false",
            "-c",
            "ajv-formats",
        ]
    else:
        # Fallback to yarn dlx with both packages
        cmd = [
            "yarn",
            "dlx",
            "--package=ajv-cli",
            "--package=ajv-formats",
            "ajv",
            "validate",
            "-s",
            schema_path,
            "--spec=draft2020",
            "--strict=false",
            "-c",
            "ajv-formats",
        ]

    if refs:
        for ref in refs:
            cmd.extend(["-r", ref])

    for data_path in data_paths:
        cmd.extend(["-d", data_path])

    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0, result.stdout + result.stderr


def validate_messages(root_schema, example_files, refs=None, temp_dir="temp_val"):
    """Validates a list of JSON files where each file contains a list of messages."""
    os.makedirs(temp_dir, exist_ok=True)
    all_data_paths = []
    file_map = []

    for example_file in sorted(example_files):
        with open(example_file, "r") as f:
            try:
                messages = json.load(f)
            except json.JSONDecodeError as e:
                print(
                    f"  Validating {os.path.basename(example_file)}...\n    [FAIL]"
                    f" Invalid JSON: {e}"
                )
                return False

        if (
            isinstance(messages, dict)
            and "messages" in messages
            and isinstance(messages["messages"], list)
        ):
            messages = messages["messages"]
        elif not isinstance(messages, list):
            messages = [messages]

        msg_paths = []
        for i, msg in enumerate(messages):
            temp_data_path = os.path.join(
                temp_dir, f"msg_{os.path.basename(example_file)}_{i}.json"
            )
            with open(temp_data_path, "w") as f:
                json.dump(msg, f)
            msg_paths.append(temp_data_path)
            all_data_paths.append(temp_data_path)

        file_map.append((example_file, msg_paths))

    if not all_data_paths:
        return True

    # Validate all example messages in a single batched Ajv invocation
    is_valid, output = run_ajv(root_schema, all_data_paths, refs)
    if not is_valid:
        print(f"  [FAIL] Validation failed:")
        print(output.strip())
        return False

    for example_file, _ in file_map:
        print(f"  Validating {os.path.basename(example_file)}... [PASS]")

    return True


def validate_example_icons(catalog_path, example_files):
    """Validates that any icon referenced in example files exists in the basic catalog."""
    if not os.path.exists(catalog_path):
        return True

    with open(catalog_path, "r") as f:
        catalog = json.load(f)

    valid_icons = set()
    icon_def = catalog.get("components", {}).get("Icon", {})
    if "allOf" in icon_def:
        for item in icon_def["allOf"]:
            props = item.get("properties", {})
            if "name" in props:
                for branch in props["name"].get("oneOf", []):
                    if "enum" in branch:
                        valid_icons.update(branch["enum"])
    elif "properties" in icon_def:
        props = icon_def["properties"]
        if "name" in props:
            for branch in props["name"].get("oneOf", []):
                if "enum" in branch:
                    valid_icons.update(branch["enum"])

    if not valid_icons:
        return True

    def resolve_path(data, path_str):
        parts = [p for p in path_str.strip("/").split("/") if p]
        cur = data
        for p in parts:
            if isinstance(cur, dict) and p in cur:
                cur = cur[p]
            elif isinstance(cur, list) and p.isdigit() and int(p) < len(cur):
                cur = cur[int(p)]
            else:
                return None
        return cur

    all_valid = True
    for example_file in sorted(example_files):
        with open(example_file, "r") as f:
            try:
                data = json.load(f)
            except Exception:
                continue

        messages = data if isinstance(data, list) else data.get("messages", [data])
        data_models = [
            m["updateDataModel"].get("value", {})
            for m in messages
            if isinstance(m, dict) and "updateDataModel" in m
        ]

        def check_element(elem):
            nonlocal all_valid
            if isinstance(elem, dict):
                if elem.get("component") == "Icon":
                    name = elem.get("name")
                    if isinstance(name, str):
                        if name not in valid_icons:
                            print(
                                f"  [FAIL] {os.path.basename(example_file)}: Invalid"
                                f" icon '{name}'. Must be defined in catalog."
                            )
                            all_valid = False
                    elif isinstance(name, dict) and "path" in name:
                        path_str = name["path"]
                        resolved_val = None
                        for dm in data_models:
                            val = resolve_path(dm, path_str)
                            if val is not None:
                                resolved_val = val
                                break
                        if resolved_val is None:
                            key = path_str.strip("/").split("/")[-1]

                            def deep_find(d):
                                if isinstance(d, dict):
                                    for k, v in d.items():
                                        if k == key and isinstance(v, str):
                                            return v
                                        res = deep_find(v)
                                        if res is not None:
                                            return res
                                elif isinstance(d, list):
                                    for x in d:
                                        res = deep_find(x)
                                        if res is not None:
                                            return res
                                return None

                            for dm in data_models:
                                resolved_val = deep_find(dm)
                                if resolved_val is not None:
                                    break

                        if (
                            isinstance(resolved_val, str)
                            and resolved_val not in valid_icons
                        ):
                            print(
                                f"  [FAIL] {os.path.basename(example_file)}: Bound icon"
                                f" '{path_str}' resolved to invalid icon"
                                f" '{resolved_val}'."
                            )
                            all_valid = False

                for v in elem.values():
                    check_element(v)
            elif isinstance(elem, list):
                for item in elem:
                    check_element(item)

        check_element(messages)

    if all_valid:
        print(
            f"  Validating example icons against {os.path.basename(catalog_path)}..."
            " [PASS]"
        )
    return all_valid


def compare_schemas(subset_path, standard_path):
    """Compares that subset schema is a subset of standard schema.

    Allows object keys and string arrays to be subsets. For non-string arrays
    (e.g., arrays of objects), we enforce element-by-element equality in length
    and structure to simplify position-dependent matching.
    """
    print(
        f"  Comparing {os.path.basename(subset_path)} is a subset of"
        f" {os.path.basename(standard_path)}..."
    )
    try:
        with open(subset_path, "r") as f:
            subset = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(
            "    [FAIL] Error loading or parsing subset schema"
            f" '{os.path.basename(subset_path)}': {e}"
        )
        return False

    try:
        with open(standard_path, "r") as f:
            standard = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(
            "    [FAIL] Error loading or parsing standard schema"
            f" '{os.path.basename(standard_path)}': {e}"
        )
        return False

    success = True

    # Approved exceptions where subset is generic and standard is restrictive
    approved_exceptions = {
        "properties.surfaceUpdate.properties.components.items.properties.component.additionalProperties",
        "properties.beginRendering.properties.styles.additionalProperties",
    }

    def get_type_str(val):
        if isinstance(val, dict):
            return "object"
        if isinstance(val, list):
            return "array"
        return "primitive"

    def compare(sub, std, path=""):
        nonlocal success
        sub_type = get_type_str(sub)
        std_type = get_type_str(std)

        if sub_type != std_type:
            print(
                f"    [FAIL] Type mismatch at {path}: subset={sub_type},"
                f" standard={std_type}"
            )
            success = False
            return

        if sub_type == "object":
            for key in sub:
                new_path = f"{path}.{key}" if path else key
                if key not in std:
                    print(
                        f"    [FAIL] Key '{key}' in subset but missing in standard at"
                        f" {new_path}"
                    )
                    success = False
                else:
                    compare(sub[key], std[key], new_path)
        elif sub_type == "array":
            if all(isinstance(x, str) for x in sub) and all(
                isinstance(x, str) for x in std
            ):
                if not set(sub).issubset(set(std)):
                    print(
                        f"    [FAIL] String array is not a subset at {path}:"
                        f" subset={sub}, standard={std}"
                    )
                    success = False
            else:
                # For non-string arrays (e.g. arrays of objects like inside anyOf),
                # order and length typically matter for structure matching in this script.
                # To avoid complex matching, we enforce equality in length and structure.
                if len(sub) != len(std):
                    print(
                        f"    [FAIL] Array length mismatch at {path}:"
                        f" subset={len(sub)}, standard={len(std)}"
                    )
                    success = False
                else:
                    for i in range(len(sub)):
                        compare(sub[i], std[i], f"{path}[{i}]")
        elif sub_type == "primitive":
            if sub != std:
                if path in approved_exceptions:
                    return
                print(
                    f"    [FAIL] Value mismatch at {path}: subset={sub}, standard={std}"
                )
                success = False

    compare(subset, standard)
    if success:
        print("    [PASS] Subset comparison")
    return success


def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))

    overall_success = True

    # Configuration for versions
    configs = {
        "v0_8": {
            "root_schema": (
                "specification/v0_8/json/server_to_client_with_standard_catalog.json"
            ),
            "subset_schema": "specification/v0_8/json/server_to_client.json",
            "refs": [],
            "examples": "specification/v0_8/json/catalogs/basic/examples/*.json",
        },
        "v0_9": {
            "root_schema": "specification/v0_9/json/server_to_client.json",
            "catalog": "specification/v0_9/catalogs/basic/catalog.json",
            "refs": [
                "specification/v0_9/json/common_types.json",
                "specification/v0_9/catalogs/basic/catalog.json",
            ],
            "examples": "specification/v0_9/catalogs/basic/examples/*.json",
        },
        "v1_0": {
            "root_schema": "specification/v1_0/json/agent_to_renderer.json",
            "catalog": "specification/v1_0/catalogs/basic/catalog.json",
            "refs": [
                "specification/v1_0/json/common_types.json",
                "catalogs/basic/v1/catalog.json",
            ],
            "examples": "catalogs/basic/v1/examples/*.json",
        },
    }

    for version, config in configs.items():
        print(f"\n=== Validating {version} ===")

        version_temp_dir = os.path.join(repo_root, f"temp_val_{version}")
        if os.path.exists(version_temp_dir):
            shutil.rmtree(version_temp_dir)
        os.makedirs(version_temp_dir, exist_ok=True)

        root_schema = os.path.join(repo_root, config["root_schema"])
        if not os.path.exists(root_schema):
            print(f"Error: Root schema not found at {root_schema}")
            overall_success = False
            continue

        refs = []
        for ref in config["refs"]:
            ref_path = os.path.join(repo_root, ref)
            if ref.endswith("catalog.json"):
                # catalog needs aliasing to catalog.json as expected by server_to_client.json
                with open(ref_path, "r") as f:
                    catalog = json.load(f)
                if "$id" in catalog:
                    catalog["$id"] = (
                        f"https://a2ui.org/specification/{version}/catalog.json"
                    )
                alias_path = os.path.join(version_temp_dir, "catalog.json")
                with open(alias_path, "w") as f:
                    json.dump(catalog, f)
                refs.append(alias_path)
            else:
                refs.append(ref_path)

        example_pattern = os.path.join(repo_root, config["examples"])
        example_files = glob.glob(example_pattern)

        if "subset_schema" in config:
            subset_path = os.path.join(repo_root, config["subset_schema"])
            if not compare_schemas(subset_path, root_schema):
                overall_success = False

        if "catalog" in config:
            catalog_path = os.path.join(repo_root, config["catalog"])
            if not validate_example_icons(catalog_path, example_files):
                overall_success = False

        if not example_files:
            print(f"No examples found for {version} matching {example_pattern}")
        else:
            if not validate_messages(
                root_schema, example_files, refs, version_temp_dir
            ):
                overall_success = False

        if os.path.exists(version_temp_dir):
            shutil.rmtree(version_temp_dir)

    if not overall_success:
        print("\nOverall Validation: FAILED")
        sys.exit(1)
    else:
        print("\nOverall Validation: PASSED")


if __name__ == "__main__":
    main()

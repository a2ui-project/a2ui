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
import re
import subprocess
import glob
import sys
import shutil

CATALOG_ID_RE = re.compile(
    r"https://a2ui\.org/specification/v[0-9_]+/catalogs/[A-Za-z0-9_-]+/catalog\.json"
)

SCANNED_SUFFIXES = (".json", ".md", ".txt", ".jsonl")


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


def check_catalog_ids(repo_root):
    """Checks that catalog IDs are declared by a catalog schema before use.

    Two invariants:
      1. Every catalog schema agrees with itself: `$id` == `catalogId`.
      2. Every catalog URL referenced anywhere under `specification/` is an ID
         that some catalog schema actually declares.

    Invariant 2 is what stops an implementation or a doc from inventing a
    catalog ID that no catalog answers to. A client that does not recognise an
    ID cannot tell it apart from a typo, so the surface silently renders empty.
    """
    print("\n=== Validating catalog IDs ===")
    success = True

    spec_root = os.path.join(repo_root, "specification")
    catalog_paths = sorted(
        glob.glob(os.path.join(spec_root, "*", "catalogs", "*", "catalog.json"))
    )

    declared = {}
    for catalog_path in catalog_paths:
        rel = os.path.relpath(catalog_path, repo_root)
        try:
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"    [FAIL] Could not read {rel}: {e}")
            success = False
            continue

        if not isinstance(catalog, dict):
            print(f"    [FAIL] {rel} is not a JSON object")
            success = False
            continue

        schema_id = catalog.get("$id")
        catalog_id = catalog.get("catalogId")

        if not catalog_id:
            print(f"    [FAIL] {rel} declares no 'catalogId'")
            success = False
            continue

        if schema_id != catalog_id:
            print(f"    [FAIL] {rel}: '$id' and 'catalogId' disagree")
            print(f"           $id       {schema_id}")
            print(f"           catalogId {catalog_id}")
            success = False

        # Register even on mismatch: `catalogId` is the field clients match on,
        # so trusting it here keeps one bad `$id` from cascading into a bogus
        # "undeclared ID" error for every file that references the catalog.
        declared.setdefault(catalog_id, []).append(rel)

    if not declared:
        print("    [FAIL] No catalog schemas found")
        return False

    print(
        f"  {len(declared)} catalog ID(s) declared by {len(catalog_paths)} schema(s):"
    )
    for catalog_id in sorted(declared):
        print(f"    {catalog_id}")

    offenders = {}
    for path in sorted(glob.glob(os.path.join(spec_root, "**", "*"), recursive=True)):
        if not os.path.isfile(path) or not path.endswith(SCANNED_SUFFIXES):
            continue
        if f"{os.sep}node_modules{os.sep}" in path:
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        for match in CATALOG_ID_RE.findall(text):
            if match not in declared:
                offenders.setdefault(match, set()).add(os.path.relpath(path, repo_root))

    if offenders:
        success = False
        for catalog_id, paths in sorted(offenders.items()):
            print(f"    [FAIL] Undeclared catalog ID: {catalog_id}")
            print("           No catalog.json under specification/ declares this ID.")
            print("           Referenced from:")
            for p in sorted(paths):
                print(f"             {p}")
    else:
        print("    [PASS] Every referenced catalog ID is declared by a schema")

    return success


def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))

    overall_success = True

    if not check_catalog_ids(repo_root):
        overall_success = False

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
            "refs": [
                "specification/v0_9/json/common_types.json",
                "specification/v0_9/catalogs/basic/catalog.json",
            ],
            "examples": "specification/v0_9/catalogs/basic/examples/*.json",
        },
        "v1_0": {
            "root_schema": "specification/v1_0/json/agent_to_renderer.json",
            "refs": [
                "specification/v1_0/json/common_types.json",
                "specification/v1_0/catalogs/basic/catalog.json",
            ],
            "examples": "specification/v1_0/catalogs/basic/examples/*.json",
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

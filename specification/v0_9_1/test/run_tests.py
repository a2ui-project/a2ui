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


import json
import subprocess
import os
import glob
import sys

# Constants
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEMA_DIR = os.path.abspath(os.path.join(TEST_DIR, "../json"))
CASES_DIR = os.path.join(TEST_DIR, "cases")
TEMP_FILE = os.path.join(TEST_DIR, "temp_data.json")
TEMP_CATALOG_FILE = os.path.join(TEST_DIR, "catalog.json")
TEMP_COMMON_TYPES_CATALOG_FILE = os.path.join(TEST_DIR, "common_types_catalog.json")

# Map of schema filenames to their full paths
# Note: catalog.json is dynamically created from catalogs/basic/catalog.json
SCHEMAS = {
    "server_to_client.json": os.path.join(SCHEMA_DIR, "server_to_client.json"),
    "common_types.json": os.path.join(SCHEMA_DIR, "common_types.json"),
    "catalog.json": TEMP_CATALOG_FILE,
    "common_types_catalog.json": TEMP_COMMON_TYPES_CATALOG_FILE,
    "client_to_server_list.json": os.path.join(
        SCHEMA_DIR, "client_to_server_list.json"
    ),
    "client_to_server.json": os.path.join(SCHEMA_DIR, "client_to_server.json"),
}

# Each schema that refers to "catalog.json", and the catalog alias that serves it.
# common_types.json keeps v0.9's $id, because the basic catalog (also v0.9's)
# refers to it by that address, so its "catalog.json" resolves under v0.9.
CATALOG_ALIASES = {
    "server_to_client.json": TEMP_CATALOG_FILE,
    "common_types.json": TEMP_COMMON_TYPES_CATALOG_FILE,
}

# Schemas that v0.9.1 publishes unchanged from v0.9, under v0.9's $id.
SHARED_WITH_V0_9 = {"common_types.json"}


def setup_catalog_alias():
    """
    Creates temporary copies of catalogs/basic/catalog.json, each with the
    $id that "catalog.json" resolves to from one of CATALOG_ALIASES.
    """
    basic_catalog_path = os.path.abspath(
        os.path.join(TEST_DIR, "../catalogs/basic/catalog.json")
    )
    if not os.path.exists(basic_catalog_path):
        print(f"Error: catalog.json not found at {basic_catalog_path}")
        sys.exit(1)

    with open(basic_catalog_path, "r") as f:
        try:
            catalog = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error parsing catalog.json: {e}")
            sys.exit(1)

    # Give each alias the generic catalog reference as its $id
    # This allows each schema to refer to "catalog.json"
    # and have it resolve to this schema content.
    for schema_name, alias_path in CATALOG_ALIASES.items():
        with open(SCHEMAS[schema_name], "r") as f:
            schema_id = json.load(f)["$id"]
        alias = {**catalog, "$id": schema_id.rsplit("/", 1)[0] + "/catalog.json"}
        with open(alias_path, "w") as f:
            json.dump(alias, f, indent=2)


def cleanup_catalog_alias():
    for alias_path in CATALOG_ALIASES.values():
        if os.path.exists(alias_path):
            os.remove(alias_path)


def check_schema_ids():
    """
    Checks that every schema in json/ declares the $id of the address
    a2ui.org publishes it at, so that a tool loading schemas by $id can hold
    v0.9 and v0.9.1 side by side.
    """
    print("\nChecking schema $ids")

    passed = 0
    failed = 0

    for path in sorted(glob.glob(os.path.join(SCHEMA_DIR, "*.json"))):
        name = os.path.basename(path)
        version = "v0_9" if name in SHARED_WITH_V0_9 else "v0_9_1"
        expected = f"https://a2ui.org/specification/{version}/{name}"
        with open(path, "r") as f:
            actual = json.load(f).get("$id")

        if actual == expected:
            passed += 1
        else:
            failed += 1
            print(f"  [FAIL] {name}")
            print(f"         Expected $id: {expected}, Got: {actual}")

    return passed, failed


def validate_ajv(schema_path, data_path, all_schemas):
    """Runs ajv validate via subprocess."""
    cmd = [
        "yarn",
        "run",
        "ajv",
        "validate",
        "-s",
        schema_path,
        "--spec=draft2020",
        "--strict=false",
        "-c",
        "ajv-formats",
        "-d",
        data_path,
    ]

    # Add all other schemas as references
    for name, path in all_schemas.items():
        if path != schema_path:
            cmd.extend(["-r", path])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0, result.stdout + result.stderr
    except FileNotFoundError:
        print(
            "Error: 'ajv' command not found. Please ensure dependencies are installed"
            " (e.g., 'yarn install')."
        )
        sys.exit(1)


def run_suite(suite_path):
    with open(suite_path, "r") as f:
        try:
            suite = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON in {suite_path}: {e}")
            return 0, 0

    schema_name = suite.get("schema", "server_to_client.json")
    if schema_name not in SCHEMAS:
        print(f"Error: Unknown schema '{schema_name}' referenced in {suite_path}")
        return 0, 0

    schema_path = SCHEMAS[schema_name]
    tests = suite.get("tests", [])

    print(f"\nRunning suite: {os.path.basename(suite_path)} ({len(tests)} tests)")
    print(f"Target Schema: {schema_name}")

    passed = 0
    failed = 0

    for i, test in enumerate(tests):
        description = test.get("description", f"Test #{i+1}")
        expect_valid = test.get("valid", True)
        data = test.get("data")

        # Write data to temp file
        with open(TEMP_FILE, "w") as f:
            json.dump(data, f)

        is_valid, output = validate_ajv(schema_path, TEMP_FILE, SCHEMAS)

        if is_valid == expect_valid:
            passed += 1
            # print(f"  [PASS] {description}")
        else:
            failed += 1
            print(f"  [FAIL] {description}")
            print(f"         Expected Valid: {expect_valid}, Got Valid: {is_valid}")
            if not is_valid:
                print(f"         Output: {output.strip()}")

    return passed, failed


def validate_jsonl_example(jsonl_path):
    if not os.path.exists(jsonl_path):
        print(f"Error: Example file not found: {jsonl_path}")
        return 0, 1

    print(f"\nValidating JSONL example: {os.path.basename(jsonl_path)}")
    print(f"Target Schema: server_to_client.json")

    passed = 0
    failed = 0
    schema_path = SCHEMAS["server_to_client.json"]

    with open(jsonl_path, "r") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue

            # Use temp file for each line
            with open(TEMP_FILE, "w") as tf:
                tf.write(line)

            is_valid, output = validate_ajv(schema_path, TEMP_FILE, SCHEMAS)
            if is_valid:
                passed += 1
                # print(f"  [PASS] Line {i+1}")
            else:
                failed += 1
                print(f"  [FAIL] Line {i+1}")
                print(f"         Output: {output.strip()}")

    return passed, failed


def main():
    if not os.path.exists(CASES_DIR):
        print(f"No cases directory found at {CASES_DIR}")
        return

    # Create the temporary catalog.json alias
    setup_catalog_alias()

    try:
        test_files = glob.glob(os.path.join(CASES_DIR, "*.json"))

        total_passed = 0
        total_failed = 0

        # 1. Run standard test suites
        for test_file in sorted(test_files):
            p, f = run_suite(test_file)
            total_passed += p
            total_failed += f

        # 2. Run .jsonl example validation
        example_path = os.path.join(CASES_DIR, "contact_form_example.jsonl")
        p, f = validate_jsonl_example(example_path)
        total_passed += p
        total_failed += f

        # 3. Check the $id of each schema
        p, f = check_schema_ids()
        total_passed += p
        total_failed += f

        print("\n" + "=" * 30)
        print(f"Total Passed: {total_passed}")
        print(f"Total Failed: {total_failed}")

    finally:
        if os.path.exists(TEMP_FILE):
            os.remove(TEMP_FILE)
        # Clean up the catalog alias
        cleanup_catalog_alias()

    if total_failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# Copyright 2026 Google LLC
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
SPEC_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))
SCHEMA_DIR = os.path.join(SPEC_DIR, "json")
CASES_DIR = os.path.join(TEST_DIR, "cases")
TEMP_FILE = os.path.join(TEST_DIR, "temp_data.json")
TEMP_CATALOG_FILE = os.path.join(TEST_DIR, "catalog.json")

# Map of schema filenames to their full paths
# Note: catalog.json is dynamically created from catalogs/basic/catalog.json
SCHEMAS = {
    "server_to_client.json": os.path.join(SCHEMA_DIR, "server_to_client.json"),
    "common_types.json": os.path.join(SCHEMA_DIR, "common_types.json"),
    "catalog.json": TEMP_CATALOG_FILE,
    "client_to_server.json": os.path.join(SCHEMA_DIR, "client_to_server.json"),
}

def setup_catalog_alias(catalog_file="catalogs/basic/catalog.json"):
    """
    Creates a temporary catalog.json from catalogs/basic/catalog.json (or the
    specified file) with the $id modified to match what server_to_client.json
    expects.
    """
    basic_catalog_path = os.path.join(SPEC_DIR, catalog_file)
    if not os.path.exists(basic_catalog_path):
        basic_catalog_path = os.path.join(TEST_DIR, catalog_file)

    if not os.path.exists(basic_catalog_path):
        print(f"Error: Catalog file not found: {catalog_file} (resolved to {basic_catalog_path})")
        sys.exit(1)

    with open(basic_catalog_path, 'r') as f:
        try:
            catalog = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error parsing catalog.json: {e}")
            sys.exit(1)

    # Modify the $id to be the generic catalog reference
    # This allows server_to_client.json to refer to "catalog.json"
    # and have it resolve to this schema content.
    if "$id" in catalog:
        import re
        match = re.match(r"^(https://a2ui\.org/specification/v\d+_\d+/)", catalog["$id"])
        if match:
            catalog["$id"] = match.group(1) + "catalog.json"


    with open(TEMP_CATALOG_FILE, 'w') as f:
        json.dump(catalog, f, indent=2)

def cleanup_catalog_alias():
    if os.path.exists(TEMP_CATALOG_FILE):
        os.remove(TEMP_CATALOG_FILE)

def validate_ajv(schema_path, data_path, all_schemas):
    """Runs ajv validate via subprocess."""
    cmd = ["yarn", "run", "ajv", "validate", "-s", schema_path, "--spec=draft2020", "--strict=false", "-c", "ajv-formats", "-d", data_path]

    # Add all other schemas as references
    for name, path in all_schemas.items():
        if path != schema_path:
            cmd.extend(["-r", path])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=TEST_DIR)
        return result.returncode == 0, result.stdout + result.stderr
    except FileNotFoundError:
        print("Error: 'ajv' command not found. Please ensure dependencies are installed (e.g., 'yarn install').")
        sys.exit(1)

def run_suite(suite_path):
    with open(suite_path, 'r') as f:
        try:
            suite = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON in {suite_path}: {e}")
            return 0, 0

    catalog_file = suite.get("catalog", "catalogs/basic/catalog.json")
    setup_catalog_alias(catalog_file)

    try:
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
            with open(TEMP_FILE, 'w') as f:
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
    finally:
        cleanup_catalog_alias()

def validate_jsonl_example(jsonl_path):
    if not os.path.exists(jsonl_path):
        print(f"Error: Example file not found: {jsonl_path}")
        return 0, 1

    print(f"\nValidating JSONL example: {os.path.basename(jsonl_path)}")
    print(f"Target Schema: server_to_client.json")

    passed = 0
    failed = 0
    schema_path = SCHEMAS["server_to_client.json"]

    setup_catalog_alias()
    try:
        with open(jsonl_path, 'r') as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue

                # Use temp file for each line
                with open(TEMP_FILE, 'w') as tf:
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
    finally:
        cleanup_catalog_alias()

def validate_catalogs_structure():
    """
    Validates the catalog files directly against the Catalog definition in
    client_capabilities.json schema.
    """
    client_caps_path = os.path.join(SCHEMA_DIR, "client_capabilities.json")
    if not os.path.exists(client_caps_path):
        print(f"Error: client_capabilities.json not found at {client_caps_path}")
        return 0, 1

    temp_validator_path = os.path.join(TEST_DIR, "temp_catalog_validator.json")

    # We reference the absolute ID of client_capabilities.json which gets loaded as a reference
    validator_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$ref": "https://a2ui.org/specification/v1_0/client_capabilities.json#/$defs/Catalog"
    }

    with open(temp_validator_path, 'w') as f:
        json.dump(validator_schema, f)

    catalogs_to_validate = [
        ("catalogs/basic/catalog.json", os.path.join(SPEC_DIR, "catalogs/basic/catalog.json")),
        ("test/testing_catalog.json", os.path.join(TEST_DIR, "testing_catalog.json")),
    ]

    passed = 0
    failed = 0

    print("\nValidating catalog structural integrity against client_capabilities.json...")

    ref_schemas = {
        "client_capabilities.json": client_caps_path
    }

    try:
        for name, path in catalogs_to_validate:
            if not os.path.exists(path):
                print(f"  [FAIL] {name} (File not found)")
                failed += 1
                continue

            is_valid, output = validate_ajv(temp_validator_path, path, ref_schemas)
            if is_valid:
                passed += 1
                # print(f"  [PASS] {name}")
            else:
                failed += 1
                print(f"  [FAIL] {name}")
                print(f"         Output: {output.strip()}")

        return passed, failed
    finally:
        if os.path.exists(temp_validator_path):
            os.remove(temp_validator_path)

def validate_catalogs_identifiers():
    """
    Validates that all entity keys (components, functions) in all catalog files
    strictly conform to Unicode UAX #31 identifier naming rules.
    """
    catalogs_to_validate = [
        ("catalogs/basic/catalog.json", os.path.join(SPEC_DIR, "catalogs/basic/catalog.json")),
        ("test/testing_catalog.json", os.path.join(TEST_DIR, "testing_catalog.json")),
    ]

    passed = 0
    failed = 0

    print("\nValidating catalog entities against Unicode UAX #31 identifier rules...")

    for name, path in catalogs_to_validate:
        if not os.path.exists(path):
            print(f"  [FAIL] {name} (File not found)")
            failed += 1
            continue

        with open(path, 'r') as f:
            try:
                catalog = json.load(f)
            except json.JSONDecodeError as e:
                print(f"  [FAIL] {name} (JSON Decode Error: {e})")
                failed += 1
                continue

        errors = []

        def check_schema_properties(obj):
            if isinstance(obj, dict):
                if "properties" in obj and isinstance(obj["properties"], dict):
                    for prop_name, prop_def in obj["properties"].items():
                        if not prop_name.isidentifier():
                            errors.append(f"Invalid argument/property name: '{prop_name}'")
                        check_schema_properties(prop_def)
                for k, v in obj.items():
                    if k != "properties":
                        if isinstance(v, (dict, list)):
                            check_schema_properties(v)
            elif isinstance(obj, list):
                for item in obj:
                    if isinstance(item, (dict, list)):
                        check_schema_properties(item)

        components = catalog.get("components", {})
        for comp_name, comp_def in components.items():
            if not comp_name.isidentifier():
                errors.append(f"Invalid component name: '{comp_name}'")
            check_schema_properties(comp_def)

        functions = catalog.get("functions", {})
        if isinstance(functions, dict):
            for func_name, func_def in functions.items():
                check_name = func_name[1:] if func_name.startswith("@") else func_name
                if not check_name.isidentifier():
                    errors.append(f"Invalid function name: '{func_name}'")
                check_schema_properties(func_def)

        if errors:
            failed += 1
            print(f"  [FAIL] {name}")
            for err in errors:
                print(f"         {err}")
        else:
            passed += 1

    return passed, failed

def main():
    if not os.path.exists(CASES_DIR):
        print(f"No cases directory found at {CASES_DIR}")
        return

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

        # 3. Validate catalogs structural integrity
        p, f = validate_catalogs_structure()
        total_passed += p
        total_failed += f

        # 4. Validate catalogs UAX #31 entity identifiers
        p, f = validate_catalogs_identifiers()
        total_passed += p
        total_failed += f

        print("\n" + "="*30)
        print(f"Total Passed: {total_passed}")
        print(f"Total Failed: {total_failed}")

    finally:
        if os.path.exists(TEMP_FILE):
            os.remove(TEMP_FILE)

    if total_failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()

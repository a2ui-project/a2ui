#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
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

# Map of schema filenames to their full paths
# Note: catalog.json is dynamically created from catalogs/basic/catalog.json
SCHEMAS = {
    "server_to_client.json": os.path.join(SCHEMA_DIR, "server_to_client.json"),
    "common_types.json": os.path.join(SCHEMA_DIR, "common_types.json"),
    "catalog.json": TEMP_CATALOG_FILE,
    "client_to_server.json": os.path.join(SCHEMA_DIR, "client_to_server.json"),
}

def setup_catalog_alias():
    """
    Creates a temporary catalog.json from catalogs/basic/catalog.json
    with the $id modified to match what server_to_client.json expects.
    """
    basic_catalog_path = os.path.abspath(os.path.join(TEST_DIR, "../catalogs/basic/catalog.json"))
    if not os.path.exists(basic_catalog_path):
        print(f"Error: catalog.json not found at {basic_catalog_path}")
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
        match = re.match(r"^(https://a2ui\.org/specification/v0_\d+/)", catalog["$id"])
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
        result = subprocess.run(cmd, capture_output=True, text=True)
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

def validate_jsonl_example(jsonl_path):
    if not os.path.exists(jsonl_path):
        print(f"Error: Example file not found: {jsonl_path}")
        return 0, 1

    print(f"\nValidating JSONL example: {os.path.basename(jsonl_path)}")
    print(f"Target Schema: server_to_client.json")

    passed = 0
    failed = 0
    schema_path = SCHEMAS["server_to_client.json"]

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

        print("\n" + "="*30)
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

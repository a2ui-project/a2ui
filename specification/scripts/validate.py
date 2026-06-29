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
        os.path.join(repo_root, "specification", "v0_9", "test", "node_modules", ".bin", "ajv"),
    ]
    local_ajv = next((path for path in local_ajvs if os.path.exists(path)), None)
    
    if local_ajv:
        cmd = [local_ajv, "validate", "-s", schema_path, "--spec=draft2020", "--strict=false", "-c", "ajv-formats"]
    else:
        # Fallback to yarn dlx with both packages
        cmd = ["yarn", "dlx", "--package=ajv-cli", "--package=ajv-formats", "ajv", "validate", "-s", schema_path, "--spec=draft2020", "--strict=false", "-c", "ajv-formats"]
        
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
    success = True
    
    for example_file in sorted(example_files):
        print(f"  Validating {os.path.basename(example_file)}...")
        with open(example_file, 'r') as f:
            try:
                messages = json.load(f)
            except json.JSONDecodeError as e:
                print(f"    [FAIL] Invalid JSON: {e}")
                success = False
                continue
        
        if isinstance(messages, dict) and "messages" in messages and isinstance(messages["messages"], list):
            messages = messages["messages"]
        elif not isinstance(messages, list):
             messages = [messages]

        temp_data_paths = []
        for i, msg in enumerate(messages):
            temp_data_path = os.path.join(temp_dir, f"msg_{os.path.basename(example_file)}_{i}.json")
            with open(temp_data_path, 'w') as f:
                json.dump(msg, f)
            temp_data_paths.append(temp_data_path)
        
        if not temp_data_paths:
            print("    [SKIP] No messages to validate")
            continue

        is_valid, output = run_ajv(root_schema, temp_data_paths, refs)
        if not is_valid:
            print(f"    [FAIL] Validation failed for {os.path.basename(example_file)}:")
            print(output.strip())
            success = False
        else:
            print(f"    [PASS]")

    return success

def compare_schemas(subset_path, standard_path):
    """Compares that subset schema is a subset of standard schema.
    
    Allows object keys and string arrays to be subsets. For non-string arrays
    (e.g., arrays of objects), we enforce element-by-element equality in length 
    and structure to simplify position-dependent matching.
    """
    print(f"  Comparing {os.path.basename(subset_path)} is a subset of {os.path.basename(standard_path)}...")
    try:
        with open(subset_path, 'r') as f:
            subset = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"    [FAIL] Error loading or parsing subset schema '{os.path.basename(subset_path)}': {e}")
        return False

    try:
        with open(standard_path, 'r') as f:
            standard = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"    [FAIL] Error loading or parsing standard schema '{os.path.basename(standard_path)}': {e}")
        return False

    success = True
    
    # Approved exceptions where subset is generic and standard is restrictive
    approved_exceptions = {
        "properties.surfaceUpdate.properties.components.items.properties.component.additionalProperties",
        "properties.beginRendering.properties.styles.additionalProperties"
    }

    def get_type_str(val):
        if isinstance(val, dict): return "object"
        if isinstance(val, list): return "array"
        return "primitive"

    def compare(sub, std, path=""):
        nonlocal success
        sub_type = get_type_str(sub)
        std_type = get_type_str(std)

        if sub_type != std_type:
             print(f"    [FAIL] Type mismatch at {path}: subset={sub_type}, standard={std_type}")
             success = False
             return

        if sub_type == "object":
             for key in sub:
                 new_path = f"{path}.{key}" if path else key
                 if key not in std:
                      print(f"    [FAIL] Key '{key}' in subset but missing in standard at {new_path}")
                      success = False
                 else:
                      compare(sub[key], std[key], new_path)
        elif sub_type == "array":
             if all(isinstance(x, str) for x in sub) and all(isinstance(x, str) for x in std):
                  if not set(sub).issubset(set(std)):
                      print(f"    [FAIL] String array is not a subset at {path}: subset={sub}, standard={std}")
                      success = False
             else:
                  # For non-string arrays (e.g. arrays of objects like inside anyOf), 
                  # order and length typically matter for structure matching in this script.
                  # To avoid complex matching, we enforce equality in length and structure.
                  if len(sub) != len(std):
                      print(f"    [FAIL] Array length mismatch at {path}: subset={len(sub)}, standard={len(std)}")
                      success = False
                  else:
                      for i in range(len(sub)):
                          compare(sub[i], std[i], f"{path}[{i}]")
        elif sub_type == "primitive":
             if sub != std:
                 if path in approved_exceptions:
                      return
                 print(f"    [FAIL] Value mismatch at {path}: subset={sub}, standard={std}")
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
            "root_schema": "specification/v0_8/json/server_to_client_with_standard_catalog.json",
            "subset_schema": "specification/v0_8/json/server_to_client.json",
            "refs": [],
            "examples": "specification/v0_8/json/catalogs/basic/examples/*.json"
        },
        "v0_9": {
            "root_schema": "specification/v0_9/json/server_to_client.json",
            "refs": [
                "specification/v0_9/json/common_types.json",
                "specification/v0_9/catalogs/basic/catalog.json"
            ],
            "examples": "specification/v0_9/catalogs/basic/examples/*.json"
        },
        "v1_0": {
            "root_schema": "specification/v1_0/json/server_to_client.json",
            "refs": [
                "specification/v1_0/json/common_types.json",
                "specification/v1_0/catalogs/basic/catalog.json"
            ],
            "examples": "specification/v1_0/catalogs/basic/examples/*.json"
        }
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
                with open(ref_path, 'r') as f:
                    catalog = json.load(f)
                if "$id" in catalog:
                    catalog["$id"] = f"https://a2ui.org/specification/{version}/catalog.json"
                alias_path = os.path.join(version_temp_dir, "catalog.json")
                with open(alias_path, 'w') as f:
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
            if not validate_messages(root_schema, example_files, refs, version_temp_dir):
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

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

"""Migrates legacy A2UI dataset YAML files to the modern messages format."""

import json
import os
import jsonschema
import yaml

EVAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASETS_DIR = os.path.join(EVAL_DIR, "datasets")
SCHEMA_PATH = os.path.join(DATASETS_DIR, "dataset_schema.json")

MIGRATIONS = {
    "prompts_v0_9_1.yaml": "core_v0_9_1.yaml",
    "prompts_v1_0.yaml": "core_v1_0.yaml",
}


def migrate_sample(item: dict, dataset_name: str) -> dict:
    """Transforms a single legacy sample dictionary into the clean messages schema."""
    new_item = {
        "name": item["name"],
        "dataset": dataset_name,
        "description": item["description"],
        "catalog": item.get("catalog")
        or "specification/{version}/catalogs/basic/catalog.json",
    }

    if "messages" in item:
        new_item["messages"] = item["messages"]
    elif "promptText" in item:
        new_item["messages"] = [{"role": "user", "content": item["promptText"]}]
    else:
        raise ValueError(
            f"Sample {item.get('name')} has neither messages nor promptText."
        )

    if "target" in item:
        new_item["target"] = item["target"]
    if "system_prompt" in item:
        new_item["system_prompt"] = item["system_prompt"]
    if "protocol_role" in item or "role_description" in item:
        new_item["protocol_role"] = item.get("protocol_role") or item.get(
            "role_description"
        )
    if "generation_rules" in item or "workflow_description" in item:
        new_item["generation_rules"] = item.get("generation_rules") or item.get(
            "workflow_description"
        )
    if "allowed_surface_ids" in item:
        new_item["allowed_surface_ids"] = item["allowed_surface_ids"]

    return new_item


def main():
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema = json.load(f)

    for old_file, new_file in MIGRATIONS.items():
        old_path = os.path.join(DATASETS_DIR, old_file)
        new_path = os.path.join(DATASETS_DIR, new_file)

        if not os.path.exists(old_path):
            print(f"Skipping {old_file} (not found on disk).")
            continue

        with open(old_path, "r", encoding="utf-8") as f:
            raw_data = yaml.safe_load(f) or []

        dataset_name = os.path.splitext(new_file)[0]
        migrated_data = [migrate_sample(sample, dataset_name) for sample in raw_data]

        # Validate migrated data against updated schema
        jsonschema.validate(instance=migrated_data, schema=schema)

        # Write new modular dataset file
        with open(new_path, "w", encoding="utf-8") as f:
            yaml.dump(migrated_data, f, sort_keys=False, allow_unicode=True)
        print(
            f"Successfully migrated {old_file} -> {new_file} ({len(migrated_data)} samples)."
        )

        # Delete legacy file
        os.remove(old_path)
        print(f"Removed legacy file: {old_file}")


if __name__ == "__main__":
    main()

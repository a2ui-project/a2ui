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
import yaml
import pytest
import jsonschema
import glob


def load_json_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_yaml_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


CONFORMANCE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(CONFORMANCE_DIR, "conformance_schema.json")
SCHEMA = load_json_file(SCHEMA_PATH)

INFERENCE_FORMAT_SCHEMA_PATH = os.path.join(
    CONFORMANCE_DIR, "inference_formats", "inference_format_schema.json"
)
INFERENCE_FORMAT_SCHEMA = load_json_file(INFERENCE_FORMAT_SCHEMA_PATH)


def get_yaml_test_params():
    params = []
    for domain in ["core", "agent", "extensions"]:
        pattern = os.path.join(CONFORMANCE_DIR, domain, "**", "*.yaml")
        for f in glob.glob(pattern, recursive=True):
            params.append((f, SCHEMA))
    inf_pattern = os.path.join(CONFORMANCE_DIR, "inference_formats", "**", "*.yaml")
    for f in glob.glob(inf_pattern, recursive=True):
        params.append((f, INFERENCE_FORMAT_SCHEMA))
    return sorted(params, key=lambda x: x[0])


@pytest.mark.parametrize(
    "yaml_path,schema",
    get_yaml_test_params(),
    ids=lambda item: os.path.basename(item[0]) if isinstance(item, tuple) else str(item),
)
def test_validate_conformance_yaml(yaml_path, schema):
    yaml_data = load_yaml_file(yaml_path)
    basename = os.path.basename(yaml_path)
    try:
        jsonschema.validate(instance=yaml_data, schema=schema)
    except jsonschema.ValidationError as e:
        pytest.fail(f"{basename} failed schema validation: {e.message}")


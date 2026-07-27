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


def get_yaml_files():
    pattern = os.path.join(CONFORMANCE_DIR, "suites", "*.yaml")
    return glob.glob(pattern)


@pytest.mark.parametrize("yaml_path", get_yaml_files(), ids=os.path.basename)
def test_validate_conformance_yaml(yaml_path):
    yaml_data = load_yaml_file(yaml_path)
    basename = os.path.basename(yaml_path)
    try:
        jsonschema.validate(instance=yaml_data, schema=SCHEMA)
    except jsonschema.ValidationError as e:
        pytest.fail(f"{basename} failed schema validation: {e.message}")

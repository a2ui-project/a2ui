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
import glob
import unittest

try:
    import jsonschema
except ImportError:
    jsonschema = None


def load_json_file(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_yaml_file(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


CONFORMANCE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(CONFORMANCE_DIR, "conformance_schema.json")


class TestConformanceYAMLSchema(unittest.TestCase):
    """Validates all conformance YAML suites against conformance_schema.json."""

    def test_validate_conformance_yaml_files(self) -> None:
        schema = load_json_file(SCHEMA_PATH)
        yaml_files = glob.glob(os.path.join(CONFORMANCE_DIR, "suites", "*.yaml"))
        self.assertTrue(yaml_files, "No YAML suite files found in conformance/suites/")

        for yaml_path in yaml_files:
            basename = os.path.basename(yaml_path)
            with self.subTest(yaml_file=basename):
                yaml_data = load_yaml_file(yaml_path)
                if jsonschema is not None:
                    try:
                        jsonschema.validate(instance=yaml_data, schema=schema)
                    except jsonschema.ValidationError as e:
                        self.fail(f"{basename} failed schema validation: {e.message}")
                else:
                    self._validate_manually(basename, yaml_data)

    def _validate_manually(self, basename: str, yaml_data: list) -> None:
        self.assertIsInstance(yaml_data, list, f"{basename} root must be a list of test cases")
        valid_actions = {"get", "set", "subscribe", "unsubscribe", "verify_subscription", "dispose"}
        for case in yaml_data:
            self.assertIn("name", case, f"{basename} test case missing 'name'")
            self.assertIn("steps", case, f"{basename} test case '{case.get('name')}' missing 'steps'")
            self.assertIsInstance(case["steps"], list, f"{basename} '{case.get('name')}' steps must be a list")
            for step in case["steps"]:
                self.assertIn("action", step, f"{basename} '{case.get('name')}' step missing 'action'")
                self.assertIn(step["action"], valid_actions, f"{basename} '{case.get('name')}' invalid action '{step['action']}'")


if __name__ == "__main__":
    unittest.main()



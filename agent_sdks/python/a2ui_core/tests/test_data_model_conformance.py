# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import collections
import collections.abc
collections.Hashable = collections.abc.Hashable

import copy
import os
import re
import unittest
import yaml

from a2ui.core.state.data_model import DataModel


def _get_conformance_suite_path(rel_path: str) -> str:
    # Resolve relative to repo root
    this_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.abspath(os.path.join(this_dir, "../../../.."))
    return os.path.join(root_dir, "agent_sdks", "conformance", "suites", rel_path)


def load_yaml_suite(rel_path: str) -> list[dict]:
    path = _get_conformance_suite_path(rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class TestDataModelConformance(unittest.TestCase):
    """Executes the language-agnostic DataModel conformance suite."""

    def test_all_conformance_cases(self) -> None:
        cases = load_yaml_suite("core/state/data_model.yaml")
        self.assertTrue(cases, "No test cases found in data_model.yaml")

        for test_case in cases:
            with self.subTest(case=test_case["name"]):
                self._run_case(test_case)

    def _run_case(self, test_case: dict) -> None:
        initial_data = test_case.get("initial_data", {})
        dm = DataModel(initial_data=initial_data)
        listeners: dict[str, dict] = {}

        for step_idx, step in enumerate(test_case.get("steps", [])):
            action = step["action"]
            expect_error = step.get("expect_error")

            try:
                if action == "get":
                    path = step["path"]
                    if expect_error:
                        with self.assertRaises(Exception) as exc_info:
                            dm.get(path)
                        self.assertRegex(str(exc_info.exception), expect_error)
                    else:
                        result = dm.get(path)
                        if step.get("expect_undefined") or step.get("expect_null"):
                            self.assertIsNone(
                                result,
                                f"[{test_case['name']} step {step_idx}] Expected None for {path}, got {result}",
                            )
                        elif "expect" in step:
                            self.assertEqual(
                                result,
                                step["expect"],
                                f"[{test_case['name']} step {step_idx}] Value mismatch for {path}",
                            )

                elif action == "set":
                    path = step["path"]
                    if expect_error:
                        with self.assertRaises(Exception) as exc_info:
                            if step.get("remove"):
                                dm.set(path, None)
                            else:
                                dm.set(path, step.get("value"))
                        self.assertRegex(str(exc_info.exception), expect_error)
                    else:
                        if step.get("remove"):
                            dm.set(path, None)
                        else:
                            dm.set(path, step.get("value"))

                elif action == "subscribe":
                    path = step["path"]
                    listener_id = step["listener_id"]
                    updates: list = []

                    def _make_callback(update_list: list):
                        def cb(val):
                            update_list.append(copy.deepcopy(val))
                        return cb

                    if expect_error:
                        with self.assertRaises(Exception) as exc_info:
                            dm.subscribe(path, _make_callback(updates))
                        self.assertRegex(str(exc_info.exception), expect_error)
                    else:
                        sub = dm.subscribe(path, _make_callback(updates))
                        listeners[listener_id] = {"sub": sub, "updates": updates}

                elif action == "verify_subscription":
                    listener_id = step["listener_id"]
                    self.assertIn(listener_id, listeners, f"Listener {listener_id} not registered")
                    expected_updates = step.get("expect_updates", [])
                    actual_updates = listeners[listener_id]["updates"]
                    self.assertEqual(
                        actual_updates,
                        expected_updates,
                        f"[{test_case['name']} step {step_idx}] Listener {listener_id} update history mismatch",
                    )

                elif action == "unsubscribe":
                    listener_id = step["listener_id"]
                    self.assertIn(listener_id, listeners, f"Listener {listener_id} not registered")
                    listeners[listener_id]["sub"].unsubscribe()

                elif action == "dispose":
                    dm.dispose()

                else:
                    self.fail(f"Unknown action: {action}")

            except Exception as e:
                if not expect_error:
                    raise AssertionError(f"[{test_case['name']} step {step_idx}] Unexpected error during '{action}': {e}") from e


if __name__ == "__main__":
    unittest.main()

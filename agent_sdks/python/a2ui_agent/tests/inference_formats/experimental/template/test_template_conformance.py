# Copyright 2024 Google LLC
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

"""Conformance test runner for A2UI Templates executing declarative YAML suites."""

import glob
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple
import jsonschema
import pytest
import yaml

from a2ui.inference_formats.experimental.template import (
    StaticTemplate,
    TemplateProcessor,
)
from a2ui.inference_formats.experimental.template.processor import (
    _substitute_params,
)


def get_conformance_dir() -> Path:
    """Dynamically resolves the conformance directory regardless of nesting."""
    curr = Path(__file__).resolve().parent
    return curr / "conformance"


def load_conformance_schema() -> Dict[str, Any]:
    schema_path = get_conformance_dir() / "schema" / "template_conformance_schema.json"
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_all_conformance_cases() -> List[Tuple[str, str, Dict[str, Any]]]:
    """Loads and validates all test cases across conformance suite YAML files."""
    schema = load_conformance_schema()
    cases: List[Tuple[str, str, Dict[str, Any]]] = []
    suites_dir = get_conformance_dir() / "suites"

    for yaml_path in sorted(suites_dir.glob("*.yaml")):
        suite_name = yaml_path.name
        with open(yaml_path, "r", encoding="utf-8") as f:
            raw_cases = yaml.safe_load(f) or []

        # Validate the suite file against conformance JSON Schema
        jsonschema.validate(instance=raw_cases, schema=schema)

        for case in raw_cases:
            cases.append((suite_name, case["name"], case))

    return cases


CONFORMANCE_CASES = load_all_conformance_cases()


def _execute_case(case: Dict[str, Any]) -> Any:
    action = case["action"]

    if action == "substitute_params":
        val = case["args"]["value"]
        params = case["args"]["params"]
        return _substitute_params(val, params)

    elif action == "expand_template":
        templates: List[StaticTemplate] = []
        if "template" in case:
            templates.append(StaticTemplate.from_dict(case["template"]))
        elif "templates" in case:
            for t_dict in case["templates"]:
                templates.append(StaticTemplate.from_dict(t_dict))

        base_catalog = case.get("base_catalog", None)
        processor = TemplateProcessor(templates=templates, base_catalog=base_catalog)

        template_id = case.get(
            "template_id",
            templates[0].template_id if templates else "Unknown",
        )
        instance_id = case.get("instance_id", "root")
        args = case.get("args", {})

        return processor.expand_template(
            instance_id=instance_id,
            template_id=template_id,
            passed_params=args,
        )

    elif action == "process_message":
        templates = []
        if "template" in case:
            templates.append(StaticTemplate.from_dict(case["template"]))
        elif "templates" in case:
            for t_dict in case["templates"]:
                templates.append(StaticTemplate.from_dict(t_dict))

        base_catalog = case.get("base_catalog", None)
        processor = TemplateProcessor(templates=templates, base_catalog=base_catalog)

        return processor.process_message(case["message"])

    elif action == "validate_template":
        return StaticTemplate.from_dict(case["template"])

    raise ValueError(f"Unknown conformance test action: '{action}'")


@pytest.mark.parametrize("suite_name,case_name,case", CONFORMANCE_CASES)
def test_template_conformance(
    suite_name: str, case_name: str, case: Dict[str, Any]
) -> None:
    """Executes a single declarative conformance test case."""
    if "expect_error" in case:
        expected_msg = case["expect_error"].get("message", "")
        with pytest.raises(Exception) as excinfo:
            _execute_case(case)
        if expected_msg:
            assert expected_msg.lower() in str(excinfo.value).lower(), (
                f"[{suite_name}::{case_name}] Expected error containing"
                f" '{expected_msg}', got: {str(excinfo.value)}"
            )
    else:
        actual = _execute_case(case)
        expected = case["expect"]
        if (
            isinstance(actual, list)
            and isinstance(expected, list)
            and all(isinstance(x, dict) and "id" in x for x in actual)
            and all(isinstance(x, dict) and "id" in x for x in expected)
        ):
            actual_sorted = sorted(actual, key=lambda x: str(x["id"]))
            expected_sorted = sorted(expected, key=lambda x: str(x["id"]))
            assert actual_sorted == expected_sorted, (
                f"[{suite_name}::{case_name}] Result mismatch:\n"
                f"Expected: {expected_sorted}\n"
                f"Actual:   {actual_sorted}"
            )
        else:
            assert actual == expected, (
                f"[{suite_name}::{case_name}] Result mismatch:\n"
                f"Expected: {expected}\n"
                f"Actual:   {actual}"
            )

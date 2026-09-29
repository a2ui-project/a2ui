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

"""Conformance tests running ``conformance/agent/macros/macros.yaml`` against golden files, error expectations, and schema validation."""

from __future__ import annotations

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiRecursionError,
    A2uiValidationError,
)
from .macro_suite import Case, load_cases, run_case, validate_payload

CASES = load_cases()
GOLDEN_CASES = [c for c in CASES if c.golden is not None]
ERROR_CASES = [c for c in CASES if c.expect_error is not None]
EXPECT_CASES = [c for c in CASES if c.expect is not None]
PASSTHROUGH_CASES = [c for c in CASES if c.action == "transform_to_inference"]

CATEGORY_TO_EXCEPTION = {
    "CatalogError": A2uiCatalogError,
    "RecursionError": A2uiRecursionError,
    "ValidationError": A2uiValidationError,
}


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=lambda c: c.id)
def test_matches_golden(case: Case) -> None:
    """Macro expansion emits exactly the recorded wire payload."""
    assert run_case(case) == case.load_golden(), case.description


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=lambda c: c.id)
def test_golden_is_spec_valid(case: Case) -> None:
    """The recorded payload passes the validator the agent SDK uses at runtime."""
    validate_payload(case.load_golden(), case)


@pytest.mark.parametrize("case", ERROR_CASES, ids=lambda c: c.id)
def test_expect_error(case: Case) -> None:
    """Error cases trigger the expected exception category."""
    category = case.expect_error.get("category")
    expected_exc = CATEGORY_TO_EXCEPTION.get(category, A2uiError)
    with pytest.raises(expected_exc):
        payload = run_case(case)
        if payload:
            validate_payload(payload, case)


@pytest.mark.parametrize("case", EXPECT_CASES, ids=lambda c: c.id)
def test_expect_assertion(case: Case) -> None:
    """Evaluates expect assertions for catalog synthesis and metadata preservation."""
    result = run_case(case)
    expect = case.expect or {}

    if "augmented_components" in expect:
        catalog_schema = result.catalog_schema
        components = catalog_schema.get("components", {})
        for comp in expect["augmented_components"]:
            assert comp in components, f"Expected {comp} in synthesized catalog components"

    if "absent_components" in expect:
        catalog_schema = result.catalog_schema
        components = catalog_schema.get("components", {})
        for comp in expect["absent_components"]:
            assert comp not in components, f"Expected {comp} to be absent from catalog components"

    if "any_component_references" in expect:
        refs = result.catalog_schema.get("$defs", {}).get("anyComponent", {}).get("oneOf", [])
        ref_targets = [r.get("$ref") for r in refs if isinstance(r, dict)]
        for ref in expect["any_component_references"]:
            assert ref in ref_targets, f"Expected {ref} in anyComponent.oneOf"

    if "absent_any_component_references" in expect:
        refs = result.catalog_schema.get("$defs", {}).get("anyComponent", {}).get("oneOf", [])
        ref_targets = [r.get("$ref", "") for r in refs if isinstance(r, dict)]
        for name in expect["absent_any_component_references"]:
            assert not any(
                r.endswith(f"/{name}") for r in ref_targets
            ), f"Expected reference to {name} to be absent from anyComponent.oneOf"

    if "component_properties" in expect:
        components = result.catalog_schema.get("components", {})
        for comp_name, expected_props in expect["component_properties"].items():
            assert comp_name in components, f"{comp_name} not found in catalog"
            actual_props = components[comp_name].get("properties", {})
            for p_name, p_schema in expected_props.items():
                assert p_name in actual_props, f"Property {p_name} missing from {comp_name}"
                for k, v in p_schema.items():
                    assert actual_props[p_name].get(k) == v

    if "protocol_version" in expect:
        assert result.version == expect["protocol_version"]


@pytest.mark.parametrize("case", PASSTHROUGH_CASES, ids=lambda c: c.id)
def test_reverse_passthrough(case: Case) -> None:
    """Verifies transform_to_inference returns messages untouched."""
    result = run_case(case)
    assert len(result) == 1
    assert result[0]["updateComponents"]["components"] == [case.input]


def test_suite_covers_every_golden() -> None:
    """No golden file is orphaned by a case being renamed or removed."""
    import os

    from .macro_suite import GOLDEN_DIR

    on_disk = {f for f in os.listdir(GOLDEN_DIR) if f.endswith(".json")}
    declared = {case.golden for case in GOLDEN_CASES}
    assert on_disk == declared

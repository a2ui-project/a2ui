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

import os

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiRecursionError,
    A2uiValidationError,
)
from a2ui.core.schema.v1_0 import CatalogDefinition as CatalogDefinitionV10

from .conformance_helpers import assert_known_keys, case_params
from .macro_suite import Case, GOLDEN_DIR, load_cases, run_case, validate_payload

SUITE = "agent/macros/macros.yaml"
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

_EXPECT_ERROR_KEYS = frozenset({"category", "message"})
_MACRO_EXPECT_KEYS = frozenset({
    "absent_any_component_references",
    "absent_components",
    "absent_property_on_all_components",
    "any_component_references",
    "augmented_components",
    "catalog_id",
    "component_count",
    "component_properties",
    "component_types",
    "components",
    "create_surface_catalog_id",
    "has_any_component_discriminator",
    "has_any_function",
    "protocol_version",
})


@pytest.mark.parametrize("suite, case", case_params(SUITE, GOLDEN_CASES))
def test_matches_golden(suite: str, case: Case) -> None:
    """Macro expansion emits exactly the recorded wire payload."""
    del suite
    assert run_case(case) == case.load_golden(), case.description


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=lambda c: c.id)
def test_golden_is_spec_valid(case: Case) -> None:
    """The recorded payload passes the validator the agent SDK uses at runtime."""
    validate_payload(case.load_golden(), case)


@pytest.mark.parametrize("suite, case", case_params(SUITE, ERROR_CASES))
def test_expect_error(suite: str, case: Case) -> None:
    """Error cases trigger the expected exception category."""
    del suite
    assert case.expect_error is not None
    assert_known_keys(case.expect_error, _EXPECT_ERROR_KEYS, "expect_error")
    expected_exc = CATEGORY_TO_EXCEPTION[str(case.expect_error.get("category"))]
    with pytest.raises(expected_exc, match=case.expect_error.get("message")):
        payload = run_case(case)
        if isinstance(payload, list) and payload:
            validate_payload(payload, case)


@pytest.mark.parametrize("suite, case", case_params(SUITE, EXPECT_CASES))
def test_expect_assertion(suite: str, case: Case) -> None:
    """Evaluates expect assertions for catalog synthesis, sidecar export, and transport fallbacks."""
    del suite
    result = run_case(case)
    expect = case.expect or {}
    assert_known_keys(expect, _MACRO_EXPECT_KEYS, "macros expect")

    if isinstance(result, list):
        all_comps = [
            comp
            for msg in result
            if isinstance(msg, dict) and "updateComponents" in msg
            for comp in msg["updateComponents"].get("components", [])
        ]
        if "create_surface_catalog_id" in expect:
            create_msgs = [
                msg["createSurface"]
                for msg in result
                if isinstance(msg, dict) and "createSurface" in msg
            ]
            assert len(create_msgs) == 1
            assert (
                create_msgs[0].get("catalogId") == expect["create_surface_catalog_id"]
            )
        if "components" in expect:
            assert all_comps == expect["components"]
        if "component_types" in expect:
            assert [c["component"] for c in all_comps] == expect["component_types"]
        if "absent_property_on_all_components" in expect:
            prop = expect["absent_property_on_all_components"]
            assert all(prop not in c for c in all_comps)
        validate_payload(result, case)
        return

    catalog_json = result.to_json()

    if "catalog_id" in expect:
        assert result.catalog_id == expect["catalog_id"]
        assert catalog_json.get("catalogId") == expect["catalog_id"]

    if "component_count" in expect:
        assert len(catalog_json.get("components", {})) == expect["component_count"]

    if "has_any_component_discriminator" in expect:
        discriminator = (
            catalog_json.get("$defs", {}).get("anyComponent", {}).get("discriminator")
        )
        if expect["has_any_component_discriminator"]:
            assert discriminator == {"propertyName": "component"}
        else:
            assert discriminator is None

    if "has_any_function" in expect:
        defs = catalog_json.get("$defs", {})
        assert ("anyFunction" in defs) is bool(expect["has_any_function"])

    if "augmented_components" in expect:
        catalog_schema = result.validation_schema
        components = catalog_schema.get("components", {})
        for comp in expect["augmented_components"]:
            assert (
                comp in components
            ), f"Expected {comp} in synthesized catalog components"

    if "absent_components" in expect:
        catalog_schema = result.validation_schema
        components = catalog_schema.get("components", {})
        for comp in expect["absent_components"]:
            assert (
                comp not in components
            ), f"Expected {comp} to be absent from catalog components"

    if "any_component_references" in expect:
        refs = (
            result.validation_schema.get("$defs", {})
            .get("anyComponent", {})
            .get("oneOf", [])
        )
        ref_targets = [r.get("$ref") for r in refs if isinstance(r, dict)]
        for ref in expect["any_component_references"]:
            assert ref in ref_targets, f"Expected {ref} in anyComponent.oneOf"

    if "absent_any_component_references" in expect:
        refs = (
            result.validation_schema.get("$defs", {})
            .get("anyComponent", {})
            .get("oneOf", [])
        )
        ref_targets = [str(r.get("$ref") or "") for r in refs if isinstance(r, dict)]
        for name in expect["absent_any_component_references"]:
            assert not any(
                r.endswith(f"/{name}") for r in ref_targets
            ), f"Expected reference to {name} to be absent from anyComponent.oneOf"

    if "component_properties" in expect:
        components = result.to_json().get("components", {})
        for comp_name, expected_props in expect["component_properties"].items():
            assert comp_name in components, f"{comp_name} not found in catalog"
            actual_props = components[comp_name].get("properties", {})
            for p_name, p_schema in expected_props.items():
                assert (
                    p_name in actual_props
                ), f"Property {p_name} missing from {comp_name}"
                assert isinstance(p_schema, dict)
                for k, v in p_schema.items():
                    assert actual_props[p_name].get(k) == v

    if "protocol_version" in expect:
        assert result.protocol_version == expect["protocol_version"]
        if expect["protocol_version"] == "1.0" and case.action == "to_catalog":
            CatalogDefinitionV10.model_validate(result.to_json())


@pytest.mark.parametrize("suite, case", case_params(SUITE, PASSTHROUGH_CASES))
def test_reverse_passthrough(suite: str, case: Case) -> None:
    """Verifies transform_to_inference returns messages untouched."""
    del suite
    result = run_case(case)
    assert len(result) == 1
    assert result[0]["updateComponents"]["components"] == [case.input]


def test_suite_covers_every_golden_and_case() -> None:
    """Every golden file is referenced and every case runs in at least one test."""
    on_disk = {f for f in os.listdir(GOLDEN_DIR) if f.endswith(".json")}
    declared = {case.golden for case in GOLDEN_CASES}
    assert on_disk == declared

    all_ids = [c.id for c in CASES]
    assert len(all_ids) == len(set(all_ids)), "Duplicate case IDs in macros.yaml"
    covered_ids = {
        c.id for c in (*GOLDEN_CASES, *ERROR_CASES, *EXPECT_CASES, *PASSTHROUGH_CASES)
    }
    assert covered_ids == set(all_ids)

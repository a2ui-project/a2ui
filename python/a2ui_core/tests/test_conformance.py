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

import os
import re
import pytest
import yaml
import contextlib

from a2ui.core.catalog import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.processing import MessageProcessor
from a2ui.core.exceptions import (
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    A2uiCatalogError,
    A2uiIntegrityError,
)

CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
}

CONFORMANCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../conformance/core")
)


def load_yaml_cases(filename: str):
    path = os.path.join(CONFORMANCE_DIR, filename)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return [(case.get("name"), case) for case in data if isinstance(case, dict)]


@contextlib.contextmanager
def assert_raises(expect_error):
    if isinstance(expect_error, dict):
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(category, A2uiError)
    else:
        expected_class = ValueError
        message = str(expect_error)

    with pytest.raises(expected_class) as excinfo:
        yield

    if message:
        assert re.search(re.escape(message), str(excinfo.value))


# --- Catalog Conformance Tests ---
cases_catalog = load_yaml_cases("catalog.yaml")


@pytest.mark.parametrize("name, case", cases_catalog, ids=[c[0] for c in cases_catalog])
def test_core_catalog_conformance(name, case):
    action = case["action"]

    if action == "from_json":
        catalog_data = case["catalog"]
        override_id = case.get("catalogId")
        protocol_version = (
            case.get("protocolVersion") or catalog_data.get("protocolVersion") or "v0.9"
        )
        expect_error = case.get("expectError")

        if expect_error:
            with assert_raises(expect_error):
                Catalog.from_json(
                    catalog_data,
                    catalog_id=override_id,
                    protocol_version=protocol_version,
                )
        else:
            cat = Catalog.from_json(
                catalog_data,
                catalog_id=override_id,
                protocol_version=protocol_version,
            )
            expected = case["expect"]
            if "catalogId" in expected:
                assert cat.catalog_id == expected["catalogId"]
            if "protocolVersion" in expected:
                assert cat.protocol_version == expected["protocolVersion"]
            if "instructions" in expected:
                assert cat.instructions == expected["instructions"]
            if "components" in expected:
                for comp_name, comp_expected in expected["components"].items():
                    comp = cat.get_component(comp_name)
                    assert comp is not None
                    if "allowedParents" in comp_expected:
                        assert comp.allowed_parents == comp_expected["allowedParents"]
                    if "allowedChildren" in comp_expected:
                        assert comp.allowed_children == comp_expected["allowedChildren"]
            if "functions" in expected:
                for func_name, func_expected in expected["functions"].items():
                    func = cat.get_function(func_name)
                    assert func is not None
                    if "allowedCallers" in func_expected:
                        assert func.allowed_callers == func_expected["allowedCallers"]
                    if "requiresUserActivation" in func_expected:
                        assert (
                            func.requires_user_activation
                            == func_expected["requiresUserActivation"]
                        )

    elif action == "catalog_schema":
        catalog_data = case["catalog"]
        override_id = (
            case.get("catalogId") or catalog_data.get("catalogId") or "test-catalog"
        )
        protocol_version = (
            case.get("protocolVersion") or catalog_data.get("protocolVersion") or "v0.9"
        )
        theme = case.get("theme")
        if theme and isinstance(catalog_data, dict):
            catalog_data = dict(catalog_data)
            catalog_data["theme"] = theme
        cat = Catalog.from_json(
            catalog_data,
            catalog_id=override_id,
            protocol_version=protocol_version,
        )
        schema = dict(cat.catalog_schema or {})
        components_map = schema.get("components", {})
        if components_map and "$defs" not in schema:
            defs = {}
            defs["anyComponent"] = {
                "oneOf": [{"$ref": f"#/components/{name}"} for name in components_map]
            }
            if schema.get("theme"):
                defs["theme"] = schema["theme"]
            schema["$defs"] = defs

        expected = case["expect"]
        for k, v in expected.items():
            act_v = schema.get(k)
            if act_v is None and k == "protocolVersion":
                act_v = protocol_version
            if act_v is None and k == "styles":
                act_v = schema.get("theme")
            assert act_v == v

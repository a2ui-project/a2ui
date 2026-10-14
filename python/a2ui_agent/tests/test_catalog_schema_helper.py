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

"""Tests for the catalog schema crawler shared by the compact inference formats."""

import pytest

from a2ui.core import Catalog
from a2ui.inference_formats._shared import CatalogSchemaHelper


@pytest.fixture
def helper() -> CatalogSchemaHelper:
    catalog = Catalog.from_json(
        {
            "catalogId": "test",
            "components": {
                "CustomButton": {
                    "type": "object",
                    "description": "A test button component.",
                    "properties": {
                        "label": {"type": "string"},
                        "action": {"$ref": "common_types.json#/$defs/Action"},
                        "children": {"$ref": "common_types.json#/$defs/ChildList"},
                        "child": {"$ref": "common_types.json#/$defs/Child"},
                    },
                }
            },
            "functions": {
                "testFunc": {
                    "type": "object",
                    "description": "A test function.",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "param1": {
                                    "type": "string",
                                    "description": "Param 1",
                                }
                            },
                        }
                    },
                }
            },
        },
        protocol_version="v0.9",
    )
    return CatalogSchemaHelper(catalog)


def test_descriptions(helper):
    assert helper.get_component_description("CustomButton") == (
        "A test button component."
    )
    assert helper.get_function_description("testFunc") == "A test function."


@pytest.mark.parametrize(
    "prop, expected",
    [("action", "Action"), ("children", "ChildList"), ("child", "Child")],
)
def test_property_type_comes_from_the_schema_ref(helper, prop, expected):
    assert helper.get_property_type("CustomButton", prop) == expected


def test_function_property_schema(helper):
    assert helper.get_function_property_schema("testFunc", "param1") == {
        "type": "string",
        "description": "Param 1",
    }


def test_unsupported_catalog_type_raises():
    with pytest.raises(TypeError):
        CatalogSchemaHelper("invalid_catalog_type")  # type: ignore[arg-type]

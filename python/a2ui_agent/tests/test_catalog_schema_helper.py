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


@pytest.fixture
def inheriting_helper() -> CatalogSchemaHelper:
    catalog = Catalog.from_json({
        "catalogId": "inheriting",
        "protocolVersion": "1.0",
        "components": {
            "Base": {
                "type": "object",
                "properties": {
                    "component": {"const": "Base"},
                    "mode": {"type": "string", "enum": ["a", "b"]},
                    "size": {"type": "string", "enum": ["s", "m"]},
                    "label": {"type": "string"},
                },
                "required": ["component"],
            },
            "Derived": {
                "type": "object",
                "allOf": [
                    {"$ref": "#/components/Base"},
                    {"$ref": "common_types.json#/$defs/Checkable"},
                ],
                "properties": {
                    "component": {"const": "Derived"},
                    "mode": {"type": "string"},
                    "size": {"type": "string", "enum": ["l"]},
                    "label": {"$ref": "common_types.json#/$defs/ComponentId"},
                    "checks": {"type": "array"},
                    "extra": {"type": "string"},
                },
                "required": ["component"],
            },
        },
    })
    return CatalogSchemaHelper(catalog)


def test_own_property_definition_wins_over_inherited_one(inheriting_helper):
    assert inheriting_helper.get_property_enum("Derived", "mode") is None
    assert inheriting_helper.get_property_enum("Derived", "size") == ["l"]
    assert inheriting_helper.get_property_type("Derived", "label") == "Child"
    assert inheriting_helper.get_property_enum("Base", "mode") == ["a", "b"]


def test_inherited_property_order_lists_checks_once_and_last(inheriting_helper):
    assert inheriting_helper.get_component_properties("Derived") == [
        "mode",
        "size",
        "label",
        "extra",
        "checks",
    ]
    assert inheriting_helper.is_checkable("Derived")


_V0_9_COMMON_TYPES = "https://a2ui.org/specification/v0_9/common_types.json"


@pytest.fixture
def nested_mixin_helper() -> CatalogSchemaHelper:
    catalog = Catalog.from_json({
        "catalogId": "nested_mixin",
        "protocolVersion": "v0.9",
        "$defs": {
            "MaterialComponentCommon": {
                "allOf": [
                    {"$ref": f"{_V0_9_COMMON_TYPES}#/$defs/ComponentCommon"},
                    {
                        "type": "object",
                        "properties": {
                            "weight": {"type": "number"},
                            "style": {
                                "type": "string",
                                "enum": ["flat", "raised"],
                            },
                        },
                    },
                ]
            }
        },
        "components": {
            "MaterialText": {
                "type": "object",
                "allOf": [
                    {"$ref": "#/$defs/MaterialComponentCommon"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "MaterialText"},
                            "text": {"type": "string"},
                            "usageHint": {
                                "type": "string",
                                "enum": ["h1", "body"],
                            },
                        },
                        "required": ["component", "text"],
                    },
                ],
            },
            "MaterialHeading": {
                "type": "object",
                "allOf": [
                    {"$ref": "#/$defs/MaterialComponentCommon"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "MaterialHeading"},
                            "text": {"type": "string"},
                            "style": {"type": "string", "enum": ["display"]},
                        },
                        "required": ["component", "text"],
                    },
                ],
                "properties": {
                    "weight": {"$ref": f"{_V0_9_COMMON_TYPES}#/$defs/ComponentId"},
                },
            },
        },
    })
    return CatalogSchemaHelper(catalog)


def test_nested_local_mixin_properties_follow_component_properties(
    nested_mixin_helper,
):
    assert nested_mixin_helper.get_component_properties("MaterialText") == [
        "text",
        "usageHint",
        "weight",
        "style",
    ]
    assert nested_mixin_helper.get_component_required("MaterialText") == [
        "component",
        "text",
    ]
    assert nested_mixin_helper.get_property_schema("MaterialText", "weight") == {
        "type": "number"
    }
    assert nested_mixin_helper.get_property_enum("MaterialText", "style") == [
        "flat",
        "raised",
    ]
    assert nested_mixin_helper.accepts_number(
        nested_mixin_helper.get_property_schema("MaterialText", "weight")
    )


def test_own_definition_wins_over_nested_local_mixin(nested_mixin_helper):
    assert nested_mixin_helper.get_component_properties("MaterialHeading") == [
        "text",
        "style",
        "weight",
    ]
    assert nested_mixin_helper.get_property_enum("MaterialHeading", "style") == [
        "display"
    ]
    assert nested_mixin_helper.get_property_type("MaterialHeading", "weight") == "Child"

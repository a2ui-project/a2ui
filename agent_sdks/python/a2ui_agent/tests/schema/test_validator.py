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

import json
import copy
import pytest
from unittest.mock import MagicMock
from a2ui.schema.manager import A2uiSchemaManager, A2uiCatalog, CatalogConfig
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9
from a2ui.schema.validator import (
    _find_root_id as find_root_id,
    extract_component_ref_fields,
    analyze_topology,
    get_component_references,
)


class TestValidator:

  @pytest.fixture
  def catalog_0_9(self):
    s2c_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://a2ui.org/specification/v0_9/server_to_client.json",
        "title": "A2UI Message Schema",
        "oneOf": [
            {"$ref": "#/$defs/CreateSurfaceMessage"},
            {"$ref": "#/$defs/UpdateComponentsMessage"},
            {"$ref": "#/$defs/UpdateDataModelMessage"},
            {"$ref": "#/$defs/DeleteSurfaceMessage"},
        ],
        "$defs": {
            "CreateSurfaceMessage": {
                "type": "object",
                "properties": {
                    "version": {"const": "v0.9"},
                    "createSurface": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {
                                "type": "string",
                            },
                            "catalogId": {
                                "type": "string",
                            },
                            "theme": {
                                "type": "object",
                                "additionalProperties": True,
                            },
                        },
                        "required": ["surfaceId", "catalogId"],
                        "additionalProperties": False,
                    },
                },
                "required": ["version", "createSurface"],
                "additionalProperties": False,
            },
            "UpdateComponentsMessage": {
                "type": "object",
                "properties": {
                    "version": {"const": "v0.9"},
                    "updateComponents": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {
                                "type": "string",
                            },
                            "components": {
                                "type": "array",
                                "minItems": 1,
                                "items": {"$ref": "catalog.json#/$defs/anyComponent"},
                            },
                        },
                        "required": ["surfaceId", "components"],
                        "additionalProperties": False,
                    },
                },
                "required": ["version", "updateComponents"],
                "additionalProperties": False,
            },
            "UpdateDataModelMessage": {
                "type": "object",
                "properties": {
                    "version": {"const": "v0.9"},
                    "updateDataModel": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {
                                "type": "string",
                            },
                            "path": {"type": "string"},
                            "value": {"additionalProperties": True},
                        },
                        "required": ["surfaceId"],
                        "additionalProperties": False,
                    },
                },
                "required": ["version", "updateDataModel"],
                "additionalProperties": False,
            },
            "DeleteSurfaceMessage": {
                "type": "object",
                "properties": {
                    "version": {"const": "v0.9"},
                    "deleteSurface": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {"type": "string"},
                        },
                        "required": ["surfaceId"],
                        "additionalProperties": False,
                    },
                },
                "required": ["deleteSurface", "version"],
                "additionalProperties": False,
            },
        },
    }
    catalog_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        "title": "A2UI Basic Catalog",
        "catalogId": "https://a2ui.dev/specification/v0_9/catalogs/basic/catalog.json",
        "components": {
            "Text": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Text"},
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "text"],
                "unevaluatedProperties": False,
            },
            "Image": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Image"},
                    "url": {"type": "string"},
                },
                "required": ["component", "url"],
                "unevaluatedProperties": False,
            },
            "Icon": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Icon"},
                    "name": {"type": "string"},
                },
                "required": ["component", "name"],
                "unevaluatedProperties": False,
            },
            "Column": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Column"},
                    "children": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component", "children"],
                "unevaluatedProperties": False,
            },
            "Card": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Card"},
                    "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "child"],
                "unevaluatedProperties": False,
            },
            "Button": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Button"},
                    "text": {"type": "string"},
                    "action": {"$ref": "common_types.json#/$defs/Action"},
                },
                "required": ["component", "text", "action"],
                "unevaluatedProperties": False,
            },
            "List": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "List"},
                            "children": {"$ref": "common_types.json#/$defs/ChildList"},
                            "direction": {
                                "type": "string",
                                "enum": ["vertical", "horizontal"],
                            },
                        },
                        "required": ["component", "children"],
                    },
                ],
                "unevaluatedProperties": False,
            },
        },
        "$defs": {
            "CatalogComponentCommon": {
                "type": "object",
                "properties": {"weight": {"type": "number"}},
            },
            "anyComponent": {
                "oneOf": [
                    {"$ref": "#/components/Text"},
                    {"$ref": "#/components/Image"},
                    {"$ref": "#/components/Icon"},
                    {"$ref": "#/components/Column"},
                    {"$ref": "#/components/Card"},
                    {"$ref": "#/components/Button"},
                    {"$ref": "#/components/List"},
                ],
                "discriminator": {"propertyName": "component"},
            },
        },
    }
    common_types_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://a2ui.org/specification/v0_9/common_types.json",
        "title": "A2UI Common Types",
        "$defs": {
            "ComponentId": {
                "type": "string",
            },
            "AccessibilityAttributes": {
                "type": "object",
                "properties": {
                    "label": {
                        "$ref": "#/$defs/DynamicString",
                    }
                },
            },
            "Action": {"type": "object", "additionalProperties": True},
            "ComponentCommon": {
                "type": "object",
                "properties": {"id": {"$ref": "#/$defs/ComponentId"}},
                "required": ["id"],
            },
            "DataBinding": {"type": "object"},
            "DynamicString": {
                "anyOf": [{"type": "string"}, {"$ref": "#/$defs/DataBinding"}]
            },
            "DynamicValue": {
                "anyOf": [
                    {"type": "object"},
                    {"type": "array"},
                    {"$ref": "#/$defs/DataBinding"},
                ]
            },
            "DynamicNumber": {
                "anyOf": [{"type": "number"}, {"$ref": "#/$defs/DataBinding"}]
            },
            "ChildList": {
                "oneOf": [
                    {"type": "array", "items": {"$ref": "#/$defs/ComponentId"}},
                    {
                        "type": "object",
                        "properties": {
                            "componentId": {"$ref": "#/$defs/ComponentId"},
                            "path": {"type": "string"},
                        },
                        "required": ["componentId", "path"],
                        "additionalProperties": False,
                    },
                ]
            },
        },
    }
    return A2uiCatalog(
        version=VERSION_0_9,
        name="standard",
        catalog_schema=catalog_schema,
        s2c_schema=s2c_schema,
        common_types_schema=common_types_schema,
    )

  @pytest.fixture
  def catalog_0_8(self):
    s2c_schema = {
        "title": "A2UI Message Schema",
        "description": "Describes a JSON payload for an A2UI message.",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "beginRendering": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "surfaceId": {"type": "string"},
                    "root": {"type": "string"},
                    "styles": {
                        "type": "object",
                        "description": "Styling information for the UI.",
                        "additionalProperties": True,
                    },
                },
                "required": ["surfaceId"],
            },
            "surfaceUpdate": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "surfaceId": {
                        "type": "string",
                    },
                    "components": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "id": {
                                    "type": "string",
                                },
                                "component": {
                                    "type": "object",
                                    "description": "A wrapper object.",
                                    "additionalProperties": True,
                                },
                            },
                            "required": ["id", "component"],
                        },
                    },
                },
                "required": ["surfaceId", "components"],
            },
            "dataModelUpdate": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "contents": {"type": "object", "additionalProperties": True},
                },
            },
        },
        "additionalProperties": False,
    }
    catalog_schema = {
        "catalogId": (
            "https://a2ui.org/specification/v0_8/json/standard_catalog_definition.json"
        ),
        "components": {
            "Column": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "children": {"type": "array", "items": {"type": "string"}}
                },
            },
            "Card": {
                "type": "object",
                "additionalProperties": True,
                "properties": {"child": {"type": "string"}},
            },
            "Button": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "label": {"type": "string"},
                    "action": {
                        "type": "object",
                        "properties": {
                            "functionCall": {
                                "type": "object",
                                "properties": {
                                    "call": {"type": "string"},
                                    "args": {"type": "object"},
                                },
                            }
                        },
                    },
                },
            },
            "Text": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "text": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "object", "additionalProperties": True},
                        ]
                    }
                },
            },
            "List": {
                "type": "object",
                "additionalProperties": True,
            },
        },
        "styles": {"font": {"type": "string"}, "primaryColor": {"type": "string"}},
    }
    return A2uiCatalog(
        version=VERSION_0_8,
        name="standard",
        catalog_schema=catalog_schema,
        s2c_schema=s2c_schema,
        common_types_schema=None,
    )

  @pytest.fixture(params=[VERSION_0_8, VERSION_0_9])
  def test_catalog(self, request, catalog_0_8, catalog_0_9):
    """Parameterized fixture to run tests on both v0.8 and v0.9 catalogs."""
    if request.param == VERSION_0_8:
      return catalog_0_8
    return catalog_0_9

  def test_pretty_error_messages(self, catalog_0_9):
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "recipe-card",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "recipe-card",
                "components": [
                    {
                        "id": "main-column",
                        "component": "Column",
                        "children": ["recipe-image"],
                        "gap": "small",
                    },
                    {
                        "id": "recipe-image",
                        "component": "Image",
                        "url": {"path": "/image"},
                        "altText": {"path": "/title"},
                        "fit": "cover",
                    },
                    {
                        "id": "title",
                        "component": "Text",
                        "text": {"path": "/title"},
                        "usageHint": "h3",
                    },
                    {
                        "id": "rating-row",
                        "component": "Row",
                        "children": ["star-icon"],
                    },
                ],
            },
        },
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": "recipe-card",
                "value": {
                    "image": (
                        "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300&h=180&fit=crop"
                    )
                },
            },
        },
        {"version": "v0.9", "deleteSurface": {}},
        {"unknownMessage": {}},
    ]

    with pytest.raises(ValueError) as excinfo:
      catalog_0_9.validator.validate(payload)

    err_text = str(excinfo.value)
    print(f"\nVALIDATOR_OUTPUT_START\n{err_text}\nVALIDATOR_OUTPUT_END")

    assert "Unknown component: Row" in err_text
    assert "'usageHint' was unexpected" in err_text
    assert "'gap' was unexpected" in err_text
    assert "'altText', 'fit' were unexpected" in err_text
    assert "'surfaceId' is a required property" in err_text
    assert "{'path': '/image'} is not of type 'string'" in err_text
    assert "Unknown message type with keys ['unknownMessage']" in err_text

  def test_bundle_0_8(self, catalog_0_8):
    bundled = catalog_0_8.validator._bundle_0_8_schemas()

    # Verify styles injection
    styles_node = bundled["properties"]["beginRendering"]["properties"]["styles"]
    assert styles_node["additionalProperties"] is False
    assert "font" in styles_node["properties"]
    assert "primaryColor" in styles_node["properties"]

    # Verify component injection
    component_node = bundled["properties"]["surfaceUpdate"]["properties"]["components"][
        "items"
    ]["properties"]["component"]
    assert component_node["additionalProperties"] is False
    assert "Text" in component_node["properties"]
    assert "Button" in component_node["properties"]

  def test_find_root_id_v08(self):
    messages = [
        {"beginRendering": {"surfaceId": "s1", "root": "custom-root"}},
        {"surfaceUpdate": {"surfaceId": "s1", "components": []}},
    ]
    assert find_root_id(messages) == "custom-root"

  def test_find_root_id_v09(self):
    # For v0.9, if createSurface is provided, the root is 'root'
    messages = [
        {"createSurface": {"surfaceId": "s1"}},
        {"updateComponents": {"surfaceId": "s1", "components": []}},
    ]
    assert find_root_id(messages) == "root"

    # For an incremental update, there is no root
    messages = [{"updateComponents": {"surfaceId": "s1", "components": []}}]
    assert find_root_id(messages) is None

  def test_get_component_references(self):
    # Mock ref_fields_map
    ref_fields_map = {
        "Container": ({"child"}, {"children"}),
        "Text": (set(), set()),
    }
    comp = {
        "id": "c1",
        "component": "Container",
        "child": "c2",
        "children": ["c3", "c4"],
    }
    refs = list(get_component_references(comp, ref_fields_map))
    assert ("c2", "child") in refs
    assert ("c3", "children") in refs
    assert ("c4", "children") in refs

  def test_analyze_topology_circular(self):
    ref_fields_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "c1", "component": "Node", "next": "c2"},
        {"id": "c2", "component": "Node", "next": "c1"},
    ]
    with pytest.raises(ValueError, match="Circular reference detected"):
      analyze_topology("c1", components, ref_fields_map)

  def test_analyze_topology_self_ref(self):
    ref_fields_map = {"Node": ({"next"}, set())}
    components = [{"id": "c1", "component": "Node", "next": "c1"}]
    with pytest.raises(ValueError, match="Self-reference detected"):
      analyze_topology("c1", components, ref_fields_map)

  def test_analyze_topology_reachable(self):
    ref_fields_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "root", "component": "Node", "next": "c1"},
        {"id": "c1", "component": "Node", "next": "c2"},
        {"id": "c2", "component": "Node"},
        {"id": "orphan", "component": "Node"},
    ]
    reachable = analyze_topology("root", components, ref_fields_map)
    assert reachable == {"root", "c1", "c2"}

  def test_extract_component_ref_fields_mock(self):
    # Test with a mock catalog
    catalog = MagicMock(spec=A2uiCatalog)
    catalog.version = VERSION_0_9
    catalog.common_types_schema = {
        "$defs": {
            "ComponentId": {"type": "string"},
            "ChildList": {
                "oneOf": [
                    {"type": "array", "items": {"$ref": "#/$defs/ComponentId"}},
                    {
                        "type": "object",
                        "properties": {"componentId": {"$ref": "#/$defs/ComponentId"}},
                    },
                ]
            },
        }
    }
    catalog.catalog_schema = {
        "components": {
            "MyComp": {
                "properties": {
                    "ref": {"$ref": "common_types.json#/$defs/ComponentId"},
                    "multi": {"$ref": "common_types.json#/$defs/ChildList"},
                }
            }
        }
    }
    # Mock s2c_schema to avoid errors in extraction
    catalog.s2c_schema = {}

    ref_map = extract_component_ref_fields(catalog)
    assert "MyComp" in ref_map
    single_refs, list_refs = ref_map["MyComp"]
    assert "ref" in single_refs
    assert "multi" in list_refs

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

from typing import Any, Dict, List, Literal, Optional, Set, Tuple
from pydantic import BaseModel, Field, ValidationError
import pytest
from a2ui.core.catalog import (
    Catalog,
    ComponentApi,
    ModelComponentApi,
    FunctionImplementation,
)
from a2ui.core.catalog.catalog import TComponent, TFunction
from a2ui.core.validating import CatalogSchemaValidator
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema.common_types import ComponentId
from a2ui.core.schema.constants import SPEC_VERSION


def _val(
    catalog: Catalog[TComponent, TFunction],
    common_types_schema: Dict[str, Any] = {},
) -> CatalogSchemaValidator:
    return CatalogSchemaValidator.from_catalog(
        catalog, common_types_schema=common_types_schema
    )


# ==============================================================================
# 1. Catalog Initialization & Metadata
# ==============================================================================


def test_catalog_initialization_with_models():
    class EmptyModel(BaseModel):
        pass

    cat = Catalog(
        catalog_id="https://a2ui.org/model-init",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(EmptyModel, "Empty")],
        functions=[],
    )
    assert cat.spec_version == SPEC_VERSION
    assert cat.catalog_id == "https://a2ui.org/model-init"


def test_catalog_initialization_from_json():
    schema = {
        "catalogId": "https://a2ui.org/spec/v0.9/catalog.json",
        "components": {
            "Text": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "additionalProperties": False,
            }
        },
    }
    catalog = Catalog.from_json(schema, spec_version=SPEC_VERSION)
    assert catalog.catalog_id == "https://a2ui.org/spec/v0.9/catalog.json"


# ==============================================================================
# 2. Component Validation & Properties Handling
# ==============================================================================


def test_component_validation_with_models():
    class ButtonComp(BaseModel):
        id: str
        component: Literal["Button"] = "Button"
        label: str

    cat = Catalog(
        catalog_id="https://a2ui.org/model",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(ButtonComp, "Button")],
        functions=[],
    )

    # 1. Test validate_components Valid
    _val(cat).validate_components(
        [{"id": "b1", "component": "Button", "label": "Click"}]
    )

    # 2. Test validate_components Invalid missing label
    with pytest.raises((ValidationError, ValueError)) as exc_info:
        _val(cat).validate_components([{"id": "b1", "component": "Button"}])
    error_msg = str(exc_info.value)
    assert "label" in error_msg
    assert (
        "Field required" in error_msg
        or "missing" in error_msg.lower()
        or "is a required property" in error_msg
    )


def test_additional_properties_handling_with_models():
    class DefaultBox(BaseModel):
        component: Literal["DefaultBox"] = "DefaultBox"

    class AllowBox(BaseModel):
        model_config = {"extra": "allow"}
        component: Literal["AllowBox"] = "AllowBox"

    class ForbidBox(BaseModel):
        model_config = {"extra": "forbid"}
        component: Literal["ForbidBox"] = "ForbidBox"

    cat = Catalog(
        catalog_id="https://a2ui.org/model-extra",
        spec_version=SPEC_VERSION,
        components=[
            ModelComponentApi(DefaultBox, "DefaultBox"),
            ModelComponentApi(AllowBox, "AllowBox"),
            ModelComponentApi(ForbidBox, "ForbidBox"),
        ],
        functions=[],
    )

    # 1. Permits extra properties when extra is default/ignore or allow
    _val(cat).validate_components(
        [{"id": "b1", "component": "DefaultBox", "extraProp": 123}]
    )
    _val(cat).validate_components(
        [{"id": "b2", "component": "AllowBox", "extraProp": 456}]
    )

    # 2. Rejects extra properties when extra is forbid
    with pytest.raises(
        (ValidationError, ValueError), match="Additional properties are not allowed"
    ):
        _val(cat).validate_components(
            [{"id": "b3", "component": "ForbidBox", "extraProp": 789}]
        )


def test_additional_properties_handling_from_json():
    # 1. additionalProperties is not set explicitly (defaults to True)
    cat_default_json = {
        "catalogId": "https://a2ui.org/default",
        "components": {
            "SimpleBox": {
                "type": "object",
                "properties": {"component": {"const": "SimpleBox"}},
            }
        },
    }
    cat_default = Catalog.from_json(cat_default_json, spec_version=SPEC_VERSION)

    # Permits extra properties when additionalProperties is not set explicitly
    _val(cat_default).validate_component_properties(
        "SimpleBox", {"component": "SimpleBox", "extraProp": 123}
    )

    # 2. additionalProperties being set explicitly to true
    cat_true_json = {
        "catalogId": "https://a2ui.org/explicit-true",
        "components": {
            "FlexBox": {
                "type": "object",
                "properties": {"component": {"const": "FlexBox"}},
                "additionalProperties": True,
            }
        },
    }
    cat_true = Catalog.from_json(cat_true_json, spec_version=SPEC_VERSION)

    # Permits extra properties when additionalProperties is explicitly True
    _val(cat_true).validate_component_properties(
        "FlexBox", {"component": "FlexBox", "extraProp": 456}
    )


def test_unevaluated_properties_handling_with_models():
    class DefaultBox(BaseModel):
        component: Literal["DefaultBox"] = "DefaultBox"

    class AllowBox(BaseModel):
        model_config = {"json_schema_extra": {"unevaluatedProperties": True}}
        component: Literal["AllowBox"] = "AllowBox"

    class ForbidBox(BaseModel):
        model_config = {"json_schema_extra": {"unevaluatedProperties": False}}
        component: Literal["ForbidBox"] = "ForbidBox"

    cat = Catalog(
        catalog_id="https://a2ui.org/model-unevaluated",
        spec_version=SPEC_VERSION,
        components=[
            ModelComponentApi(DefaultBox, "DefaultBox"),
            ModelComponentApi(AllowBox, "AllowBox"),
            ModelComponentApi(ForbidBox, "ForbidBox"),
        ],
        functions=[],
    )

    # 1. Permits extra properties when unevaluatedProperties is True or default
    _val(cat).validate_components(
        [{"id": "b1", "component": "DefaultBox", "extraProp": 123}]
    )
    _val(cat).validate_components(
        [{"id": "b2", "component": "AllowBox", "extraProp": 456}]
    )

    # 2. Rejects extra properties when unevaluatedProperties is False
    with pytest.raises(
        (ValidationError, ValueError), match="Additional properties are not allowed"
    ):
        _val(cat).validate_components(
            [{"id": "b3", "component": "ForbidBox", "extraProp": 789}]
        )


def test_unevaluated_properties_handling_from_json():
    # 1. unevaluatedProperties with the default settings (omitted/true)
    cat_default_json = {
        "catalogId": "https://a2ui.org/unevaluated-default",
        "components": {
            "DefaultBox": {
                "type": "object",
                "properties": {"component": {"const": "DefaultBox"}},
            }
        },
    }
    cat_default = Catalog.from_json(cat_default_json, spec_version=SPEC_VERSION)

    # Permits extra properties when unevaluatedProperties is default (omitted/true)
    _val(cat_default).validate_component_properties(
        "DefaultBox", {"component": "DefaultBox", "extraField": 123}
    )

    # 2. unevaluatedProperties set to false
    cat_false_json = {
        "catalogId": "https://a2ui.org/unevaluated-false",
        "components": {
            "StrictBox": {
                "type": "object",
                "properties": {"component": {"const": "StrictBox"}},
                "unevaluatedProperties": False,
            }
        },
    }
    cat_false = Catalog.from_json(cat_false_json, spec_version=SPEC_VERSION)

    # Rejects extra properties when unevaluatedProperties is False
    with pytest.raises(
        ValueError, match="Unevaluated properties|Additional properties"
    ):
        _val(cat_false).validate_component_properties(
            "StrictBox", {"component": "StrictBox", "extraField": 123}
        )

    # 3. unevaluatedProperties set to true
    cat_true_json = {
        "catalogId": "https://a2ui.org/unevaluated-true",
        "components": {
            "FlexBox": {
                "type": "object",
                "properties": {"component": {"const": "FlexBox"}},
                "unevaluatedProperties": True,
            }
        },
    }
    cat_true = Catalog.from_json(cat_true_json, spec_version=SPEC_VERSION)

    # Permits extra properties when unevaluatedProperties is True
    _val(cat_true).validate_component_properties(
        "FlexBox", {"component": "FlexBox", "extraField": 456}
    )


def test_unrecognized_type_and_mismatched_properties_with_models():
    class CardComp(BaseModel):
        id: str
        component: Literal["Card"] = "Card"
        elevation: int = Field(..., description="Shadow elevation")

        model_config = {"extra": "forbid"}

    catalog = Catalog(
        catalog_id="https://a2ui.org/model-extended",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(CardComp, "Card")],
        functions=[],
    )

    # 1. Unrecognized Component Type
    with pytest.raises(ValueError, match="Unknown component type: NonExistent"):
        _val(catalog).validate_components([{"id": "c1", "component": "NonExistent"}])

    # 2. Unrecognized Properties (extra=forbid)
    with pytest.raises((ValidationError, ValueError)) as exc_info:
        _val(catalog).validate_components(
            [
                {
                    "id": "c1",
                    "component": "Card",
                    "elevation": 1,
                    "extraProperty": "garbage",
                }
            ]
        )
    assert (
        "extra_forbidden" in str(exc_info.value)
        or "extra" in str(exc_info.value).lower()
        or "additional properties" in str(exc_info.value).lower()
    )

    # 3. Mismatched Property Type (Elevation as String instead of Integer)
    with pytest.raises((ValidationError, ValueError)) as exc_info:
        _val(catalog).validate_components(
            [{"id": "c1", "component": "Card", "elevation": "high"}]
        )
    assert (
        "int_parsing" in str(exc_info.value) or "integer" in str(exc_info.value).lower()
    )


# ==============================================================================
# 3. Function Registration & Validation
# ==============================================================================


def test_function_validation_with_models():
    class RegexFunc(BaseModel):
        call: Literal["regex"] = "regex"
        args: Dict[str, Any]

    cat = Catalog(
        catalog_id="https://a2ui.org/model",
        spec_version=SPEC_VERSION,
        components=[],
        functions=[
            FunctionImplementation(
                "regex",
                "any",
                RegexFunc,
                lambda a, c=None, ab=None: None,
            )
        ],
    )

    # 1. Test validate_function Valid
    _val(cat).validate_function("regex", {"pattern": "^[A-Z]+$"})

    # 2. Test validate_function Invalid Unknown Function
    with pytest.raises(ValueError, match="Unknown function"):
        _val(cat).validate_function("unknownFunc", {})


def test_function_validation_from_json():
    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "functions": {
            "regex": {
                "type": "object",
                "properties": {
                    "call": {"const": "regex"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "pattern": {"type": "string"},
                        },
                        "required": ["value", "pattern"],
                        "additionalProperties": False,
                    },
                },
                "required": ["call", "args"],
            }
        },
    }

    catalog = Catalog.from_json(catalog_json, spec_version=SPEC_VERSION)

    # 1. Test validate_function Valid
    _val(catalog).validate_function(
        "regex", {"value": "Alice", "pattern": "^[a-zA-Z]+$"}
    )

    # 2. Test validate_function Invalid missing required 'pattern' parameter!
    with pytest.raises(ValueError, match="'pattern' is a required property"):
        _val(catalog).validate_function("regex", {"value": "Alice"})

    # 3. Test validate_function Invalid Unknown Function
    with pytest.raises(ValueError, match="Unknown function"):
        _val(catalog).validate_function("unknownFunc", {})


def test_nested_function_validation_with_models():
    class InnerComp(BaseModel):
        component: Literal["InnerComp"] = "InnerComp"
        call: str
        args: Dict[str, Any]

    class OuterComp(BaseModel):
        id: str
        component: Literal["OuterComp"] = "OuterComp"
        inner: InnerComp

    class CustomFuncArgs(BaseModel):
        param: int

    class CustomFunc(BaseModel):
        call: Literal["custom"] = "custom"
        args: CustomFuncArgs

    cat = Catalog(
        catalog_id="https://a2ui.org/model",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(OuterComp, "OuterComp")],
        functions=[
            FunctionImplementation(
                "custom",
                "any",
                CustomFunc,
                lambda a, c=None, ab=None: None,
            )
        ],
    )

    # 1. Test validate_components Valid with nested function call
    _val(cat).validate_components(
        [
            {
                "id": "root",
                "component": "OuterComp",
                "inner": {
                    "call": "custom",
                    "args": {"param": 123},
                },
            }
        ]
    )

    # 2. Rejects unrecognized nested catalog function call
    with pytest.raises(ValueError, match="Unknown function: unrecognizedFunctionName"):
        _val(cat).validate_components(
            [
                {
                    "id": "root",
                    "component": "OuterComp",
                    "inner": {"call": "unrecognizedFunctionName", "args": {}},
                }
            ]
        )

    # 3. Rejects mismatched parameters inside nested function calls
    with pytest.raises(ValueError, match="Invalid function call 'custom'"):
        _val(cat).validate_components(
            [
                {
                    "id": "root",
                    "component": "OuterComp",
                    "inner": {
                        "call": "custom",
                        "args": {"param": "not-an-int"},
                    },
                }
            ]
        )


def test_nested_function_validation_from_json():
    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "components": {
            "Text": {
                "type": "object",
                "properties": {
                    "text": {
                        "oneOf": [
                            {"type": "string"},
                            {
                                "type": "object",
                                "properties": {
                                    "call": {"type": "string"},
                                    "args": {"type": "object"},
                                },
                                "required": ["call"],
                            },
                        ]
                    }
                },
            }
        },
        "functions": {
            "regex": {
                "type": "object",
                "properties": {
                    "call": {"const": "regex"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "pattern": {"type": "string"},
                        },
                        "required": ["value", "pattern"],
                        "additionalProperties": False,
                    },
                },
                "required": ["call", "args"],
            }
        },
    }

    catalog = Catalog.from_json(catalog_json, spec_version=SPEC_VERSION)

    # 1. Rejects unrecognized nested catalog function call
    with pytest.raises(ValueError, match="Unknown function: unrecognizedFunctionName"):
        _val(catalog).validate_components(
            [
                {
                    "id": "root",
                    "component": "Text",
                    "text": {"call": "unrecognizedFunctionName", "args": {}},
                }
            ]
        )

    # 2. Rejects mismatched parameters inside nested function calls
    with pytest.raises(
        ValueError,
        match="Invalid function call 'regex'|pattern|Additional properties",
    ):
        _val(catalog).validate_components(
            [
                {
                    "id": "root",
                    "component": "Text",
                    "text": {
                        "call": "regex",
                        "args": {"value": "Alice", "unmapped": "garbage"},
                    },
                }
            ]
        )


# ==============================================================================
# 4. Theme Schema & Model Validation
# ==============================================================================


def test_theme_validation_with_models():
    class TestTheme(BaseModel):
        primary: str = Field(..., pattern="^#[0-9A-F]{6}$")

    cat = Catalog(
        catalog_id="https://a2ui.org/model",
        spec_version=SPEC_VERSION,
        components=[],
        functions=[],
        theme_schema=TestTheme.model_json_schema(),
    )

    # 1. Test Valid Theme
    _val(cat).validate_theme({"primary": "#00FF00"})

    # 2. Test Invalid Theme raises ValidationError
    with pytest.raises((ValidationError, ValueError)) as exc_info:
        _val(cat).validate_theme({"primary": "blue"})
    error_msg = str(exc_info.value)
    assert "primary" in error_msg
    assert (
        "pattern" in error_msg.lower()
        or "string" in error_msg.lower()
        or "does not match" in error_msg.lower()
    )


def test_theme_validation_from_json():
    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "theme": {
            "type": "object",
            "properties": {
                "primaryColor": {
                    "type": "string",
                    "pattern": "^#[0-9a-fA-F]{6}$",
                }
            },
            "additionalProperties": False,
        },
    }

    catalog = Catalog.from_json(catalog_json, spec_version=SPEC_VERSION)

    # 1. Test Valid Theme
    _val(catalog).validate_theme({"primaryColor": "#00FF00"})

    # 2. Test Invalid Theme fails on incorrect color hex code pattern
    with pytest.raises(
        ValueError,
        match="is not valid under any of the given schemas|does not match",
    ):
        _val(catalog).validate_theme({"primaryColor": "red"})


# ==============================================================================
# 5. Topological Reference Field Extraction (extract_ref_fields)
# ==============================================================================


def test_extract_ref_fields_custom_models():
    class CustomLayoutComp(BaseModel):
        id: str
        component: Literal["CustomLayout"] = "CustomLayout"
        primaryPtr: ComponentId = Field(..., description="Custom single pointer")
        secondaryPtrs: List[ComponentId] = Field(
            ..., description="Custom list pointers"
        )

    catalog = Catalog(
        catalog_id="https://a2ui.org/custom",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(CustomLayoutComp, "CustomLayout")],
        functions=[],
    )

    refs = _val(catalog).extract_ref_fields()
    assert "CustomLayout" in refs
    assert "primaryPtr" in refs["CustomLayout"][0]
    assert "secondaryPtrs" in refs["CustomLayout"][1]


def test_extract_ref_fields_dynamic_json():
    schema = {
        "catalogId": "https://a2ui.org/json",
        "components": {
            "AdvancedLayout": {
                "type": "object",
                "properties": {
                    "component": {"const": "AdvancedLayout"},
                    # 1. Direct $ref to ComponentId (custom property name)
                    "customChild": {"$ref": "common_types.json#/$defs/ComponentId"},
                    # 2. Direct $ref to ChildList (custom property name)
                    "customList": {"$ref": "common_types.json#/$defs/ChildList"},
                    # 3. Nested $ref to ComponentId inside allOf
                    "nestedChild": {"allOf": [{"$ref": "#/$defs/ComponentId"}]},
                    # 4. Nested $ref to ChildList inside oneOf
                    "nestedList": {"oneOf": [{"$ref": "#/$defs/ChildList"}]},
                    # 5. Non-matching regular scalar property
                    "regularProp": {"type": "string"},
                },
            }
        },
    }

    cat = Catalog.from_json(schema, spec_version=SPEC_VERSION)
    refs = _val(cat).extract_ref_fields()

    assert "AdvancedLayout" in refs
    single, list_refs = refs["AdvancedLayout"]

    assert "customChild" in single
    assert "nestedChild" in single
    assert "regularProp" not in single

    assert "customList" in list_refs
    assert "nestedList" in list_refs
    assert "regularProp" not in list_refs


def test_extract_ref_fields_tabs_json():
    schema = {
        "catalogId": "https://a2ui.org/json",
        "components": {
            "Tabs": {
                "type": "object",
                "properties": {
                    "component": {"const": "Tabs"},
                    "tabs": {
                        "type": "array",
                        "description": "An array of objects, where each object defines a tab with a title and a child component.",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {
                                    "$ref": "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString"
                                },
                                "child": {
                                    "$ref": "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId",
                                    "description": "The ID of the child component. Do NOT define the component inline.",
                                },
                            },
                            "required": ["title", "child"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["component", "tabs"],
            }
        },
    }

    cat = Catalog.from_json(schema, spec_version=SPEC_VERSION)
    refs = _val(cat).extract_ref_fields()

    assert "Tabs" in refs
    single, list_refs = refs["Tabs"]

    assert "tabs" in list_refs
    assert "child" not in single


def test_extract_ref_fields_empty_json():
    schema = {
        "catalogId": "https://a2ui.org/json",
        "components": {"EmptyNode": {"type": "object", "properties": {}}},
    }
    cat = Catalog.from_json(schema, spec_version=SPEC_VERSION)
    refs = _val(cat).extract_ref_fields()
    assert refs == {}


def test_extract_ref_fields_common_types_resolution():
    common_types = {
        "$id": "https://a2ui.org/specification/v0_9/common_types.json",
        "$defs": {"ColorHex": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}},
    }

    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "components": {
            "Box": {
                "type": "object",
                "properties": {
                    "component": {"const": "Box"},
                    "color": {"$ref": "common_types.json#/$defs/ColorHex"},
                },
                "required": ["color"],
                "additionalProperties": False,
            }
        },
    }

    catalog = Catalog.from_json(
        catalog_json,
        spec_version=SPEC_VERSION,
    )

    # 1. Test Valid $ref against common_types.json
    _val(catalog, common_types_schema=common_types).validate_components(
        [{"id": "b1", "component": "Box", "color": "#00FF00"}]
    )

    # 2. Test Invalid Pattern in $ref
    with pytest.raises(ValueError, match="does not match"):
        _val(catalog, common_types_schema=common_types).validate_components(
            [{"id": "b1", "component": "Box", "color": "red"}]
        )


def test_extract_ref_fields_tabs_model():
    class CustomTab(BaseModel):
        title: str
        child: ComponentId

    class CustomTabsComponent(BaseModel):
        component: Literal["CustomTabs"] = "CustomTabs"
        tabs: List[CustomTab]

    catalog = Catalog(
        catalog_id="https://a2ui.org/tabs-test",
        spec_version=SPEC_VERSION,
        components=[ModelComponentApi(CustomTabsComponent, "CustomTabs")],
        functions=[],
    )
    ref_map = _val(catalog).extract_ref_fields()
    assert "CustomTabs" in ref_map
    single_refs, list_refs = ref_map["CustomTabs"]
    assert "tabs" in list_refs


def test_extract_ref_fields_custom_tabs_json():
    catalog_schema = {
        "components": {
            "CustomTabs": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomTabs"},
                    "tabs": {
                        "type": "array",
                        "items": {"$ref": "#/$defs/CustomTab"},
                    },
                },
                "$defs": {
                    "ComponentId": {"type": "string"},
                    "CustomTab": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "child": {"$ref": "#/$defs/ComponentId"},
                        },
                    },
                },
            }
        },
    }
    catalog = Catalog.from_json(
        catalog_schema,
        spec_version=SPEC_VERSION,
        catalog_id="https://a2ui.org/json-tabs",
    )
    ref_map = _val(catalog).extract_ref_fields()
    assert "CustomTabs" in ref_map
    single_refs, list_refs = ref_map["CustomTabs"]
    assert "tabs" in list_refs


def test_extract_ref_fields_basic_spec_tabs():
    import json
    from pathlib import Path

    repo_root = Path(__file__).parent.parent.parent.parent.parent
    catalog_path = (
        repo_root / "specification" / "v0_9" / "catalogs" / "basic" / "catalog.json"
    )
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog_schema = json.load(f)

    catalog = Catalog.from_json(
        catalog_schema,
        spec_version=SPEC_VERSION,
        catalog_id="https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    )
    ref_map = _val(catalog).extract_ref_fields()
    assert "Tabs" in ref_map
    single_refs, list_refs = ref_map["Tabs"]
    assert "tabs" in list_refs


# ==============================================================================
# 6. Mixed Spec Interoperability
# ==============================================================================


def test_seamless_mixed_catalogs():
    from a2ui.core.catalog import Catalog, ComponentApi, ModelComponentApi

    # Pydantic model for Component A
    class ModelCompA(BaseModel):
        id: str
        component: Literal["CompA"] = "CompA"
        message: str

    # Raw JSON schema dict for Component B
    dict_comp_b = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "component": {"const": "CompB"},
            "count": {"type": "integer"},
        },
        "required": ["id", "component", "count"],
        "additionalProperties": False,
    }

    # Instantiate single unified Catalog containing both
    catalog = Catalog(
        spec_version=SPEC_VERSION,
        catalog_id="https://a2ui.org/mixed-test",
        components=[
            ModelComponentApi(ModelCompA),
            ComponentApi("CompB", dict_comp_b),
        ],
        functions=[],
    )

    validator = CatalogSchemaValidator(catalog)

    # 1. Validate payload conforming to ModelComponentApi
    validator.validate_components(
        [{"id": "a1", "component": "CompA", "message": "hello"}]
    )

    # 2. Validate payload conforming to ComponentApi
    validator.validate_components([{"id": "b1", "component": "CompB", "count": 42}])

    # 3. Mismatched property in ModelComponentApi raises error
    with pytest.raises((ValidationError, ValueError)):
        validator.validate_components(
            [{"id": "a2", "component": "CompA"}]
        )  # missing message

    # 4. Mismatched property in ComponentApi raises error
    with pytest.raises((ValidationError, ValueError)):
        validator.validate_components(
            [{"id": "b2", "component": "CompB", "count": "not-an-int"}]
        )


# ==============================================================================
# 7. BasicCatalog Conformance
# ==============================================================================


def test_basic_catalog_initialization():
    catalog = BasicCatalog()
    assert catalog.spec_version == SPEC_VERSION
    assert "https://a2ui.org/specification" in catalog.catalog_id


def test_basic_catalog_validate_components():
    catalog = BasicCatalog()

    # Valid component payload
    text_comp = {
        "id": "t1",
        "component": "Text",
        "text": "Hello World",
        "variant": "body",
    }
    _val(catalog).validate_components([text_comp])

    # Invalid component payload (wrong type for text)
    invalid_text_comp = {
        "id": "t2",
        "component": "Text",
        "text": 12345,  # Should be string / data binding
    }
    with pytest.raises((ValidationError, ValueError)):
        _val(catalog).validate_components([invalid_text_comp])


def test_basic_catalog_validate_theme():
    catalog = BasicCatalog()

    # 1. Test Valid Theme
    _val(catalog).validate_theme({"primaryColor": "#00BFFF"})

    # 2. Test Invalid Theme raises ValidationError
    with pytest.raises((ValidationError, ValueError)):
        _val(catalog).validate_theme({"primaryColor": "invalid-color-name"})


def test_basic_catalog_validate_functions():
    catalog = BasicCatalog()

    # 1. Test validate_function Valid
    # Valid call: formatString takes named parameter 'value'
    _val(catalog).validate_function("formatString", {"value": "Hello ${/username}"})

    # 2. Test validate_function Invalid missing required 'value' parameter!
    with pytest.raises((ValidationError, ValueError)):
        _val(catalog).validate_function("formatString", {"invalid_param": "value"})

    # 3. Test validate_function Invalid Unknown Function
    with pytest.raises(ValueError, match="Unknown function"):
        _val(catalog).validate_function("unknownFunc", {})


def test_basic_catalog_nested_function_validation():
    catalog = BasicCatalog()

    # 1. Rejects unrecognized nested catalog function call
    with pytest.raises(ValueError, match="Unknown function: unrecognizedFunctionName"):
        _val(catalog).validate_components(
            [
                {
                    "id": "root",
                    "component": "Text",
                    "text": {"call": "unrecognizedFunctionName", "args": {}},
                }
            ]
        )

    # 2. Rejects mismatched parameters for recognized nested function call
    # formatNumber expects decimal parameter to be a float/number or binding, not a boolean/string!
    with pytest.raises(
        ValueError, match="Invalid function call 'formatNumber'|decimal"
    ):
        _val(catalog).validate_components(
            [
                {
                    "id": "root",
                    "component": "Text",
                    "text": {
                        "call": "formatNumber",
                        "args": {
                            "value": 123.45,
                            "decimals": "invalid-string-instead-of-number",
                        },
                    },
                }
            ]
        )


def test_basic_catalog_extract_ref_fields():
    catalog = BasicCatalog()
    ref_map = _val(catalog).extract_ref_fields()

    # Check that Button has 'child' as single ref
    assert "Button" in ref_map
    single_refs, list_refs = ref_map["Button"]
    assert "child" in single_refs

    # Check that Column has 'children' as list ref
    assert "Column" in ref_map
    col_single, col_list = ref_map["Column"]
    assert "children" in col_list


def test_basic_catalog_tabs_ref():
    catalog = BasicCatalog()
    ref_map = _val(catalog).extract_ref_fields()
    assert "Tabs" in ref_map
    single_refs, list_refs = ref_map["Tabs"]
    assert "tabs" in list_refs

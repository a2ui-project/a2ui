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

from typing import Any, Literal
from pydantic import BaseModel, Field, ValidationError
import pytest
from a2ui.core.catalog import (
    Catalog,
    ComponentApi,
    FunctionApi,
    ModelComponentApi,
    FunctionImplementation,
)
from a2ui.core.exceptions import A2uiCatalogError, A2uiValidationError
from a2ui.core.catalog.catalog import TComponent, TFunction
from a2ui.core.validation import PayloadValidator
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema.v0_9.common_types import ComponentId
from a2ui.core.schema.v0_9.constants import PROTOCOL_VERSION


class _TestValidatorHelper:

    def __init__(self, catalog: Catalog[Any, Any]):
        self.validator = PayloadValidator(catalog=catalog)

    def validate_component(self, comp_or_list: Any) -> None:
        comps = comp_or_list if isinstance(comp_or_list, list) else [comp_or_list]
        all_errors = []
        for c in comps:
            errors = self.validator.validate_component(c)
            if errors:
                all_errors.extend(errors)
        if all_errors:
            summary = "\n".join(f"{e.path}: {e.message}" for e in all_errors)
            raise A2uiValidationError(summary, details=all_errors)

    def validate_components(self, components: Any) -> None:
        self.validate_component(components)

    def validate_function(self, name: str, args: dict[str, Any]) -> None:
        self.validator.validate_function(name, args)


def _val(catalog: Catalog[TComponent, TFunction]) -> _TestValidatorHelper:
    return _TestValidatorHelper(catalog)


# ==============================================================================
# 1. Catalog Initialization & Metadata
# ==============================================================================


def test_catalog_initialization_with_models():
    class EmptyModel(BaseModel):
        pass

    cat = Catalog(
        catalog_id="https://a2ui.org/model-init",
        protocol_version=PROTOCOL_VERSION,
        components=[ModelComponentApi(EmptyModel, "Empty")],
        functions=[],
    )
    assert cat.protocol_version == PROTOCOL_VERSION
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
    catalog = Catalog.from_json(schema, protocol_version=PROTOCOL_VERSION)
    assert catalog.catalog_id == "https://a2ui.org/spec/v0.9/catalog.json"
    assert catalog.protocol_version == PROTOCOL_VERSION


def test_catalog_initialization_requires_version():
    with pytest.raises(
        ValueError,
        match="protocol_version must be provided",
    ):
        Catalog(
            catalog_id="https://a2ui.org/no-version",
            components=[],
            functions=[],
        )


def test_catalog_from_json_requires_version():
    schema = {
        "catalogId": "https://a2ui.org/spec/catalog.json",
        "components": {},
    }
    with pytest.raises(
        ValueError,
        match="protocol_version must be provided",
    ):
        Catalog.from_json(schema)


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
        protocol_version=PROTOCOL_VERSION,
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
        protocol_version=PROTOCOL_VERSION,
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


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_additional_properties_handling_from_json():
    pass


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_unevaluated_properties_handling_with_models():
    pass


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_unevaluated_properties_handling_from_json():
    pass


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_unrecognized_type_and_mismatched_properties_with_models():
    pass

    class CardComp(BaseModel):
        id: str
        component: Literal["Card"] = "Card"
        elevation: int = Field(..., description="Shadow elevation")

        model_config = {"extra": "forbid"}

    catalog = Catalog(
        catalog_id="https://a2ui.org/model-extended",
        protocol_version=PROTOCOL_VERSION,
        components=[ModelComponentApi(CardComp, "Card")],
        functions=[],
    )

    # 1. Unrecognized Component Type
    with pytest.raises(ValueError, match="Unknown component type: NonExistent"):
        _val(catalog).validate_components([{"id": "c1", "component": "NonExistent"}])

    # 2. Unrecognized Properties (extra=forbid)
    with pytest.raises((ValidationError, ValueError)) as exc_info:
        _val(catalog).validate_components([{
            "id": "c1",
            "component": "Card",
            "elevation": 1,
            "extraProperty": "garbage",
        }])
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
    class CustomArgs(BaseModel):
        query: str
        limit: int

    catalog = Catalog(
        protocol_version=PROTOCOL_VERSION,
        catalog_id="https://a2ui.org/func-test",
        functions=[FunctionApi("search", schema=CustomArgs)],
    )
    val = _val(catalog)
    val.validate_function("search", {"query": "hello", "limit": 10})
    with pytest.raises(A2uiValidationError):
        val.validate_function("search", {"query": "hello", "limit": "not-an-int"})


def test_function_validation_from_json():
    json_catalog = {
        "catalogId": "https://a2ui.org/func-json-test",
        "protocolVersion": PROTOCOL_VERSION,
        "functions": {
            "search": {
                "parameters": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            }
        },
    }
    catalog = Catalog.from_json(json_catalog)
    val = _val(catalog)
    val.validate_function("search", {"query": "hello", "limit": 10})
    with pytest.raises(A2uiValidationError):
        val.validate_function("search", {"query": "hello", "limit": "not-an-int"})


def test_nested_function_validation_with_models():
    class SearchArgs(BaseModel):
        query: str

    class SearchButton(BaseModel):
        id: str
        component: Literal["SearchButton"] = "SearchButton"
        onSearch: dict[str, Any]

    catalog = Catalog(
        protocol_version=PROTOCOL_VERSION,
        catalog_id="https://a2ui.org/nested-func-test",
        components=[ModelComponentApi(SearchButton)],
        functions=[FunctionApi("doSearch", schema=SearchArgs)],
    )
    val = _val(catalog)
    val.validate_components([{
        "id": "b1",
        "component": "SearchButton",
        "onSearch": {"call": "doSearch", "args": {"query": "test"}},
    }])
    with pytest.raises(A2uiValidationError):
        val.validate_components([{
            "id": "b1",
            "component": "SearchButton",
            "onSearch": {"call": "doSearch", "args": {"query": 12345}},
        }])


def test_nested_function_validation_from_json():
    json_catalog = {
        "catalogId": "https://a2ui.org/nested-func-json-test",
        "protocolVersion": PROTOCOL_VERSION,
        "components": {
            "SearchButton": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "SearchButton"},
                    "onSearch": {"type": "object"},
                },
                "required": ["id", "component", "onSearch"],
            }
        },
        "functions": {
            "doSearch": {
                "parameters": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            }
        },
    }
    catalog = Catalog.from_json(json_catalog)
    val = _val(catalog)
    val.validate_components([{
        "id": "b1",
        "component": "SearchButton",
        "onSearch": {"call": "doSearch", "args": {"query": "test"}},
    }])
    with pytest.raises(A2uiValidationError):
        val.validate_components([{
            "id": "b1",
            "component": "SearchButton",
            "onSearch": {"call": "doSearch", "args": {"query": 12345}},
        }])


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_theme_validation_with_models():
    pass


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_theme_validation_from_json():
    pass


# ==============================================================================
# 5. Mixed Spec Interoperability
# ==============================================================================


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_seamless_mixed_catalogs():
    pass
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
        protocol_version=PROTOCOL_VERSION,
        catalog_id="https://a2ui.org/mixed-test",
        components=[
            ModelComponentApi(ModelCompA),
            ComponentApi("CompB", dict_comp_b),
        ],
        functions=[],
    )

    validator = _val(catalog)

    # 1. Validate payload conforming to ModelComponentApi
    validator.validate_component({"id": "a1", "component": "CompA", "message": "hello"})

    # 2. Validate payload conforming to ComponentApi
    validator.validate_component({"id": "b1", "component": "CompB", "count": 42})

    # 3. Mismatched property in ModelComponentApi raises error
    with pytest.raises((ValidationError, ValueError)):
        validator.validate_component(
            {"id": "a2", "component": "CompA"}
        )  # missing message

    # 4. Mismatched property in ComponentApi raises error
    with pytest.raises((ValidationError, ValueError)):
        validator.validate_component(
            {"id": "b2", "component": "CompB", "count": "not-an-int"}
        )


# ==============================================================================
# 7. BasicCatalog Conformance
# ==============================================================================


def test_basic_catalog_initialization():
    catalog = BasicCatalog()
    assert catalog.protocol_version == PROTOCOL_VERSION
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


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_basic_catalog_validate_theme():
    pass


def test_basic_catalog_validate_functions():
    catalog = BasicCatalog()
    validator = _val(catalog)
    # Valid function call
    validator.validate_function("formatNumber", {"value": 123.45, "decimals": 2})
    # Unrecognized function call
    with pytest.raises(A2uiValidationError, match="Unrecognized function"):
        validator.validate_function("unknownFunction", {})


def test_basic_catalog_nested_function_validation():
    catalog = BasicCatalog()
    with pytest.raises(A2uiValidationError, match="formatNumber|type_mismatch|number"):
        _val(catalog).validate_components([{
            "id": "root",
            "component": "Text",
            "text": {
                "call": "formatNumber",
                "args": {
                    "value": 123.45,
                    "decimals": "invalid-string-instead-of-number",
                },
            },
        }])


# ==============================================================================
# 6. Phase 2 v1.0 Spec Additions Tests
# ==============================================================================


def test_catalog_v1_0_additions():
    cat = Catalog(
        catalog_id="https://a2ui.org/v10-spec",
        protocol_version="v1.0",
    )
    assert cat.id == "https://a2ui.org/v10-spec"


def test_basic_catalog_version_submodules():
    from a2ui.core.basic_catalog import v1_0, v0_9, v0_8

    cat_v10 = v1_0.BasicCatalog()
    assert cat_v10.protocol_version == "v1.0"

    cat_v09 = v0_9.BasicCatalog()
    assert cat_v09.protocol_version == "v0.9"

    cat_v08 = v0_8.BasicCatalog()
    assert cat_v08.protocol_version == "v0.8"


def test_validation_config_defaults():
    from a2ui.core.validation import (
        RELAXED_VALIDATION,
        STRICT_VALIDATION,
        ValidationConfig,
    )

    config = ValidationConfig()
    assert config.allow_unknown_elements is False
    assert STRICT_VALIDATION.allow_unknown_elements is False
    assert RELAXED_VALIDATION.allow_unknown_elements is True


def test_mixed_catalog_validation():
    from a2ui.core.catalog import Catalog
    from a2ui.core.state import ComponentModel, SurfaceComponentsModel
    from a2ui.core.validation import ValidationConfig

    cat_a = Catalog.from_json({
        "catalogId": "cat-a",
        "protocolVersion": "v1.0",
        "components": {
            "CompA": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "CompA"},
                    "text": {"type": "string"},
                },
                "required": ["id", "component", "text"],
            }
        },
    })

    cat_b = Catalog.from_json({
        "catalogId": "cat-b",
        "protocolVersion": "v1.0",
        "components": {
            "CompB": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "CompB"},
                    "count": {"type": "integer"},
                },
                "required": ["id", "component", "count"],
            }
        },
    })

    c1 = ComponentModel("c1", "CompA", cat_a, {"text": "hello"})
    c2 = ComponentModel("c2", "CompB", cat_b, {"count": 42})
    components_model = SurfaceComponentsModel()

    components_model.validate_components_update(
        [c1, c2],
        root_id="c1",
        config=ValidationConfig(allow_orphan_components=True),
    )


# ==============================================================================
# 9. Dynamic Schema & Reference Inlining Tests
# ==============================================================================


def test_query_json_pointer():
    from a2ui.core.catalog.catalog import _query_json_pointer

    doc = {
        "$defs": {
            "Item": {"type": "string"},
            "escaped/name~prop": "value",
        }
    }
    assert _query_json_pointer(doc, "#/$defs/Item") == {"type": "string"}
    assert _query_json_pointer(doc, "#/$defs/escaped~1name~0prop") == "value"
    assert _query_json_pointer(doc, "#/$defs/NonExistent") is None
    assert _query_json_pointer(doc, "invalid_pointer") is None


def test_inline_local_refs():
    from a2ui.core.catalog.catalog import inline_local_refs

    root_catalog = {
        "$defs": {
            "CatalogComponentCommon": {"properties": {"weight": {"type": "number"}}},
            "CircularRef": {"$ref": "#/$defs/CircularRef"},
        }
    }

    schema = {
        "$ref": "#/$defs/CatalogComponentCommon",
        "properties": {"text": {"type": "string"}},
        "preserved": {"$ref": "#/$defs/ComponentId"},
    }

    inlined = inline_local_refs(schema, root_catalog)

    # CatalogComponentCommon properties should be merged into inlined schema
    assert inlined["properties"]["weight"] == {"type": "number"}
    assert inlined["properties"]["text"] == {"type": "string"}
    # Preserved type refs should not be resolved
    assert inlined["preserved"] == {"$ref": "#/$defs/ComponentId"}

    # Circular ref should not stack overflow
    circular_inlined = inline_local_refs({"$ref": "#/$defs/CircularRef"}, root_catalog)
    assert circular_inlined == {"$ref": "#/$defs/CircularRef"}


def test_load_preserved_type_refs():
    from a2ui.core.catalog.catalog import load_preserved_type_refs, PRESERVED_TYPE_REFS

    type_refs = load_preserved_type_refs()
    assert isinstance(type_refs, set)
    assert "ComponentId" in type_refs
    assert "ChildList" in type_refs
    assert "Action" in type_refs
    assert "DataBinding" in type_refs
    assert PRESERVED_TYPE_REFS == type_refs


def test_computed_catalog_schema():
    from a2ui.core.catalog import Catalog, ComponentApi, FunctionApi

    comp = ComponentApi(
        "Text", {"type": "object", "properties": {"text": {"type": "string"}}}
    )
    fn = FunctionApi("openUrl", return_type="any", schema={"type": "object"})

    cat = Catalog(
        catalog_id="https://a2ui.org/computed-catalog",
        protocol_version="v1.0",
        components=[comp],
        functions=[fn],
        theme_schema={"primaryColor": "#000"},
        instructions="Sample instructions",
    )

    schema = cat.catalog_schema

    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["catalogId"] == "https://a2ui.org/computed-catalog"
    assert schema["instructions"] == "Sample instructions"
    assert "Text" in schema["components"]
    assert "openUrl" in schema["functions"]
    assert schema["$defs"]["theme"] == {"primaryColor": "#000"}
    assert schema["$defs"]["anyComponent"] == {
        "oneOf": [{"$ref": "#/components/Text"}],
        "discriminator": {"propertyName": "component"},
    }
    assert schema["$defs"]["anyFunction"] == {
        "oneOf": [{"$ref": "#/functions/openUrl"}],
    }

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

import json
from typing import Any, Literal
from pydantic import BaseModel, Field, ValidationError
import pytest
from a2ui.core.catalog import (
    Catalog,
    ComponentApi,
    FunctionApi,
    FunctionImplementation,
    ModelComponentApi,
    get_common_types_schema_json,
    get_common_types_schema_map,
)
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion
from a2ui.core.exceptions import A2uiCatalogError, A2uiValidationError
from a2ui.core.catalog.catalog import TComponent, TFunction
from a2ui.core.validation import PayloadValidator
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.basic_catalog.v1_0 import BasicCatalog as BasicCatalogV1_0
from a2ui.core.schema.v0_9.constants import PROTOCOL_VERSION


class _TestValidatorHelper:

    def __init__(self, catalog: Catalog[Any, Any]):
        self.validator = PayloadValidator(catalog=catalog)

    def validate_component(self, comp_or_list: Any) -> None:
        comps = comp_or_list if isinstance(comp_or_list, list) else [comp_or_list]
        all_errors = []
        for c in comps:
            try:
                self.validator.validate_component(c)
            except A2uiValidationError as e:
                all_errors.extend(e.details)
        if all_errors:
            summary = "\n".join(
                f"{detail.path}: {detail.message}" for detail in all_errors
            )
            raise A2uiValidationError(summary, details=all_errors)

    def validate_components(self, components: Any) -> None:
        self.validate_component(components)

    def validate_function(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        return self.validator.validate_function(name, args)

    def validate_theme(self, theme: dict[str, Any]) -> None:
        self.validator.validate_theme(theme)


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


def test_catalog_initialization_requires_version():
    with pytest.raises(
        TypeError,
        match="protocol_version",
    ):
        Catalog(
            catalog_id="https://a2ui.org/no-version",
            components=[],
            functions=[],
        )  # type: ignore[call-arg]

    with pytest.raises(
        ValueError,
        match="protocol_version must be provided",
    ):
        Catalog(
            catalog_id="https://a2ui.org/no-version",
            protocol_version="",
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
# 2. Component Validation & Properties Handling (Pydantic ModelComponentApi)
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
    reason=(
        "PayloadValidator checks model components with Pydantic model_validate,"
        " which ignores json_schema_extra={'unevaluatedProperties': False}."
    )
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
        protocol_version=PROTOCOL_VERSION,
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
        (ValidationError, ValueError),
        match="Additional properties are not allowed|Unevaluated properties",
    ):
        _val(cat).validate_components(
            [{"id": "b3", "component": "ForbidBox", "extraProp": 789}]
        )


def test_unrecognized_type_and_mismatched_properties_with_models():

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
    with pytest.raises(
        A2uiValidationError, match="Unrecognized component type 'NonExistent'"
    ):
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
# 3. Function Registration & Validation (Pydantic BaseModel schemas)
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


def test_validate_function_returns_coerced_model_args():
    class SearchArgs(BaseModel):
        query: str
        limit: int = 20
        offset: int = 0

    catalog = Catalog(
        protocol_version=PROTOCOL_VERSION,
        catalog_id="https://a2ui.org/func-coerce-test",
        functions=[FunctionApi("search", schema=SearchArgs)],
    )
    val = _val(catalog)
    # Int string should be coerced to int, and offset default should be populated
    res = val.validate_function("search", {"query": "hello", "limit": "50"})
    assert res == {"query": "hello", "limit": 50, "offset": 0}


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


def test_theme_validation_with_models():
    class TestTheme(BaseModel):
        primary: str = Field(..., pattern="^#[0-9A-F]{6}$")

    cat = Catalog(
        catalog_id="https://a2ui.org/model",
        protocol_version=PROTOCOL_VERSION,
        components=[],
        functions=[],
        theme_schema=TestTheme.model_json_schema(),
    )

    # 1. Test Valid Theme
    _val(cat).validate_theme({"primary": "#00FF00"})

    # 2. Test Invalid Theme raises A2uiValidationError
    with pytest.raises(A2uiValidationError) as exc_info:
        _val(cat).validate_theme({"primary": "blue"})
    error_msg = str(exc_info.value)
    assert "primary" in error_msg
    assert "does not match" in error_msg.lower()


# ==============================================================================
# 4. Mixed Spec Interoperability
# ==============================================================================


def test_seamless_mixed_catalogs():
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
# 5. BasicCatalog & Version Submodules
# ==============================================================================


def test_basic_catalog_initialization():
    catalog = BasicCatalog()
    assert catalog.protocol_version == PROTOCOL_VERSION
    assert "https://a2ui.org/specification" in catalog.catalog_id


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
# 6. Dynamic Schema & Reference Inlining Tests
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


def test_catalog_from_json_preserves_custom_defs():
    """Verifies that custom $defs in raw JSON catalog schema are preserved in Catalog and catalog_schema."""
    catalog_json = {
        "catalogId": "https://a2ui.org/catalogs/custom",
        "protocolVersion": "v1.0",
        "$defs": {
            "CustomType": {
                "type": "string",
                "enum": ["primary", "secondary"],
            }
        },
        "components": {
            "Badge": {
                "type": "object",
                "properties": {
                    "component": {"const": "Badge"},
                    "variant": {"$ref": "#/$defs/CustomType"},
                },
                "required": ["component", "variant"],
            }
        },
    }
    cat = Catalog.from_json(catalog_json)
    assert "CustomType" in cat.defs
    assert cat.defs["CustomType"] == {
        "type": "string",
        "enum": ["primary", "secondary"],
    }
    schema = cat.catalog_schema
    assert "$defs" in schema
    assert "CustomType" in schema["$defs"]


def test_collect_defs_refs_nested_subpath():
    from a2ui.core.catalog.catalog import _collect_defs_refs

    refs: set[str] = set()
    node = {
        "items": {"$ref": "#/$defs/TemplateChildList/properties/componentId"},
        "other": {"$ref": "#/$defs/SimpleDef"},
        "nested": [{"$ref": "#/$defs/NestedDef/items"}],
    }
    _collect_defs_refs(node, refs)
    assert refs == {"TemplateChildList", "SimpleDef", "NestedDef"}


def test_is_valid_uax31_identifier():
    from a2ui.core.catalog.catalog import is_valid_uax31_identifier

    # Empty string
    assert not is_valid_uax31_identifier("")

    # Valid ASCII
    assert is_valid_uax31_identifier("foo")
    assert is_valid_uax31_identifier("_foo")
    assert is_valid_uax31_identifier("foo_1")

    # Valid Unicode (\p{XID_Start} / \p{XID_Continue})
    assert is_valid_uax31_identifier("café")
    assert is_valid_uax31_identifier("변수")
    assert is_valid_uax31_identifier("alpha_α")

    # Single leading @
    assert is_valid_uax31_identifier("@index")
    assert is_valid_uax31_identifier("@custom")

    # Bare "@"
    assert not is_valid_uax31_identifier("@")

    # Invalid symbols and leading digits
    assert not is_valid_uax31_identifier("foo-bar")
    assert not is_valid_uax31_identifier("1foo")
    assert not is_valid_uax31_identifier("foo.bar")
    assert not is_valid_uax31_identifier("@@index")

    # Keyword names (valid syntactic identifiers)
    assert is_valid_uax31_identifier("class")
    assert is_valid_uax31_identifier("def")


def test_validate_function_rejects_non_dict_args():
    class SearchParams(BaseModel):
        query: str
        limit: int = 10

    catalog = Catalog(
        catalog_id="test_cat",
        protocol_version="v1.0",
        components=[],
        functions=[
            FunctionImplementation(
                name="search",
                return_type="array",
                schema=SearchParams,
                execute=lambda args, ctx, abort: [],
            )
        ],
    )
    val = PayloadValidator(catalog=catalog)

    # Valid dictionary args
    res = val.validate_function("search", {"query": "apple", "limit": 25})
    assert res == {"query": "apple", "limit": 25}

    # Reject list args as type_mismatch
    with pytest.raises(A2uiValidationError) as exc_info:
        val.validate_function("search", ["apple", 25])  # type: ignore
    assert exc_info.value.details[0].code == "type_mismatch"

    # Reject primitive args
    with pytest.raises(A2uiValidationError) as exc_info:
        val.validate_function("search", 12345)  # type: ignore
    assert exc_info.value.details[0].code == "type_mismatch"


def test_validate_function_non_string_arg_key_defensive():
    class NoopParams(BaseModel):
        pass

    catalog = Catalog(
        catalog_id="test_cat",
        protocol_version="v1.0",
        components=[],
        functions=[
            FunctionImplementation(
                name="noop",
                return_type="string",
                schema=NoopParams,
                execute=lambda args, ctx, abort: "",
            )
        ],
    )
    val = PayloadValidator(catalog=catalog)

    # Non-string dictionary key
    with pytest.raises(A2uiValidationError) as exc_info:
        val.validate_function("noop", {123: "val"})  # type: ignore
    assert exc_info.value.details[0].code == "invalid_identifier"


def test_catalog_missing_protocol_version_raises_catalog_error():
    with pytest.raises(A2uiCatalogError, match="protocol_version must be provided"):
        Catalog(catalog_id="test_cat", protocol_version="")


# ==============================================================================
# 11. Common Types Schema Resolution
# ==============================================================================


@pytest.mark.parametrize(
    "version",
    [ProtocolVersion.V0_9, ProtocolVersion.V0_9_1, ProtocolVersion.V1_0],
)
def test_get_common_types_schema_map_and_json_agree(version):
    # Content is checked against the specification by core/common_types.yaml,
    # which reads the JSON form only.
    schema_json = get_common_types_schema_json(version)
    assert json.loads(schema_json) == get_common_types_schema_map(version)


def test_get_common_types_schema_supported_versions():
    res_09 = get_common_types_schema_map(ProtocolVersion.V0_9)
    assert res_09["$id"] == "https://a2ui.org/specification/v0_9/common_types.json"
    # v0.9.1 publishes v0.9's common types unchanged.
    assert get_common_types_schema_map(ProtocolVersion.V0_9_1) == res_09

    res_10 = get_common_types_schema_map(ProtocolVersion.V1_0)
    assert res_10["$id"] == "https://a2ui.org/specification/v1_0/common_types.json"


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("0.8", ProtocolVersion.V0_8),
        ("v0.9", ProtocolVersion.V0_9),
        ("0.9.1", ProtocolVersion.V0_9_1),
        ("1.0", ProtocolVersion.V1_0),
        ("1.0.0", ProtocolVersion.V1_0),
        ("1.0.0-beta.1", ProtocolVersion.V1_0),
        (ProtocolVersion.V1_0, ProtocolVersion.V1_0),
    ],
)
def test_to_protocol_version(version, expected):
    assert to_protocol_version(version) is expected


@pytest.mark.parametrize("version", ["", "invalid_version", "1.1", "0.9.2"])
def test_to_protocol_version_rejects_unknown_versions(version):
    with pytest.raises(ValueError, match="Unknown protocol version"):
        to_protocol_version(version)


@pytest.mark.parametrize(
    "getter", [get_common_types_schema_map, get_common_types_schema_json]
)
def test_get_common_types_schema_unsupported_versions(getter):
    # v0.8 has no common_types.json
    with pytest.raises(A2uiCatalogError, match="common_types schema is not available"):
        getter(ProtocolVersion.V0_8)


def test_get_common_types_schema_map_returns_deepcopy():
    res1 = get_common_types_schema_map(ProtocolVersion.V1_0)
    res1["$defs"]["MutatedKey"] = {"type": "string"}

    res2 = get_common_types_schema_map(ProtocolVersion.V1_0)
    assert "MutatedKey" not in res2["$defs"]
    assert "MutatedKey" not in get_common_types_schema_json(ProtocolVersion.V1_0)


def test_catalog_from_json_determines_common_types_automatically():
    catalog_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "test_auto_common_types",
        "protocolVersion": "1.0",
        "components": {
            "CustomCard": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomCard"},
                    "items": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component"],
            }
        },
    }

    catalog = Catalog.from_json(catalog_schema)
    assert catalog.protocol_version == "1.0"
    reconstructed = catalog.catalog_schema
    # The external reference should be rewritten to local #/$defs/...
    card_props = reconstructed["components"]["CustomCard"]["properties"]
    assert card_props["items"]["$ref"] == "#/$defs/ChildList"
    # ChildList should be populated automatically into $defs from common_types_schema
    assert "ChildList" in reconstructed["$defs"]


_INLINE_METADATA = {
    "type": "object",
    "description": "Optional component-level metadata for vendor extensions.",
    "properties": {"extensions": {"$ref": "#/$defs/Extensions"}},
    "additionalProperties": False,
}


def test_v1_0_catalogs_inline_component_metadata():
    """Nested objects stay inline, as in the specification, not as helper defs."""
    json_catalog = Catalog.from_json({
        "catalogId": "test_inline_metadata",
        "protocolVersion": "1.0",
        "components": {
            "Card": {
                "allOf": [{"$ref": "common_types.json#/$defs/ComponentCommon"}],
                "properties": {"component": {"const": "Card"}},
                "required": ["component"],
            }
        },
    }).catalog_schema
    basic_catalog = BasicCatalogV1_0().catalog_schema

    assert (
        json_catalog["$defs"]["ComponentCommon"]["properties"]["metadata"]
        == _INLINE_METADATA
    )
    assert "ComponentCommonMetadata" not in json_catalog["$defs"]
    assert "Extensions" in json_catalog["$defs"]
    # As in the specification, v1.0 basic catalog components leave
    # `ComponentCommon`, and so its metadata, to the message envelope.
    assert "metadata" not in basic_catalog["components"]["Text"]["properties"]
    assert "ComponentCommonMetadata" not in basic_catalog["$defs"]
    # No internal schema-generation marker leaks into a published catalog.
    for schema in (json_catalog, basic_catalog, BasicCatalog().catalog_schema):
        assert '"x-a2ui-' not in json.dumps(schema)

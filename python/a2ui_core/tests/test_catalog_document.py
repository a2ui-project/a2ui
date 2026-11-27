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

"""Tests for the decoupled CatalogModel, Catalog Document codec, and adapters."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiValidationError,
    AccessibilityType,
    ActionType,
    AgentFunction,
    AnyType,
    ArrayType,
    BooleanType,
    CATALOG_DOCUMENT_FORMAT_VERSION,
    CATALOG_DOCUMENT_SCHEMA_URI,
    CapabilitiesOptions,
    Catalog,
    CatalogModel,
    CheckRuleType,
    ChildListType,
    ChildType,
    ComponentDefinition,
    ConstType,
    DataBindingType,
    EnumType,
    FunctionCallType,
    FunctionDefinition,
    IntegerType,
    MessageProcessor,
    NodeResolver,
    NumberType,
    ObjectType,
    ParameterDefinition,
    PayloadValidator,
    RefType,
    StringType,
    SurfacePropertiesDefinition,
    UnionType,
    ValidationResultReturnType,
    VoidReturnType,
    from_json_schema,
    is_catalog_document,
    parse_catalog_document,
    serialize_catalog_document,
    to_json_schema,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import (
    ComponentApi,
    FunctionApi,
    analyze_component_definition_refs,
    build_component_ref_map,
    create_function_implementation,
    has_raw_json_schema,
)
from a2ui.core.resolution import (
    ComponentContext,
    GenericBinder,
    classify_definition_behavior,
)
from a2ui.core.schema import ProtocolVersion

REPO_ROOT = Path(__file__).resolve().parents[3]


def _build_pure_model_catalog() -> Catalog:
    """Authors a complete v1.0 catalog purely with dataclasses — zero JSON Schema."""
    model = CatalogModel(
        catalog_id="https://example.com/catalogs/pure_model/v1",
        protocol_version="1.0",
        title="Pure Model Catalog",
        description="Catalog authored without JSON Schema or Pydantic.",
        instructions="Prefer `MetricCard` for KPIs.",
        metadata={"extensions": {"com_example_owner": "platform"}},
        types={
            "Spacing": EnumType(
                values=("sm", "md", "lg"),
                description="Spacing token.",
            ),
            "Weight": NumberType(min=0, description="Flex-grow weight."),
        },
        surface_properties=SurfacePropertiesDefinition(
            description="Surface theme tokens.",
            properties=(
                ParameterDefinition(
                    name="accentColor",
                    type=StringType(pattern=r"^#[0-9a-fA-F]{6}$"),
                ),
                ParameterDefinition(
                    name="density",
                    type=RefType(ref="Spacing"),
                ),
            ),
        ),
        components=(
            ComponentDefinition(
                name="Dashboard",
                description="Top-level dashboard container.",
                allowed_parents=("Surface",),
                parameters=(
                    ParameterDefinition(
                        name="title",
                        type=StringType(dynamic=True, min_length=1),
                        required=True,
                    ),
                    ParameterDefinition(
                        name="children",
                        type=ChildListType(description="Dashboard widgets."),
                        required=True,
                    ),
                    ParameterDefinition(
                        name="gap",
                        type=RefType(ref="Spacing"),
                    ),
                ),
            ),
            ComponentDefinition(
                name="MetricCard",
                description="Displays a KPI metric and action.",
                checkable=True,
                parameters=(
                    ParameterDefinition(
                        name="label",
                        type=StringType(dynamic=True),
                    ),
                    ParameterDefinition(
                        name="value",
                        type=NumberType(dynamic=True, min=0, max=1000),
                    ),
                    ParameterDefinition(
                        name="count",
                        type=IntegerType(min=0, default=1),
                    ),
                    ParameterDefinition(
                        name="highlighted",
                        type=BooleanType(dynamic=True, default=False),
                    ),
                    ParameterDefinition(
                        name="variant",
                        type=EnumType(values=("compact", "full"), default="compact"),
                    ),
                    ParameterDefinition(
                        name="kind",
                        type=ConstType(value="kpi"),
                    ),
                    ParameterDefinition(
                        name="payload",
                        type=AnyType(dynamic=True, nullable=True),
                    ),
                    ParameterDefinition(
                        name="child",
                        type=ChildType(),
                    ),
                    ParameterDefinition(
                        name="onPress",
                        type=ActionType(),
                    ),
                    ParameterDefinition(
                        name="tabs",
                        type=ArrayType(
                            items=ObjectType(
                                properties=(
                                    ParameterDefinition(
                                        name="title",
                                        type=StringType(dynamic=True),
                                        required=True,
                                    ),
                                    ParameterDefinition(
                                        name="body",
                                        type=ChildType(),
                                        required=True,
                                    ),
                                ),
                            ),
                        ),
                    ),
                    ParameterDefinition(
                        name="weight",
                        type=RefType(ref="Weight"),
                    ),
                ),
                at_least_one_of=(("label", "value"),),
            ),
            ComponentDefinition(
                name="PlainText",
                description="Static or bound text leaf.",
                parameters=(
                    ParameterDefinition(
                        name="text",
                        type=StringType(dynamic=True),
                        required=True,
                    ),
                    ParameterDefinition(
                        name="url",
                        type=StringType(dynamic=True, format="uri"),
                    ),
                ),
            ),
        ),
        functions=(
            FunctionDefinition(
                name="isNonEmpty",
                description="Checks whether a string value is non-empty.",
                return_type=ValidationResultReturnType(
                    description="Validation outcome."
                ),
                parameters=(
                    ParameterDefinition(
                        name="value",
                        type=StringType(dynamic=True),
                        required=True,
                    ),
                ),
            ),
            FunctionDefinition(
                name="notify",
                description="Displays a toast notification.",
                return_type=VoidReturnType(),
                allowed_callers="rendererOnly",
                requires_user_activation=True,
                parameters=(
                    ParameterDefinition(
                        name="message",
                        type=StringType(dynamic=True, min_length=1),
                        required=True,
                    ),
                ),
            ),
            FunctionDefinition(
                name="lookupScore",
                description="Agent-side score lookup.",
                return_type=NumberType(min=0, max=100),
                allowed_callers="rendererOnly",
                parameters=(
                    ParameterDefinition(
                        name="metricId",
                        type=StringType(dynamic=True),
                        required=True,
                    ),
                ),
            ),
        ),
    )

    def _is_non_empty(
        args: dict[str, Any], _ctx: Any, _abort: Any = None
    ) -> dict[str, Any]:
        return {
            "valid": bool(args.get("value")),
            "message": "Value is required",
        }

    def _notify(_args: dict[str, Any], _ctx: Any, _abort: Any = None) -> None:
        return None

    is_non_empty_impl = create_function_implementation(
        FunctionApi.from_definition(model.functions[0]),
        _is_non_empty,
    )
    notify_impl = create_function_implementation(
        FunctionApi.from_definition(model.functions[1]),
        _notify,
    )
    lookup_agent_fn = AgentFunction.from_definition(
        model.functions[2],
        handler=lambda args: 42.0 if args.get("metricId") else 0.0,
    )
    base = Catalog.from_model(model)
    return base.copy_with(functions=[is_non_empty_impl, notify_impl, lookup_agent_fn])


def test_pure_model_catalog_end_to_end_pipeline() -> None:
    """Exercises MessageProcessor, PayloadValidator, NodeResolver, GenericBinder, and ReferenceMap without JSON Schema."""
    cat = _build_pure_model_catalog()
    assert not any(
        has_raw_json_schema(c, cat.model.types) for c in cat.model.components
    )
    assert not any(has_raw_json_schema(f, cat.model.types) for f in cat.model.functions)

    # Reference map reads ComponentDefinition directly (including nested array-of-objects child refs).
    ref_map = build_component_ref_map(cat)
    assert ref_map["Dashboard"].list_refs == {"children"}
    assert ref_map["MetricCard"].single_refs == {"child"}
    assert "tabs" in ref_map["MetricCard"].nested_refs
    assert ref_map["MetricCard"].nested_refs["tabs"] == {"body"}

    direct_spec = analyze_component_definition_refs(
        cat.get_component_definition("MetricCard"),  # type: ignore[arg-type]
        cat.model.types,
    )
    assert direct_spec.single_refs == {"child"}
    assert "tabs" in direct_spec.nested_refs

    # GenericBinder classifies TypeDefinition directly.
    card_def = cat.get_component_definition("MetricCard")
    assert card_def is not None
    behavior = classify_definition_behavior(card_def, cat.model.types)
    assert behavior.shape is not None
    assert "label" in behavior.shape
    assert "onPress" in behavior.shape
    assert "child" in behavior.shape

    # End-to-end MessageProcessor + NodeResolver.
    processor = MessageProcessor([cat])
    processor.process_messages([
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": cat.catalog_id,
            },
        },
        {
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": "main",
                "value": {"kpiLabel": "Revenue", "kpiVal": 120},
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "Dashboard",
                        "title": "Exec Overview",
                        "children": ["card1"],
                        "gap": "lg",
                    },
                    {
                        "id": "card1",
                        "component": "MetricCard",
                        "label": {"@path": "/kpiLabel"},
                        "value": {"@path": "/kpiVal"},
                        "child": "txt1",
                        "tabs": [{"title": "Tab A", "body": "tab_txt"}],
                        "onPress": {"event": {"name": "openDetail"}},
                        "@checks": [{
                            "condition": {
                                "@call": "isNonEmpty",
                                "args": {"value": {"@path": "/kpiLabel"}},
                            },
                            "message": "Missing KPI label",
                        }],
                    },
                    {
                        "id": "txt1",
                        "component": "PlainText",
                        "text": "Details",
                        "url": "https://example.com/report",
                    },
                    {
                        "id": "tab_txt",
                        "component": "PlainText",
                        "text": "Inside tab",
                    },
                ],
            },
        },
    ])

    surface = processor.model.get_surface("main")
    assert surface is not None
    resolver = NodeResolver(surface)
    root_node = resolver.root
    assert root_node is not None
    assert root_node.props["title"].value == "Exec Overview"
    card_node = root_node.props["children"][0]
    assert card_node.component_id == "card1"
    assert card_node.props["label"].value == "Revenue"
    assert card_node.props["value"].value == 120
    resolver.dispose()

    # GenericBinder accepts canonical definition directly.
    ctx = ComponentContext.from_surface(surface, "card1")
    binder = GenericBinder(ctx, definition=card_def)
    bound = binder.snapshot
    assert bound["label"] == "Revenue"
    assert bound["value"] == 120
    assert bound["isValid"] is True
    assert callable(bound["setLabel"])
    bound["setLabel"]("ARR")
    assert surface.data_model.get("/kpiLabel") == "ARR"
    binder.dispose()

    # Inline capabilities serialization converts Catalog Document catalogs cleanly to v1.0 wire shape.
    caps = processor.get_renderer_capabilities(
        CapabilitiesOptions(
            versions=[ProtocolVersion.V1_0], include_inline_catalogs=True
        )
    )
    inline = caps[ProtocolVersion.V1_0.value]["inlineCatalogs"][0]
    assert inline["catalogId"] == cat.catalog_id
    assert "Dashboard" in inline["components"]


def test_native_model_validator_enforces_constraints() -> None:
    """Verifies PayloadValidator's native model validator rejects invalid payloads."""
    cat = _build_pure_model_catalog()
    validator = PayloadValidator(cat)

    # Valid payload passes.
    validator.validate_component({
        "id": "c1",
        "component": "MetricCard",
        "label": "Users",
        "value": 500,
        "count": 3,
        "variant": "full",
        "kind": "kpi",
        "weight": 2.5,
    })

    # atLeastOneOf violation (neither label nor value).
    with pytest.raises(A2uiValidationError):
        validator.validate_component({"id": "c1", "component": "MetricCard"})

    # Out-of-range numeric bound.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "c1",
            "component": "MetricCard",
            "value": 5000,
        })

    # Float rejected for integer parameter.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "c1",
            "component": "MetricCard",
            "label": "Users",
            "count": 1.5,
        })

    # Invalid enum value.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "c1",
            "component": "MetricCard",
            "label": "Users",
            "variant": "huge",
        })

    # Invalid const value.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "c1",
            "component": "MetricCard",
            "label": "Users",
            "kind": "other",
        })

    # Invalid URI format on constrained dynamic string literal.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "t1",
            "component": "PlainText",
            "text": "Link",
            "url": "not a uri",
        })

    # Dynamic binding allowed on constrained dynamic string.
    validator.validate_component({
        "id": "t1",
        "component": "PlainText",
        "text": "Link",
        "url": {"@path": "/href"},
    })

    # Invalid surfaceProperties (pattern mismatch + bad RefType enum).
    with pytest.raises(A2uiValidationError):
        validator.validate_theme({"accentColor": "red"})
    with pytest.raises(A2uiValidationError):
        validator.validate_theme({"density": "xl"})
    validator.validate_theme({"accentColor": "#FF00AA", "density": "sm"})

    # Unknown component property rejected.
    with pytest.raises(A2uiValidationError):
        validator.validate_component({
            "id": "t1",
            "component": "PlainText",
            "text": "Hi",
            "bogus": 1,
        })


def test_catalog_document_codec_round_trip_and_auto_detect() -> None:
    """Verifies Catalog.from_document, Catalog.from_json auto-detect, and lossless to_document()."""
    cat = _build_pure_model_catalog()
    doc = cat.to_document()
    assert is_catalog_document(doc)
    assert doc["formatVersion"] == CATALOG_DOCUMENT_FORMAT_VERSION
    assert doc["protocolVersion"] == "1.0"
    assert isinstance(doc["components"], list)
    assert isinstance(doc["functions"], list)

    doc_with_schema = cat.to_document(include_schema=True)
    assert doc_with_schema["$schema"] == CATALOG_DOCUMENT_SCHEMA_URI
    assert Catalog.from_document(doc_with_schema).to_json() == doc_with_schema

    # Auto-detected by Catalog.from_json AND parsed by Catalog.from_document.
    loaded_auto = Catalog.from_json(doc)
    loaded_explicit = Catalog.from_document(doc)
    assert loaded_auto.to_json() == doc
    assert loaded_explicit.to_document() == doc

    # Pruning via copy_with drops unused leaf types (Weight) while keeping
    # types still referenced by surfaceProperties (Spacing).
    pruned = loaded_explicit.copy_with(
        components=[loaded_explicit.get_component("PlainText")]  # type: ignore[list-item]
    )
    assert set(pruned.to_document().get("types", {}).keys()) == {"Spacing"}

    # Unicode UAX #31 identifier support.
    unicode_doc: dict[str, Any] = {
        "formatVersion": "1.0",
        "protocolVersion": "1.0",
        "catalogId": "https://example.com/unicode",
        "components": [{
            "name": "日本語パネル",
            "parameters": [{"name": "見出し", "type": "string", "required": True}],
        }],
    }
    parsed_unicode = parse_catalog_document(unicode_doc)
    assert parsed_unicode.components[0].name == "日本語パネル"
    assert (
        serialize_catalog_document(parsed_unicode)["components"][0]["name"]
        == "日本語パネル"
    )


@pytest.mark.parametrize(
    "mutator, match",
    [
        (lambda d: d.__setitem__("formatVersion", "2.0"), "formatVersion"),
        (lambda d: d.__setitem__("protocolVersion", "not-semver"), "protocolVersion"),
        (lambda d: d.__setitem__("catalogId", ""), "catalogId"),
        (
            lambda d: d["components"].append({"name": "Surface", "parameters": []}),
            "Surface",
        ),
        (
            lambda d: d["components"].append({"name": "1Invalid", "parameters": []}),
            "identifier",
        ),
        (
            lambda d: d.__setitem__(
                "functions",
                [{"name": "@custom", "returnType": "boolean"}],
            ),
            "@",
        ),
        (
            lambda d: d.__setitem__(
                "functions",
                [{
                    "name": "badActivation",
                    "returnType": "void",
                    "allowedCallers": "agentOnly",
                    "requiresUserActivation": True,
                }],
            ),
            "requiresUserActivation",
        ),
        (
            lambda d: d["components"].append({"name": "Card", "parameters": []}),
            "Duplicate component",
        ),
        (
            lambda d: d["components"][0]["parameters"].append(
                {"name": "badRef", "type": "ref", "ref": "DoesNotExist"}
            ),
            "unresolved local type ref",
        ),
        (
            lambda d: d.__setitem__(
                "types",
                {
                    "LoopA": {"type": "ref", "ref": "LoopB"},
                    "LoopB": {"type": "ref", "ref": "LoopA"},
                },
            ),
            "Circular local type ref",
        ),
        (
            lambda d: d.__setitem__(
                "functions",
                [{
                    "name": "badUiFn",
                    "returnType": "void",
                    "parameters": [{"name": "slot", "type": "child"}],
                }],
            ),
            "only allowed inside component parameters",
        ),
        (
            lambda d: d.__setitem__("types", {"BadSlot": {"type": "action"}}),
            "only allowed inside component parameters",
        ),
        (
            lambda d: d.__setitem__(
                "surfaceProperties",
                {"properties": [{"name": "slot", "type": "childList"}]},
            ),
            "only allowed inside component parameters",
        ),
        (
            lambda d: d["components"][0]["parameters"].append(
                {"name": "badInt", "type": "integer", "default": 1.5}
            ),
            "integer",
        ),
        (
            lambda d: d["components"][0]["parameters"].append({
                "name": "badUnion",
                "type": "union",
                "variants": [{"type": "string"}],
            }),
            "at least 2",
        ),
        (
            lambda d: d["components"][0].__setitem__("atLeastOneOf", [["nonexistent"]]),
            "undeclared",
        ),
        (
            lambda d: d["components"][0]["parameters"].append({
                "name": "badItems",
                "type": "array",
                "items": {"name": "illegal", "type": "string"},
            }),
            "unexpected property",
        ),
    ],
)
def test_catalog_document_negative_validation(mutator: Any, match: str) -> None:
    """Ensures every normative Catalog Document structural and semantic rule is enforced."""
    base: dict[str, Any] = {
        "formatVersion": "1.0",
        "protocolVersion": "1.0",
        "catalogId": "https://example.com/neg",
        "components": [{
            "name": "Card",
            "parameters": [{"name": "title", "type": "string", "required": True}],
        }],
    }
    doc = copy.deepcopy(base)
    mutator(doc)
    with pytest.raises((A2uiCatalogError, A2uiValidationError), match=match):
        parse_catalog_document(doc)


@pytest.mark.parametrize(
    "rel_path, version",
    [
        ("catalogs/basic/v1/catalog.json", "1.0"),
        ("catalogs/mcp/v1/catalog.json", "1.0"),
        ("catalogs/vegachart/v1/catalog.json", "1.0"),
        ("catalogs/basic/v0_9/catalog.json", "0.9"),
    ],
)
def test_all_published_catalogs_round_trip_with_zero_raw_fallback(
    rel_path: str, version: str
) -> None:
    """Every published v1.0 and v0.9 catalog converts cleanly with zero RawJsonSchemaType."""
    raw = json.loads((REPO_ROOT / rel_path).read_text(encoding="utf-8"))
    cat = Catalog.from_json(raw, protocol_version=version)
    model = cat.model

    assert [
        c.name for c in model.components if has_raw_json_schema(c, model.types)
    ] == []
    assert [
        f.name for f in model.functions if has_raw_json_schema(f, model.types)
    ] == []
    if model.surface_properties is not None:
        assert not has_raw_json_schema(model.surface_properties, model.types)

    doc = cat.to_document()
    cat2 = Catalog.from_document(doc)
    assert cat2.to_document() == doc

    synthesized = cat2.to_json_schema()
    cat3 = Catalog.from_json(synthesized, protocol_version=version)
    assert set(cat3.components.keys()) == set(cat.components.keys())
    for cname in cat.components:
        orig_def = cat.get_component_definition(cname)
        rt_def = cat3.get_component_definition(cname)
        assert orig_def is not None and rt_def is not None
        assert [p.name for p in rt_def.parameters] == [
            p.name for p in orig_def.parameters
        ]
        assert rt_def.checkable == orig_def.checkable


@pytest.mark.parametrize("version", ["1.0", "0.9"])
def test_basic_catalog_pydantic_models_extract_directly_without_raw_fallback(
    version: str,
) -> None:
    """BasicCatalog Pydantic models translate directly into canonical CatalogModel."""
    bc = BasicCatalog(version)
    model = bc.model
    assert len(model.components) == 18
    assert len(model.functions) == 14
    assert [
        c.name for c in model.components if has_raw_json_schema(c, model.types)
    ] == []
    assert [
        f.name for f in model.functions if has_raw_json_schema(f, model.types)
    ] == []

    doc = bc.to_document()
    reloaded = Catalog.from_document(doc)
    assert reloaded.to_document() == doc

    # Direct standalone from_json_schema / to_json_schema adapter round-trip.
    js = to_json_schema(reloaded.model)
    re_parsed = from_json_schema(js, protocol_version=version)
    assert [c.name for c in re_parsed.components] == [c.name for c in model.components]
    assert [f.name for f in re_parsed.functions] == [f.name for f in model.functions]


def test_component_and_function_api_from_definition_lazy_schema() -> None:
    """ComponentApi.from_definition and FunctionApi.from_definition work without JSON Schema dicts."""
    comp_def = ComponentDefinition(
        name="Banner",
        description="Status banner.",
        checkable=True,
        parameters=(
            ParameterDefinition(
                name="message", type=StringType(dynamic=True), required=True
            ),
            ParameterDefinition(name="a11y", type=AccessibilityType()),
            ParameterDefinition(
                name="customChecks", type=ArrayType(items=CheckRuleType())
            ),
            ParameterDefinition(name="binding", type=DataBindingType()),
            ParameterDefinition(name="expr", type=FunctionCallType()),
            ParameterDefinition(
                name="choice",
                type=UnionType(variants=(StringType(), IntegerType())),
            ),
        ),
    )
    comp_api = ComponentApi.from_definition(comp_def)
    assert comp_api.name == "Banner"
    assert comp_api.definition == comp_def
    # Accessing `.schema` lazily synthesizes JSON Schema only when requested.
    assert comp_api._schema is None
    synth = comp_api.schema
    assert isinstance(synth, dict)
    assert "allOf" in synth

    fn_def = FunctionDefinition(
        name="double",
        return_type="number",
        parameters=(
            ParameterDefinition(name="x", type=NumberType(dynamic=True), required=True),
        ),
    )
    fn_api = FunctionApi.from_definition(fn_def)
    assert fn_api.name == "double"
    assert fn_api.definition == fn_def
    assert fn_api.return_type == "number"

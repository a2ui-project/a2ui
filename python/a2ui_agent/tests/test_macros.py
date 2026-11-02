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

"""Python-specific unit and integration tests for A2UI Macros.

Cross-language macro expansion, parameter coercion, schema synthesis, catalog
scoping, and error semantics are covered by ``conformance/agent/macros/macros.yaml``.
"""

import copy
from enum import Enum
import logging
from typing import Annotated, Any, Literal, Optional, Sequence

from pydantic import Field
import pytest

from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.v0_9 import (
    Action,
    Card,
    Column,
    ComponentBuilderNode,
    DynamicString,
    Row,
    Text,
)
from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import (
    A2uiCatalogError,
    A2uiRecursionError,
    A2uiValidationError,
    Catalog,
    CatalogApi,
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema.v0_9 import UpdateComponents, UpdateComponentsMessage
from a2ui.core.schema.v1_0 import (
    CreateSurface as CreateSurfaceV10,
    CreateSurfaceMessage as CreateSurfaceMessageV10,
    UpdateComponents as UpdateComponentsV10,
    UpdateComponentsMessage as UpdateComponentsMessageV10,
)
from a2ui.inference_formats.express import ExpressFormat
from a2ui.transformers.macros import MacroExpander, macro


def make_test_catalog(
    components: Optional[dict[str, Any]] = None,
) -> CatalogApi:
    if components is None:
        return BasicCatalog("0.9.1")
    return Catalog.from_json(
        catalog_schema={"catalogId": "test", "components": components},
        protocol_version="0.9.1",
        catalog_id="test",
    )


def test_macro_decorator_and_schema_synthesis():
    @macro(description="A user summary card.")
    def profile_card(name: str, age: int, is_admin: bool = False) -> Card:
        """User profile card."""
        return Card(
            child=Column(
                children=[
                    Text(text=name, variant="h2"),
                    Text(text=f"Age: {age}", variant="caption"),
                ]
            )
        )

    meta = profile_card.__a2ui_macro__
    assert meta is not None
    assert meta.name == "ProfileCard"
    assert meta.description == "A user summary card."

    schema = meta.to_json_schema()
    assert schema["type"] == "object"
    assert schema["properties"]["name"]["type"] == "string"
    assert schema["properties"]["age"]["type"] == "integer"
    assert schema["properties"]["is_admin"]["type"] == "boolean"
    assert schema["required"] == ["name", "age"]


def test_macro_docstring_parameter_parsing():
    @macro
    def MetricCard(
        title: str,
        value: int,
        unit: str = "items",
    ) -> Card:
        """Dashboard metric counter.

        Args:
            title: Title label of the metric.
            value: Numerical counter value.
            unit: Optional unit label.
        """
        return Card(child=Column(children=[Text(text=title), Text(text=str(value))]))

    meta = MetricCard.__a2ui_macro__
    assert meta is not None
    assert meta.name == "MetricCard"
    assert meta.description == "Dashboard metric counter."
    assert meta.parameters["title"].description == "Title label of the metric."
    assert meta.parameters["title"].required is True
    assert meta.parameters["value"].description == "Numerical counter value."
    assert meta.parameters["value"].required is True
    assert meta.parameters["unit"].description == "Optional unit label."
    assert meta.parameters["unit"].required is False

    schema = meta.to_json_schema()
    assert schema["properties"]["title"]["description"] == "Title label of the metric."
    assert schema["properties"]["value"]["type"] == "integer"
    assert schema["required"] == ["title", "value"]


def test_macro_sphinx_docstring_parsing():
    @macro
    def SphinxItem(title: str, count: int) -> Card:
        """Card item documented with Sphinx style.

        :param title: The title of the item.
        :param count: Quantity in stock.
        :type count: int
        :return: A Card component.
        """
        return Card(child=Text(text=f"{title}: {count}"))

    meta = SphinxItem.__a2ui_macro__
    assert meta is not None
    assert meta.description == "Card item documented with Sphinx style."
    assert meta.parameters["title"].description == "The title of the item."
    assert meta.parameters["count"].description == "Quantity in stock."
    schema = meta.to_json_schema()
    assert schema["properties"]["title"]["description"] == "The title of the item."
    assert schema["properties"]["count"]["description"] == "Quantity in stock."


def test_macro_naming_conventions_and_expander_defaults():
    @macro
    def employee_roster(team: str) -> Column:
        return Column(children=[Text(text=team)])

    assert employee_roster.__a2ui_macro__.name == "EmployeeRoster"

    @macro("CustomAlert")
    def alert_fn(msg: str) -> Card:
        return Card(child=Text(text=msg))

    assert alert_fn.__a2ui_macro__.name == "CustomAlert"
    assert MacroExpander().macros == []

    with pytest.raises(ValueError, match="is not decorated with @macro"):
        MacroExpander([lambda: None])


def test_python_enum_any_dict_and_custom_ref_prefix_schema():
    class ThemeEnum(Enum):
        LIGHT = "light"
        DARK = "dark"

    @macro
    def FlexibleMacro(
        dynamic_title: DynamicString,
        theme_enum: ThemeEnum,
        arbitrary_data: Any,
        metadata: dict[str, Any],
        raw_dict: dict,
        annotated_field: Annotated[str, Field(description="Field description")],
        annotated_str: Annotated[int, "Inline string description"],
    ) -> Card:
        """Macro testing Python Enum, Any, dict, Annotated, and custom ref_prefix."""
        return Card(child=Text(text="flexible"))

    meta = FlexibleMacro.__a2ui_macro__
    schema = meta.to_json_schema()
    props = schema["properties"]

    assert props["theme_enum"] == {
        "type": "string",
        "enum": ["light", "dark"],
    }
    assert props["arbitrary_data"] == {}
    assert props["metadata"] == {"type": "object"}
    assert props["raw_dict"] == {"type": "object"}
    assert props["annotated_field"] == {
        "type": "string",
        "description": "Field description",
    }
    assert props["annotated_str"] == {
        "type": "integer",
        "description": "Inline string description",
    }

    custom_prefix = "https://a2ui.org/specification/v0_9/common_types.json#/$defs/"
    custom_schema = meta.to_json_schema(ref_prefix=custom_prefix)
    assert (
        custom_schema["properties"]["dynamic_title"]["$ref"]
        == f"{custom_prefix}DynamicString"
    )


def test_v1_0_canonical_protocol_types_and_pep604_unions_schema():
    # Verify a local alias named 'name' does not collide with @macro's own locals
    name = builder_v1_0.DynamicString

    @macro
    def ComplexCardV10(
        title: str,
        dynamic_title: name,
        optional_title: builder_v1_0.DynamicString | None,
        metric: builder_v1_0.DynamicNumber,
        is_active: builder_v1_0.DynamicBoolean,
        tags: builder_v1_0.DynamicStringList,
        anything: builder_v1_0.DynamicValue,
        on_click: builder_v1_0.Action | None,
        checks: Sequence[builder_v1_0.CheckRule],
        accessibility: builder_v1_0.AccessibilityAttributes,
        footer: builder_v1_0.Child,
        items: builder_v1_0.ChildList,
        fn_call: builder_v1_0.FunctionCall,
        binding: builder_v1_0.DataBinding,
    ) -> builder_v1_0.Card:
        """v1.0 card testing protocol common types and PEP 604 unions."""
        return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    meta = ComplexCardV10.__a2ui_macro__
    assert meta.is_v1_0 is True
    props = meta.to_json_schema()["properties"]

    assert props["title"]["type"] == "string"
    assert props["dynamic_title"]["$ref"] == "common_types.json#/$defs/DynamicString"
    assert props["optional_title"]["$ref"] == "common_types.json#/$defs/DynamicString"
    assert props["metric"]["$ref"] == "common_types.json#/$defs/DynamicNumber"
    assert props["is_active"]["$ref"] == "common_types.json#/$defs/DynamicBoolean"
    assert props["tags"]["$ref"] == "common_types.json#/$defs/DynamicStringList"
    assert props["anything"]["$ref"] == "common_types.json#/$defs/DynamicValue"
    assert props["on_click"]["$ref"] == "common_types.json#/$defs/Action"
    assert props["checks"] == {
        "type": "array",
        "items": {"$ref": "common_types.json#/$defs/CheckRule"},
    }
    assert (
        props["accessibility"]["$ref"]
        == "common_types.json#/$defs/AccessibilityAttributes"
    )
    assert props["footer"]["$ref"] == "common_types.json#/$defs/Child"
    assert props["items"]["$ref"] == "common_types.json#/$defs/ChildList"
    assert props["fn_call"]["$ref"] == "common_types.json#/$defs/FunctionCall"
    assert props["binding"]["$ref"] == "common_types.json#/$defs/DataBinding"


def test_macro_component_subclass_and_direct_processor_coercion():
    @macro
    def CardWrapper(
        header: Optional[Row],
        card: Card,
        cards: Sequence[Card],
    ) -> Column:
        children: list[ComponentBuilderNode] = []
        if header:
            children.append(header)
        children.append(card)
        children.extend(cards)
        return Column(children=children)

    expander = MacroExpander([CardWrapper])
    expanded = expander.processor.expand(
        "CardWrapper",
        {
            "header": "header_row_id",
            "card": "main_card_id",
            "cards": ["card_sub_1", "card_sub_2"],
        },
        instance_id="wrapper_root",
    )

    col = [c for c in expanded if c["component"] == "Column"][0]
    assert col["id"] == "wrapper_root"
    assert col["children"] == [
        "header_row_id",
        "main_card_id",
        "card_sub_1",
        "card_sub_2",
    ]


def test_direct_processor_type_errors_and_untyped_passthrough():
    @macro
    def StrictPanel(
        in_stock: bool,
        tags: list[str],
        seq_children: Sequence[builder_v1_0.Child],
    ) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Row(
                children=list(seq_children)
                + [builder_v1_0.Text(text="Buy" if in_stock else "Out")]
            )
        )

    exp = MacroExpander([StrictPanel])
    with pytest.raises(TypeError, match="in_stock"):
        exp.processor.expand(
            "StrictPanel",
            {
                "in_stock": {"@path": "/stock"},
                "tags": ["sale"],
                "seq_children": ["c1"],
            },
            instance_id="s1",
        )
    with pytest.raises(TypeError, match="tags"):
        exp.processor.expand(
            "StrictPanel",
            {
                "in_stock": True,
                "tags": {"@path": "/tags"},
                "seq_children": ["c1"],
            },
            instance_id="s2",
        )
    # Plain Sequence[Child] (unlike ChildList) rejects DynamicChildList dicts
    with pytest.raises(TypeError, match="seq_children"):
        exp.processor.expand(
            "StrictPanel",
            {
                "in_stock": True,
                "tags": ["sale"],
                "seq_children": {"path": "/items", "componentId": "tmpl"},
            },
            instance_id="s3",
        )
    with pytest.raises(TypeError, match="weight"):
        exp.processor.expand(
            "StrictPanel",
            {
                "in_stock": True,
                "tags": ["sale"],
                "seq_children": ["c1"],
                "weight": 2.0,
            },
            instance_id="s4",
        )

    # Untyped parameter passes raw v1.0 binding dict through to the builder node
    @macro
    def UnannotatedV10Text(content):
        return builder_v1_0.Text(text=content)

    unann_out = MacroExpander([UnannotatedV10Text]).processor.expand(
        "UnannotatedV10Text",
        {"content": {"@path": "/headline"}},
        instance_id="u1",
    )
    assert unann_out[0]["text"] == {"@path": "/headline"}


def test_macro_catalog_pruning_and_ref_localization():
    @macro
    def MiniBadge(label: DynamicString) -> Card:
        return Card(child=Text(text=label))

    v09_prefix = "https://a2ui.org/specification/v0_9/common_types.json#/$defs/"
    base_cat = make_test_catalog({
        "Button": {"type": "object", "properties": {"variant": {"type": "string"}}},
        "Card": {"type": "object", "properties": {"child": {"type": "string"}}},
        "Text": {
            "type": "object",
            "properties": {"text": {"$ref": f"{v09_prefix}DynamicString"}},
        },
    })
    base_schema = copy.deepcopy(base_cat.validation_schema)

    expander = MacroExpander([MiniBadge])
    inference_cat = expander.transform_to_inference_catalog(base_cat)
    assert (
        inference_cat.validation_schema["components"]["MiniBadge"]["properties"][
            "label"
        ]["$ref"]
        == "#/$defs/DynamicString"
    )
    assert base_cat.validation_schema == base_schema

    pruned_cat = ComponentPruningTransformer(["MiniBadge", "Text"]).transform(
        inference_cat
    )
    schema = pruned_cat.validation_schema
    assert set(schema["components"]) == {"MiniBadge", "Text"}
    assert {ref["$ref"] for ref in schema["$defs"]["anyComponent"]["oneOf"]} == {
        "#/components/MiniBadge",
        "#/components/Text",
    }


def test_envelope_inputs_not_mutated_and_failure_logs_error(caplog):
    @macro
    def FailingMacro(bad_arg: str) -> Card:
        raise RuntimeError("Something exploded inside macro expansion")

    fail_msg = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{"component": "FailingMacro", "id": "fail_1", "bad_arg": "x"}],
        ),
    )
    with caplog.at_level(logging.ERROR):
        result = MacroExpander([FailingMacro]).transform_to_transport([fail_msg])
    assert result[0].update_components.components[0]["component"] == "FailingMacro"
    assert any(
        "Failed to expand macro 'FailingMacro'" in rec.message for rec in caplog.records
    )

    @macro
    def StatusBadge(status: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=status),
            accessibility=builder_v1_0.AccessibilityAttributes(description="Default"),
            extensions={"macroMeta": {"source": "StatusBadge"}},
        )

    a11y_input = {"label": "Server status badge"}
    meta_input = {"extensions": {"telemetry": {"traceId": "t1"}}}
    expander = MacroExpander([StatusBadge])
    # Calling to_catalog() must not disable macro expansion on basic catalog surfaces
    _ = expander.to_catalog()
    _ = expander.transform_to_transport([
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[{
                    "component": "StatusBadge",
                    "id": "b1",
                    "status": "ok",
                    "accessibility": a11y_input,
                    "metadata": meta_input,
                }],
            ),
        )
    ])
    assert a11y_input == {"label": "Server status badge"}
    assert meta_input == {"extensions": {"telemetry": {"traceId": "t1"}}}


def test_scoped_logging_surface_catalogs_immutability_and_lru_eviction(caplog):
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    brand_cid = "https://example.com/brand.json"

    @macro
    def BrandBadge(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=builder_v1_0.Text(text=label, catalog_id=basic_cid),
        )

    scoped_expander = MacroExpander([BrandBadge], catalog_id=brand_cid)
    standalone_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="untracked_surface",
            components=[
                {
                    "id": "b_untracked",
                    "component": "BrandBadge",
                    "label": "Skipped",
                },
                {
                    "id": "empty_cid",
                    "component": "BrandBadge",
                    "catalogId": "",
                    "label": "Empty",
                },
                {
                    "id": "int_cid",
                    "component": "BrandBadge",
                    "catalogId": 123,
                    "label": "Int",
                },
            ],
        ),
    )
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        out = scoped_expander.transform_to_transport([standalone_msg])
    assert len(out[0].update_components.components) == 3
    warning_msgs = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    debug_msgs = [r.message for r in caplog.records if r.levelno == logging.DEBUG]
    assert any("empty_cid" in m and "invalid catalogId ''" in m for m in warning_msgs)
    assert any("int_cid" in m and "invalid catalogId 123" in m for m in warning_msgs)
    assert not any("b_untracked" in m for m in warning_msgs)
    assert any("b_untracked" in m and "untracked_surface" in m for m in debug_msgs)

    # Stateless surface_catalogs override does not mutate internal _surface_catalogs
    _ = scoped_expander.transform_to_transport(
        [
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="main",
                    components=[{
                        "id": "root",
                        "component": "BrandBadge",
                        "label": "Ok",
                    }],
                ),
            )
        ],
        surface_catalogs={"main": brand_cid},
    )
    assert scoped_expander._surface_catalogs == {}

    # Exceeding _MAX_TRACKED_SURFACES (256) evicts oldest entry and logs warning
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        scoped_expander.transform_to_transport([
            CreateSurfaceMessageV10(
                version="1.0",
                createSurface=CreateSurfaceV10(
                    surfaceId=f"surf_{i}", catalogId=basic_cid
                ),
            )
            for i in range(257)
        ])
    assert "surf_0" not in scoped_expander._surface_catalogs
    assert "surf_256" in scoped_expander._surface_catalogs
    assert any(
        r.levelno == logging.WARNING
        and "Evicted oldest tracked surface 'surf_0'" in r.message
        for r in caplog.records
    )


def test_v09_deferred_nested_and_cyclic_component_nodes():
    class InnerBadgeNode(ComponentBuilderNode):
        component: Literal["InnerBadge"] = "InnerBadge"
        label: str

    @macro
    def InnerBadge(label: str) -> Text:
        return Text(text=f"Badge: {label}")

    @macro
    def OuterPanel(title: str) -> Card:
        return Card(
            child=Column(children=[Text(text=title), InnerBadgeNode(label=title)])
        )

    lowered = MacroExpander([InnerBadge, OuterPanel]).transform_to_transport([
        UpdateComponentsMessage(
            version="v0.9.1",
            updateComponents=UpdateComponents(
                surfaceId="main",
                components=[{"component": "OuterPanel", "id": "p1", "title": "Prod"}],
            ),
        )
    ])
    comps = lowered[0].update_components.components
    assert [c["component"] for c in comps] == ["Text", "Text", "Column", "Card"]

    class DeferredCycleNode(ComponentBuilderNode):
        component: Literal["DeferredCycle"] = "DeferredCycle"
        label: str

    @macro
    def DeferredCycle(label: str) -> Card:
        return Card(child=DeferredCycleNode(label=label))

    with pytest.raises(A2uiRecursionError):
        MacroExpander([DeferredCycle]).transform_to_transport([
            UpdateComponentsMessage(
                version="v0.9.1",
                updateComponents=UpdateComponents(
                    surfaceId="main",
                    components=[{
                        "id": "root",
                        "component": "DeferredCycle",
                        "label": "loop",
                    }],
                ),
            )
        ])


def _define_macro_with_unresolved_hint() -> Any:
    """Module-level helper whose string annotation must not resolve from caller locals."""

    @macro
    def UnresolvedHintCard(x: "CallerFrameShadowType") -> builder_v1_0.Card:  # noqa: F821
        return builder_v1_0.Card(child=builder_v1_0.Text(text=str(x)))

    return UnresolvedHintCard


def test_python_version_detection_mixing_and_decorator_name_validation(caplog):
    with pytest.raises(A2uiValidationError, match="mixes A2UI v0.9 and v1.0"):

        @macro
        def MixedSignature(on_click: Action) -> builder_v1_0.Card:
            return builder_v1_0.Card(child=builder_v1_0.Text(text="x"))

    @macro
    def MixedAnnotationAndBody(label: str) -> Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=label))  # type: ignore[return-value]

    with pytest.raises(
        A2uiValidationError, match="returned v1.0 builder nodes, expected v0.9"
    ):
        MacroExpander([MixedAnnotationAndBody]).processor.expand(
            "MixedAnnotationAndBody", {"label": "hi"}, instance_id="m1"
        )

    @macro
    def MixedSubtree(label: str):
        return builder_v1_0.Card(child=Text(text=label))

    with pytest.raises(A2uiValidationError, match="returned mixed A2UI v0.9 and v1.0"):
        MacroExpander([MixedSubtree]).processor.expand(
            "MixedSubtree", {"label": "hi"}, instance_id="m2"
        )

    @macro
    def V09Only(label: str) -> Card:
        return Card(child=Text(text=label))

    @macro
    def V10Only(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=label))

    with pytest.raises(A2uiValidationError, match="cannot mix"):
        MacroExpander([V09Only, V10Only])

    with pytest.raises(A2uiValidationError, match="cannot mix"):
        MacroExpander([V09Only], protocol_version="1.0")

    class CustomV10Card(builder_v1_0.ComponentBuilderNode):
        component: Literal["CustomV10Card"] = "CustomV10Card"
        label: str

    class CustomV09Card(ComponentBuilderNode):
        component: Literal["CustomV09Card"] = "CustomV09Card"
        label: str

    @macro
    def SubclassV10Macro(label: str) -> CustomV10Card:
        return CustomV10Card(label=label)

    @macro
    def SubclassV09Macro(label: str) -> CustomV09Card:
        return CustomV09Card(label=label)

    assert SubclassV10Macro.__a2ui_macro__.target_version == "1.0"
    assert MacroExpander([SubclassV10Macro]).to_catalog().protocol_version == "1.0"
    assert SubclassV09Macro.__a2ui_macro__.target_version == "0.9"
    assert MacroExpander([SubclassV09Macro]).to_catalog().protocol_version == "0.9.1"

    def _build_v10_helper(content):
        return builder_v1_0.Card(child=builder_v1_0.Text(text=content))

    @macro
    def DelegatingV10Macro(content):
        return _build_v10_helper(content)

    assert DelegatingV10Macro.__a2ui_macro__.target_version is None
    delegating_exp = MacroExpander([DelegatingV10Macro], protocol_version="1.0")
    assert delegating_exp.to_catalog().protocol_version == "1.0"
    delegating_out = delegating_exp.processor.expand(
        "DelegatingV10Macro",
        {"content": {"@path": "/delegated"}},
        instance_id="d1",
    )
    assert delegating_out[0]["text"] == {"@path": "/delegated"}

    v10_base = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=BasicCatalog("1.0").catalog_id,
    )
    assert (
        MacroExpander([DelegatingV10Macro], base_catalogs=[v10_base])
        .to_catalog()
        .protocol_version
        == "1.0"
    )

    # Decorator-time validation for v1.0 macros and export-time validation for untyped macros
    with pytest.raises(A2uiValidationError, match="reserved"):

        @macro
        def Surface(title: str) -> builder_v1_0.Card:
            return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    with pytest.raises(A2uiValidationError, match="reserved"):

        @macro(name="Ｓurface")
        def FullwidthSurface(title: str) -> builder_v1_0.Card:
            return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    with pytest.raises(A2uiValidationError, match="valid Unicode identifier"):

        @macro(name="123-invalid!")
        def InvalidMacro(title: str) -> builder_v1_0.Card:
            return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    @macro(name="Surface")
    def NeutralSurface(title: str):
        return title

    with pytest.raises(A2uiValidationError, match="reserved"):
        MacroExpander([NeutralSurface]).to_catalog(protocol_version="1.0")

    # Caller frame variable must not leak into enclosing @macro annotation resolution
    CallerFrameShadowType = int  # noqa: F841
    with caplog.at_level(logging.WARNING):
        unresolved_macro = _define_macro_with_unresolved_hint()
    assert unresolved_macro.__a2ui_macro__.parameters["x"].type_hint is Any
    assert (
        "Could not resolve type annotations for macro 'UnresolvedHintCard'"
        in caplog.text
    )


def test_macro_parser_parse_response():
    """Verifies ExpressFormat v0.9.1 parsing and macro lowering end-to-end."""

    @macro
    def UserInfoCard(name: str, role: str = "Engineer") -> Card:
        return Card(
            child=Column(
                children=[
                    Text(text=name, variant="h3"),
                    Text(text=role, variant="caption"),
                ]
            )
        )

    expander = MacroExpander([UserInfoCard])
    inference_cat = expander.transform_to_inference_catalog(BasicCatalog("0.9.1"))
    fmt = ExpressFormat(
        catalogs=[inference_cat], surface_id="test_surf", version="v0.9.1"
    )

    llm_output = (
        "Here is the requested user profile card:\n"
        "<a2ui>\n"
        'root = UserInfoCard(name="Alice Smith", role="Tech Lead")\n'
        "</a2ui>\n"
        "Let me know if you need any adjustments."
    )

    parts = fmt.create_parser().parse_response(llm_output)
    assert len(parts) == 3
    assert "Here is the requested user profile card:" in parts[0].text
    assert parts[1].a2ui is not None
    assert "Let me know if you need any adjustments." in parts[2].text

    lowered_messages = expander.transform_to_transport(parts[1].a2ui)
    components = [
        c
        for msg in lowered_messages
        if isinstance(msg, UpdateComponentsMessage)
        for c in msg.update_components.components
    ]
    comp_names = [c["component"] for c in components]
    assert "UserInfoCard" not in comp_names
    assert "Card" in comp_names
    assert "Text" in comp_names
    text_contents = [c.get("text") for c in components if c["component"] == "Text"]
    assert "Alice Smith" in text_contents
    assert "Tech Lead" in text_contents


def test_v1_0_express_format_end_to_end_with_macros():
    @macro
    def HeroBanner(
        headline: builder_v1_0.DynamicString,
        cta_label: str,
        on_cta: builder_v1_0.Action,
    ) -> builder_v1_0.Card:
        """Hero banner with dynamic headline and CTA button."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=headline, variant="body"),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text=cta_label),
                        action=on_cta,
                        variant="primary",
                    ),
                ]
            )
        )

    base_cat = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=BasicCatalog("1.0").catalog_id,
    )
    expander = MacroExpander([HeroBanner])
    inf_cat = expander.transform_to_inference_catalog(base_cat)
    assert inf_cat.protocol_version == "1.0"

    fmt = ExpressFormat(
        catalogs=[inf_cat],
        surface_id="main",
        version="1.0",
    )
    llm_output = (
        "<a2ui>\n"
        "root = HeroBanner(\n"
        "  headline=$/hero/headline,\n"
        '  cta_label="Launch",\n'
        '  on_cta={event: {name: "launch_clicked", userMessage: "Launch now"}}\n'
        ")\n"
        "</a2ui>"
    )
    parts = fmt.create_parser().parse_response(llm_output)
    raw_msgs = parts[0].a2ui
    assert raw_msgs is not None

    lowered = expander.transform_to_transport(raw_msgs)
    create_msgs = [m for m in lowered if isinstance(m, CreateSurfaceMessageV10)]
    assert len(create_msgs) == 1
    comps = create_msgs[0].create_surface.components
    assert comps is not None
    comp_types = [c["component"] for c in comps]
    assert "HeroBanner" not in comp_types
    assert comp_types == ["Text", "Text", "Button", "Column", "Card"]
    assert comps[-1]["id"] == "root"

    btn = [c for c in comps if c["component"] == "Button"][0]
    assert btn["action"] == {
        "event": {
            "name": "launch_clicked",
            "userMessage": "Launch now",
        }
    }


def test_v1_0_mixable_catalogs_foo_bar_baz_macro_with_express():
    foo_cid = "https://example.com/catalogs/foo/v1/catalog.json"
    bar_cid = "https://example.com/catalogs/bar/v1/catalog.json"
    common_ref = "https://a2ui.org/specification/v1_0/json/common_types.json#/$defs/"

    foo_catalog = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": foo_cid,
            "components": {
                "FooPanel": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "FooPanel"},
                        "id": {"type": "string"},
                        "children": {"$ref": f"{common_ref}ChildList"},
                    },
                    "required": ["component", "id", "children"],
                },
                "FooHeader": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "FooHeader"},
                        "id": {"type": "string"},
                        "title": {"$ref": f"{common_ref}DynamicString"},
                    },
                    "required": ["component", "id", "title"],
                },
            },
            "$defs": {
                "anyComponent": {
                    "oneOf": [
                        {"$ref": "#/components/FooPanel"},
                        {"$ref": "#/components/FooHeader"},
                    ],
                    "discriminator": {"propertyName": "component"},
                },
                "anyFunction": {"not": {}},
            },
        },
        protocol_version="1.0",
        catalog_id=foo_cid,
    )

    bar_catalog = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": bar_cid,
            "components": {
                "BarBadge": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "BarBadge"},
                        "id": {"type": "string"},
                        "tag": {"type": "string"},
                    },
                    "required": ["component", "id", "tag"],
                },
                "BarAction": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "BarAction"},
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "action": {"$ref": f"{common_ref}Action"},
                    },
                    "required": ["component", "id", "label", "action"],
                },
            },
            "$defs": {
                "anyComponent": {
                    "oneOf": [
                        {"$ref": "#/components/BarBadge"},
                        {"$ref": "#/components/BarAction"},
                    ],
                    "discriminator": {"propertyName": "component"},
                },
                "anyFunction": {"not": {}},
            },
        },
        protocol_version="1.0",
        catalog_id=bar_cid,
    )

    class FooPanel(builder_v1_0.ComponentBuilderNode):
        component: Literal["FooPanel"] = "FooPanel"
        catalog_id: str | None = foo_cid
        children: builder_v1_0.ChildList

    class FooHeader(builder_v1_0.ComponentBuilderNode):
        component: Literal["FooHeader"] = "FooHeader"
        catalog_id: str | None = foo_cid
        title: builder_v1_0.DynamicString

    class BarAction(builder_v1_0.ComponentBuilderNode):
        component: Literal["BarAction"] = "BarAction"
        catalog_id: str | None = bar_cid
        label: str
        action: builder_v1_0.Action

    @macro
    def BazMacro(
        title: builder_v1_0.DynamicString,
        cta_label: str,
        on_cta: builder_v1_0.Action,
    ) -> FooPanel:
        """Composite card combining FooCatalog layout/header with BarCatalog action."""
        return FooPanel(
            children=[
                FooHeader(title=title),
                BarAction(label=cta_label, action=on_cta),
            ]
        )

    expander = MacroExpander([BazMacro], base_catalogs=[foo_catalog, bar_catalog])
    macro_catalog = expander.to_catalog()
    assert macro_catalog.protocol_version == "1.0"

    fmt = ExpressFormat(
        catalogs=[foo_catalog, bar_catalog, macro_catalog],
        surface_id="main",
    )
    assert "BazMacro" in fmt.prompt_generator.generate()

    llm_output = (
        "<a2ui>\n"
        'surface("main")\n'
        'top_header = FooHeader("Overview")\n'
        'status_badge = BarBadge("LIVE")\n'
        "summary_card = BazMacro(\n"
        "  title=$/release/headline,\n"
        '  cta_label="Deploy",\n'
        '  on_cta={event: {name: "deploy_clicked", userMessage: "Deploy release"}}\n'
        ")\n"
        "root = FooPanel([top_header, status_badge, summary_card])\n"
        "</a2ui>"
    )
    parts = fmt.create_parser().parse_response(llm_output)
    raw_msgs = parts[0].a2ui
    assert raw_msgs is not None

    lowered = expander.transform_to_transport(raw_msgs)
    create_msgs = [m for m in lowered if isinstance(m, CreateSurfaceMessageV10)]
    assert len(create_msgs) == 1
    assert create_msgs[0].create_surface.catalog_id is None

    comps = create_msgs[0].create_surface.components
    assert comps is not None
    by_id = {c["id"]: c for c in comps}

    assert "BazMacro" not in {c["component"] for c in comps}
    for comp in comps:
        assert "catalogId" in comp
        assert comp["catalogId"] != macro_catalog.catalog_id

    assert by_id["top_header"]["catalogId"] == foo_cid
    assert by_id["status_badge"]["catalogId"] == bar_cid
    assert by_id["root"]["catalogId"] == foo_cid
    assert by_id["summary_card"]["component"] == "FooPanel"
    assert by_id["summary_card"]["catalogId"] == foo_cid
    assert by_id["summary_card__fooheader_1"]["catalogId"] == foo_cid
    assert by_id["summary_card__fooheader_1"]["title"] == {"@path": "/release/headline"}
    assert by_id["summary_card__baraction_1"]["catalogId"] == bar_cid
    assert by_id["summary_card__baraction_1"]["action"] == {
        "event": {
            "name": "deploy_clicked",
            "userMessage": "Deploy release",
        }
    }

    mp = MessageProcessor(
        [foo_catalog, bar_catalog],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )


def test_v1_0_transform_catalogs_and_sidecar_basic_catalog_end_to_end():
    """Verifies sidecar macros mixing BasicCatalog('1.0') and custom catalogs lower cleanly for MessageProcessor."""
    basic_cat = BasicCatalog("1.0")
    foo_cid = "https://example.com/catalogs/foo/v1/catalog.json"
    common_ref = "https://a2ui.org/specification/v1_0/json/common_types.json#/$defs/"

    foo_catalog = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": foo_cid,
            "components": {
                "FooBanner": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "FooBanner"},
                        "id": {"type": "string"},
                        "headline": {"$ref": f"{common_ref}DynamicString"},
                    },
                    "required": ["component", "id", "headline"],
                },
            },
            "$defs": {
                "anyComponent": {
                    "oneOf": [{"$ref": "#/components/FooBanner"}],
                    "discriminator": {"propertyName": "component"},
                },
                "anyFunction": {"not": {}},
            },
        },
        protocol_version="1.0",
        catalog_id=foo_cid,
    )

    class FooCatalogNode(builder_v1_0.ComponentBuilderNode, catalog_id=foo_cid):
        pass

    class FooBanner(FooCatalogNode):
        component: Literal["FooBanner"] = "FooBanner"
        headline: builder_v1_0.DynamicString

    @macro
    def ProductCard(
        title: builder_v1_0.DynamicString,
        price: str,
        on_buy: builder_v1_0.Action,
    ) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    FooBanner(headline=title),
                    builder_v1_0.Text(text=price, variant="caption"),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text="Buy"),
                        action=on_buy,
                        variant="primary",
                    ),
                ]
            )
        )

    # 1. Recommended transform_catalogs([basic_cat, foo_catalog]) setup
    expander = MacroExpander([ProductCard])
    inf_catalogs = expander.transform_catalogs([basic_cat, foo_catalog])
    assert len(inf_catalogs) == 3
    fmt = ExpressFormat(catalogs=inf_catalogs, surface_id="shop")

    llm_output = (
        "<a2ui>\n"
        'surface("shop")\n'
        "item_card = ProductCard(\n"
        "  title=$/product/name,\n"
        '  price="$49",\n'
        '  on_buy={event: {name: "buy_clicked", userMessage: "Buy item"}}\n'
        ")\n"
        "root = Column([item_card])\n"
        "</a2ui>"
    )
    parts = fmt.create_parser().parse_response(llm_output)
    lowered = expander.transform_to_transport(parts[0].a2ui)

    mp = MessageProcessor(
        [basic_cat, foo_catalog],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )

    # 2. Pure basic-catalog + sidecar macro catalog setup ([basic_cat, expander.to_catalog()])
    @macro
    def SimpleNotice(msg: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=msg))

    basic_expander = MacroExpander([SimpleNotice], base_catalogs=[basic_cat])
    sidecar_fmt = ExpressFormat(
        catalogs=[basic_cat, basic_expander.to_catalog()],
        surface_id="notice_surf",
    )
    sidecar_parts = sidecar_fmt.create_parser().parse_response(
        '<a2ui>\nroot = SimpleNotice(msg="Ready")\n</a2ui>'
    )
    sidecar_lowered = basic_expander.transform_to_transport(sidecar_parts[0].a2ui)
    mp_basic = MessageProcessor(
        [basic_cat],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp_basic.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in sidecar_lowered]
    )


def test_v1_0_catalog_submodels_and_noncanonical_unions_with_express():
    """Verifies TabItem, ChoicePickerOption, IconNameSvgPath, ActionEvent, and unions synthesize schemas and coerce nested wire payloads."""

    @macro
    def TabbedSelector(
        tabs: Sequence[builder_v1_0.TabItem],
        options: Sequence[builder_v1_0.ChoicePickerOption],
        icon: builder_v1_0.IconName | builder_v1_0.IconNameSvgPath,
        evt: builder_v1_0.ActionEvent,
        size: Literal["sm", "lg"] | builder_v1_0.DataBinding,
        counts: Sequence[int] | builder_v1_0.DataBinding,
    ) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Icon(name=icon),
                    builder_v1_0.Tabs(tabs=tabs),
                    builder_v1_0.ChoicePicker(
                        options=options,
                        value=["opt_a"],
                    ),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text=f"Run ({size}, {counts})"),
                        action=builder_v1_0.Action(event=evt),
                    ),
                ]
            )
        )

    basic_cat = BasicCatalog("1.0")
    expander = MacroExpander([TabbedSelector])
    inf_catalogs = expander.transform_catalogs([basic_cat])
    macro_schema = inf_catalogs[-1].to_json()["components"]["TabbedSelector"]
    props = macro_schema["properties"]

    # Sub-model schemas and non-canonical union oneOf schemas
    assert props["tabs"]["type"] == "array"
    assert props["tabs"]["items"]["properties"]["child"] == {
        "$ref": "common_types.json#/$defs/Child"
    }
    assert props["options"]["type"] == "array"
    assert props["options"]["items"]["properties"]["label"] == {
        "$ref": "common_types.json#/$defs/DynamicString"
    }
    assert "oneOf" in props["icon"]
    assert "oneOf" in props["size"]
    assert "oneOf" in props["counts"]
    assert props["counts"]["oneOf"][0] == {
        "type": "array",
        "items": {"type": "integer"},
    }

    fmt = ExpressFormat(catalogs=inf_catalogs, surface_id="submodels")
    llm_output = (
        '<a2ui>\ntab_body = Text("Overview tab content")\nroot = TabbedSelector(\n '
        ' tabs=[{title: "Overview", child: tab_body}],\n  options=[{label:'
        ' "Option A", value: "opt_a"}],\n  icon={svgPath: "M10 20v-6h4v6h5v-8h3L12'
        ' 3 2 12h3v8z"},\n  evt={name: "confirm", userMessage: "Confirm'
        ' selection"},\n  size=$/ui/size,\n  counts=[1, 2, 3]\n)\n</a2ui>'
    )
    parts = fmt.create_parser().parse_response(llm_output)
    lowered = expander.transform_to_transport(parts[0].a2ui)

    mp = MessageProcessor(
        [basic_cat],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )

    # Also verify Direct JSON / wire coercion of nested @path bindings inside sub-models
    direct_lowered = expander.transform_to_transport([
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(
                surfaceId="submodels_json",
                catalogId=basic_cat.catalog_id,
                components=[
                    {
                        "id": "tab_body",
                        "component": "Text",
                        "text": "Overview tab content",
                    },
                    {
                        "id": "root",
                        "component": "TabbedSelector",
                        "catalogId": expander.macro_catalog_id,
                        "tabs": [{
                            "title": {"@path": "/tabs/firstTitle"},
                            "child": "tab_body",
                        }],
                        "options": [
                            {"label": {"@path": "/opts/aLabel"}, "value": "opt_a"}
                        ],
                        "icon": {"svgPath": "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"},
                        "evt": {
                            "name": "confirm",
                            "userMessage": "Confirm selection",
                            "context": {"tab": {"@path": "/tabs/active"}},
                        },
                        "size": {"@path": "/ui/size"},
                        "counts": {"@path": "/ui/counts"},
                    },
                ],
            ),
        )
    ])
    mp_json = MessageProcessor(
        [basic_cat],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp_json.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in direct_lowered]
    )


def test_macro_edge_cases_parameters_name_any_dict_and_single_root():
    """Covers declared 'parameters' arg, Any dict preservation, sibling macro non-hijacking, on_error, anyComponent boundaries, and single-root checks."""

    # 1. Macro declaring a parameter literally named 'parameters' (c021)
    @macro
    def QueryCard(parameters: dict[str, Any]) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=f"limit={parameters['limit']}")
        )

    q_out = MacroExpander([QueryCard]).processor.expand(
        "QueryCard",
        {"parameters": {"limit": 25}},
        instance_id="q1",
    )
    assert q_out[0]["text"] == "limit=25"

    # 2. Untyped / Any dict with 'template' or extra keys stays a plain dict (c022)
    @macro
    def PayloadEcho(config: Any) -> builder_v1_0.Card:
        assert isinstance(config, dict)
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=config.get("template", "other"))
        )

    echo_exp = MacroExpander([PayloadEcho])
    assert (
        echo_exp.processor.expand(
            "PayloadEcho",
            {"config": {"template": "welcome", "subject": "Hi"}},
            instance_id="e1",
        )[0]["text"]
        == "welcome"
    )
    assert (
        echo_exp.processor.expand(
            "PayloadEcho",
            {"config": {"path": "/items", "componentId": "row", "extra": True}},
            instance_id="e2",
        )[0]["text"]
        == "other"
    )

    # 3. Sibling macro named 'Text' does not hijack builder_v1_0.Text on a defaultless surface (c023)
    basic_cat = BasicCatalog("1.0")
    brand_cid = "https://example.com/brand_macros.json"

    @macro(name="Text")
    def BrandText(text: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=f"[Brand] {text}"))

    @macro
    def BannerMacro(headline: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=headline))

    scoped = MacroExpander(
        [BrandText, BannerMacro],
        catalog_id=brand_cid,
        base_catalogs=[basic_cat],
    )
    lowered_defaultless = scoped.transform_to_transport([
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_def"),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_def",
                components=[{
                    "id": "root",
                    "component": "BannerMacro",
                    "catalogId": brand_cid,
                    "headline": "Plain text inside BannerMacro",
                }],
            ),
        ),
    ])
    lowered_comps = lowered_defaultless[1].update_components.components
    assert [c["component"] for c in lowered_comps] == ["Text", "Card"]
    assert lowered_comps[0]["text"] == "Plain text inside BannerMacro"

    # 4. on_error validation and raise policy (c025)
    with pytest.raises(ValueError, match="Invalid on_error"):
        MacroExpander([BannerMacro], on_error="ignore")  # type: ignore[arg-type]

    @macro
    def BrokenMultiRoot(label: str):
        return [builder_v1_0.Text(text=label), builder_v1_0.Text(text="two")]

    strict_exp = MacroExpander([BrokenMultiRoot], on_error="raise")
    with pytest.raises(A2uiValidationError, match="single root ComponentBuilderNode"):
        strict_exp.transform_to_transport([
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="s1",
                    components=[{
                        "id": "root",
                        "component": "BrokenMultiRoot",
                        "label": "bad",
                    }],
                ),
            )
        ])

    @macro
    def BrokenStrReturn(label: str):
        return label

    with pytest.raises(TypeError, match="must return a ComponentBuilderNode"):
        MacroExpander([BrokenStrReturn], protocol_version="1.0").processor.expand(
            "BrokenStrReturn", {"label": "oops"}, instance_id="r1"
        )

    # 5. $defs.anyComponent empty-catalog and full-pruning boundary cases (c026)
    empty_v10_cat = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": "https://example.com/empty.json",
            "components": {},
            "$defs": {
                "anyComponent": {"not": {}},
                "anyFunction": {"not": {}},
            },
        },
        protocol_version="1.0",
        catalog_id="https://example.com/empty.json",
    )
    aug_from_empty = MacroExpander([BannerMacro]).transform_to_inference_catalog(
        empty_v10_cat
    )
    assert aug_from_empty.to_json()["$defs"]["anyComponent"] == {
        "oneOf": [{"$ref": "#/components/BannerMacro"}],
        "discriminator": {"propertyName": "component"},
    }

    pruned_to_empty = MacroExpander(
        [], passthrough_components=[], protocol_version="1.0"
    ).transform_to_inference_catalog(basic_cat)
    assert pruned_to_empty.to_json()["$defs"]["anyComponent"] == {"not": {}}

    # 6. Order-independence of to_catalog() after transform_to_inference_catalog (c019)
    @macro
    def VersionNeutralMacro(content):
        return builder_v1_0.Card(child=builder_v1_0.Text(text=content))

    neutral_exp = MacroExpander([VersionNeutralMacro])
    assert neutral_exp.to_catalog().protocol_version == "0.9.1"
    _ = neutral_exp.transform_to_inference_catalog(basic_cat)
    assert neutral_exp.to_catalog().protocol_version == "0.9.1"

    # Unregistered primitive on defaultless surface with base_catalogs raises A2uiCatalogError
    class UnknownWidget(builder_v1_0.ComponentBuilderNode):
        component: Literal["UnknownWidget"] = "UnknownWidget"

    @macro
    def EmitsUnknown() -> UnknownWidget:
        return UnknownWidget()

    with pytest.raises(
        A2uiCatalogError, match="not found in any registered base catalog"
    ):
        MacroExpander(
            [EmitsUnknown], base_catalogs=[basic_cat]
        ).transform_to_transport([
            CreateSurfaceMessageV10(
                version="1.0",
                createSurface=CreateSurfaceV10(surfaceId="s_unk"),
            ),
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="s_unk",
                    components=[{"id": "root", "component": "EmitsUnknown"}],
                ),
            ),
        ])

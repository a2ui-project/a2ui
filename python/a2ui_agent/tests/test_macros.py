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

"""Exhaustive unit tests for A2UI Macros."""

import copy
from enum import Enum
from typing import Any, Literal, Optional, Sequence, Union

import pytest

from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    DataBinding,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
)
from a2ui.builder.v0_9.catalogs.basic import (
    Button,
    Card,
    Column,
    Row,
    Text,
)
from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import (
    A2uiCatalogError,
    A2uiValidationError,
    Catalog,
    CatalogApi,
    MessageProcessor,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema.v0_9 import UpdateComponents, UpdateComponentsMessage
from a2ui.core.schema.v1_0 import (
    CatalogDefinition as CatalogDefinitionV10,
    CreateSurface as CreateSurfaceV10,
    CreateSurfaceMessage as CreateSurfaceMessageV10,
    DeleteSurface as DeleteSurfaceV10,
    DeleteSurfaceMessage as DeleteSurfaceMessageV10,
    UpdateComponents as UpdateComponentsV10,
    UpdateComponentsMessage as UpdateComponentsMessageV10,
)
from a2ui.inference_formats.express import ExpressFormat
from a2ui.transformers.macros import (
    MacroExpander,
    macro,
)
from pydantic import TypeAdapter


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
    assert "name" in schema["properties"]
    assert schema["properties"]["name"]["type"] == "string"
    assert "age" in schema["properties"]
    assert schema["properties"]["age"]["type"] == "integer"
    assert "is_admin" in schema["properties"]
    assert schema["properties"]["is_admin"]["type"] == "boolean"
    assert schema["required"] == ["name", "age"]


def test_macro_processor_expansion():
    @macro(description="Status badge")
    def status_badge(status: str, title: str) -> Card:
        return Card(
            child=Row(
                children=[
                    Text(text=status.upper(), variant="caption"),
                    Text(text=title, variant="h3"),
                ]
            )
        )

    expander = MacroExpander([status_badge])
    flat = expander.processor.expand(
        "StatusBadge",
        args={"status": "active", "title": "Server 1"},
        instance_id="badge_main",
    )

    by_id = {c["id"]: c for c in flat}
    assert "badge_main" in by_id
    assert by_id["badge_main"]["component"] == "Card"
    row_id = by_id["badge_main"]["child"]
    assert row_id in by_id
    row_comp = by_id[row_id]
    assert row_comp["component"] == "Row"

    texts = [c for c in flat if c["component"] == "Text"]
    assert len(texts) == 2
    assert any(t["text"] == "ACTIVE" for t in texts)
    assert any(t["text"] == "Server 1" for t in texts)


def test_macro_processor_slot_coercion():
    @macro(description="Container with slot")
    def slot_container(title: str, content: ComponentBuilderNode) -> Card:
        return Card(
            child=Column(
                children=[
                    Text(text=title),
                    content,
                ]
            )
        )

    expander = MacroExpander([slot_container])
    # Pass a string ID into the ComponentBuilderNode slot parameter
    flat = expander.processor.expand(
        "SlotContainer",
        args={"title": "My Title", "content": "external_child_id"},
        instance_id="container_1",
    )

    by_id = {c["id"]: c for c in flat}
    assert "external_child_id" not in by_id
    col_comp = [c for c in flat if c["component"] == "Column"][0]
    assert "external_child_id" in col_comp["children"]


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


def test_macro_naming_conventions():
    # 1. Automatic snake_to_pascal
    @macro
    def employee_roster(team: str) -> Column:
        return Column(children=[Text(text=team)])

    meta = employee_roster.__a2ui_macro__
    assert meta is not None
    assert meta.name == "EmployeeRoster"

    # 2. Explicit positional name
    @macro("CustomAlert")
    def alert_fn(msg: str) -> Card:
        return Card(child=Text(text=msg))

    meta2 = alert_fn.__a2ui_macro__
    assert meta2 is not None
    assert meta2.name == "CustomAlert"


def make_test_catalog(
    components: Optional[dict[str, Any]] = None,
) -> CatalogApi:
    from a2ui.core.basic_catalog import BasicCatalog

    if components is None:
        return BasicCatalog("0.9.1")
    return Catalog.from_json(
        catalog_schema={"catalogId": "test", "components": components},
        protocol_version="0.9.1",
        catalog_id="test",
    )


def test_macro_expander_pipeline():
    @macro("QuickAlert")
    def quick_alert(msg: str) -> Card:
        return Card(child=Text(text=msg, variant="h4"))

    expander = MacroExpander([quick_alert])
    base = make_test_catalog({})
    inf_cat = expander.transform_to_inference_catalog(base)
    assert "QuickAlert" in inf_cat.validation_schema["components"]

    # Test lowering of macro components to transport primitives
    raw_message = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{
                "component": "QuickAlert",
                "id": "alert_instance_1",
                "msg": "Payment received!",
            }],
        ),
    )

    expanded = expander.transform_to_transport([raw_message])
    assert len(expanded) == 1
    assert isinstance(expanded[0], UpdateComponentsMessage)
    comps = expanded[0].update_components.components
    assert len(comps) == 2
    card_comp = [c for c in comps if c["component"] == "Card"][0]
    text_comp = [c for c in comps if c["component"] == "Text"][0]
    assert card_comp["id"] == "alert_instance_1"
    assert text_comp["text"] == "Payment received!"

    # Test reverse pass-through
    assert expander.transform_to_inference([raw_message]) == [raw_message]


def test_canonical_protocol_types_schema():
    class ThemeEnum(Enum):
        LIGHT = "light"
        DARK = "dark"

    @macro
    def ComplexCard(
        title: str,
        dynamic_title: DynamicString,
        metric: DynamicNumber,
        is_active: DynamicBoolean,
        tags: DynamicStringList,
        anything: DynamicValue,
        on_click: Action,
        checks: Sequence[CheckRule],
        accessibility: AccessibilityAttributes,
        footer: ComponentRef,
        items: Sequence[ComponentBuilderNode],
        theme: Literal["primary", "secondary"],
        theme_enum: ThemeEnum,
    ) -> Card:
        """Card testing all protocol common types."""
        return Card(child=Text(text="hello"))

    meta = ComplexCard.__a2ui_macro__
    assert meta is not None
    schema = meta.to_json_schema()
    props = schema["properties"]

    assert props["title"]["type"] == "string"
    assert props["dynamic_title"]["$ref"] == "common_types.json#/$defs/DynamicString"
    assert props["metric"]["$ref"] == "common_types.json#/$defs/DynamicNumber"
    assert props["is_active"]["$ref"] == "common_types.json#/$defs/DynamicBoolean"
    assert props["tags"]["$ref"] == "common_types.json#/$defs/DynamicStringList"
    assert props["anything"]["$ref"] == "common_types.json#/$defs/DynamicValue"
    assert props["on_click"]["$ref"] == "common_types.json#/$defs/Action"
    assert props["checks"]["type"] == "array"
    assert props["checks"]["items"]["$ref"] == "common_types.json#/$defs/CheckRule"
    assert (
        props["accessibility"]["$ref"]
        == "common_types.json#/$defs/AccessibilityAttributes"
    )
    assert props["footer"]["$ref"] == "common_types.json#/$defs/ComponentId"
    assert props["items"]["$ref"] == "common_types.json#/$defs/ChildList"
    assert props["theme"] == {
        "type": "string",
        "enum": ["primary", "secondary"],
        "description": "Theme",
    }
    assert props["theme_enum"] == {
        "type": "string",
        "enum": ["light", "dark"],
        "description": "Theme enum",
    }

    # Verify custom/versioned prefix can also be supplied
    custom_prefix = "https://a2ui.org/specification/v0_9/common_types.json#/$defs/"
    custom_schema = meta.to_json_schema(ref_prefix=custom_prefix)
    assert (
        custom_schema["properties"]["dynamic_title"]["$ref"]
        == f"{custom_prefix}DynamicString"
    )


def test_processor_argument_coercion():
    @macro
    def BoundCard(
        status: DynamicString,
        on_click: Action,
        slot: ComponentRef,
        accessibility: AccessibilityAttributes,
    ) -> Card:
        return Card(
            child=Column(
                children=[
                    Text(text=status),
                    Button(child=Text(text="Action"), action=on_click),
                    slot,
                ]
            )
        )

    expander = MacroExpander([BoundCard])
    expanded = expander.processor.expand(
        "BoundCard",
        {
            "status": {"path": "/servers/primary/status"},
            "on_click": "restart_server",
            "slot": "child_slot_99",
            "accessibility": {"label": "Server card"},
        },
        instance_id="card_1",
    )

    # Verify root Card ID
    card = [c for c in expanded if c["component"] == "Card"][0]
    assert card["id"] == "card_1"

    # Verify Text component has DataBinding dict
    text = [c for c in expanded if c["component"] == "Text"][0]
    assert text["text"] == {"path": "/servers/primary/status"}

    # Verify Button action was coerced from string to Action dict
    button = [c for c in expanded if c["component"] == "Button"][0]
    assert button["action"] == {"event": {"name": "restart_server"}}

    # Verify Column has the external slot child ID untouched
    col = [c for c in expanded if c["component"] == "Column"][0]
    child_ids = col["children"]
    assert "child_slot_99" in child_ids


def test_macro_parser_parse_response():
    """Verifies that MacroParser.parse_response returns ResponsePart objects with fully expanded macros."""
    from a2ui.core.basic_catalog import BasicCatalog
    from a2ui.inference_formats.express import ExpressFormat

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

    cat = BasicCatalog("0.9.1")

    expander = MacroExpander([UserInfoCard])
    inference_cat = expander.transform_to_inference_catalog(cat)

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

    # Verify that the macro was expanded into primitive components via transform_to_transport
    typed_raw_messages = parts[1].a2ui
    lowered_messages = expander.transform_to_transport(typed_raw_messages)
    components = []
    for msg in lowered_messages:
        if isinstance(msg, UpdateComponentsMessage):
            components.extend(msg.update_components.components)
    assert len(components) >= 3
    # Check that UserInfoCard is NOT in components, but Card and Text are
    comp_names = [c["component"] for c in components]
    assert "UserInfoCard" not in comp_names
    assert "Card" in comp_names
    assert "Text" in comp_names
    # Check that texts match arguments
    text_contents = [c.get("text") for c in components if c["component"] == "Text"]
    assert "Alice Smith" in text_contents
    assert "Tech Lead" in text_contents


def test_macro_catalog_pruning():
    @macro
    def MiniBadge(label: str) -> Card:
        return Card(child=Text(text=label))

    base_cat = make_test_catalog({
        "Button": {
            "type": "object",
            "properties": {"variant": {"type": "string"}},
        },
        "Card": {"type": "object", "properties": {"child": {"type": "string"}}},
        "Text": {"type": "object", "properties": {"text": {"type": "string"}}},
    })

    expander = MacroExpander([MiniBadge])
    inference_cat = expander.transform_to_inference_catalog(base_cat)
    # Prune primitives so model only sees MiniBadge and Text:
    pruned_cat = ComponentPruningTransformer(["MiniBadge", "Text"]).transform(
        inference_cat
    )
    schema = pruned_cat.validation_schema
    assert set(schema["components"]) == {"MiniBadge", "Text"}
    assert {ref["$ref"] for ref in schema["$defs"]["anyComponent"]["oneOf"]} == {
        "#/components/MiniBadge",
        "#/components/Text",
    }


def test_macro_schema_any_and_dict_types():
    @macro
    def FlexibleMacro(
        arbitrary_data: Any,
        metadata: dict[str, Any],
        raw_dict: dict,
    ) -> Card:
        """Macro accepting Any and dictionary data."""
        return Card(child=Text(text="flexible"))

    meta = FlexibleMacro.__a2ui_macro__
    assert meta is not None
    schema = meta.to_json_schema()
    props = schema["properties"]

    assert props["arbitrary_data"] == {"description": "Arbitrary data"}
    assert props["metadata"] == {"type": "object", "description": "Metadata"}
    assert props["raw_dict"] == {"type": "object", "description": "Raw dict"}


def test_macro_component_subclass_parameter_coercion():
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
    assert "header_row_id" in col["children"]
    assert "main_card_id" in col["children"]
    assert "card_sub_1" in col["children"]
    assert "card_sub_2" in col["children"]


def test_macro_expansion_failure_logs_error(caplog):
    import logging

    from a2ui.parser import Parser

    @macro
    def FailingMacro(bad_arg: str) -> Card:
        raise RuntimeError("Something exploded inside macro expansion")

    raw_message = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{
                "component": "FailingMacro",
                "id": "fail_1",
                "bad_arg": "test",
            }],
        ),
    )

    expander = MacroExpander([FailingMacro])
    with caplog.at_level(logging.ERROR):
        result = expander.transform_to_transport([raw_message])

    # Should retain unexpanded component rather than crashing
    assert len(result) == 1
    comps = result[0].update_components.components
    assert len(comps) == 1
    assert comps[0]["component"] == "FailingMacro"
    # Should have logged the error
    assert any(
        "Failed to expand macro 'FailingMacro'" in record.message
        for record in caplog.records
    )


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


def test_macro_base_catalog_collision_raises_error():
    @macro(name="Text")
    def CollidingText(content: str) -> Card:
        """Collides with primitive Text in catalog."""
        return Card(child=Text(text=content))

    base_cat = make_test_catalog({"Text": {"type": "object"}})

    expander = MacroExpander([CollidingText])
    with pytest.raises(A2uiCatalogError, match="collides with an existing component"):
        expander.transform_to_inference_catalog(base_cat)


def test_macro_expander_default_macros_empty():
    expander = MacroExpander()
    # When macros is None, it should default to empty list
    assert expander.macros == []


def test_macro_action_and_accessibility_coercion():
    @macro
    def InteractiveBanner(
        on_click: Optional[Action] = None,
        a11y: Optional[AccessibilityAttributes] = None,
    ) -> Card:
        return Card(
            child=Text(
                text="Click me",
                accessibility=a11y,
            )
        )

    expander = MacroExpander([InteractiveBanner])
    # Test action string coercion and a11y dict coercion with Optional/Union
    expanded = expander.processor.expand(
        "InteractiveBanner",
        {
            "on_click": "banner_clicked",
            "a11y": {
                "label": "Clickable banner",
                "description": "Banner description",
            },
        },
        instance_id="banner_1",
    )
    assert len(expanded) >= 1


def test_macro_expander_passthrough_components():
    @macro
    def AlertBadge(msg: str) -> Card:
        return Card(child=Text(text=msg))

    base_cat = make_test_catalog({
        "Button": {"type": "object"},
        "Card": {"type": "object"},
        "Text": {"type": "object"},
    })

    # 1. Default (None) passes through all base components
    exp_default = MacroExpander([AlertBadge])
    inf_default = exp_default.transform_to_inference_catalog(base_cat)
    assert "Button" in inf_default.validation_schema["components"]
    assert "Card" in inf_default.validation_schema["components"]
    assert "Text" in inf_default.validation_schema["components"]
    assert "AlertBadge" in inf_default.validation_schema["components"]

    # 2. Selective passthrough retains only allowed base components
    exp_selective = MacroExpander([AlertBadge], passthrough_components=["Text"])
    inf_selective = exp_selective.transform_to_inference_catalog(base_cat)
    assert "Text" in inf_selective.validation_schema["components"]
    assert "AlertBadge" in inf_selective.validation_schema["components"]
    assert "Button" not in inf_selective.validation_schema["components"]
    assert "Card" not in inf_selective.validation_schema["components"]

    # 3. Empty list retains exclusively the macros
    exp_only_macros = MacroExpander([AlertBadge], passthrough_components=[])
    inf_only_macros = exp_only_macros.transform_to_inference_catalog(base_cat)
    assert "AlertBadge" in inf_only_macros.validation_schema["components"]
    assert "Button" not in inf_only_macros.validation_schema["components"]
    assert "Card" not in inf_only_macros.validation_schema["components"]
    assert "Text" not in inf_only_macros.validation_schema["components"]


def test_macro_inference_catalog_localizes_common_type_refs():
    @macro
    def DynCard(label: DynamicString) -> Card:
        return Card(child=Text(text="hi"))

    # Base catalog with versioned prefix (hybrid catalog scenario)
    v09_prefix = "https://a2ui.org/specification/v0_9/common_types.json#/$defs/"
    cat_v09 = make_test_catalog({
        "Text": {
            "type": "object",
            "properties": {"text": {"$ref": f"{v09_prefix}DynamicString"}},
        }
    })
    base_schema = copy.deepcopy(cat_v09.validation_schema)
    exp = MacroExpander([DynCard])
    inf = exp.transform_to_inference_catalog(cat_v09)
    # Catalog.from_json normalizes external common_types refs to local #/$defs/ pointers
    assert (
        inf.validation_schema["components"]["DynCard"]["properties"]["label"]["$ref"]
        == "#/$defs/DynamicString"
    )
    assert (
        inf.validation_schema["components"]["Text"]["properties"]["text"]["$ref"]
        == "#/$defs/DynamicString"
    )
    # The base catalog remains untouched
    assert cat_v09.validation_schema == base_schema


def test_macro_expander_to_catalog():
    @macro
    def MetricBadge(title: str, count: int) -> Card:
        """A simple metric badge."""
        return Card(child=Text(text=f"{title}: {count}"))

    exp = MacroExpander([MetricBadge])
    macro_cat = exp.to_catalog()

    assert macro_cat.catalog_id == "https://a2ui.org/catalogs/macros"
    assert macro_cat.protocol_version == "0.9.1"
    assert "MetricBadge" in macro_cat.validation_schema["components"]
    assert (
        macro_cat.validation_schema["catalogId"] == "https://a2ui.org/catalogs/macros"
    )
    assert (
        macro_cat.validation_schema["components"]["MetricBadge"]["properties"]["title"][
            "type"
        ]
        == "string"
    )
    assert (
        macro_cat.validation_schema["components"]["MetricBadge"]["properties"]["count"][
            "type"
        ]
        == "integer"
    )
    any_comp = macro_cat.validation_schema["$defs"]["anyComponent"]["oneOf"]
    assert {"$ref": "#/components/MetricBadge"} in any_comp


def test_macro_envelope_fields_preservation_and_merging():
    @macro
    def StatusBadge(status: str, title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Row(
                children=[
                    builder_v1_0.Text(text=status.upper(), variant="caption"),
                    builder_v1_0.Text(text=title, variant="body"),
                ]
            ),
            accessibility=builder_v1_0.AccessibilityAttributes(
                description="Default badge description"
            ),
            extensions={"macroMeta": {"source": "StatusBadge"}},
        )

    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    a11y_input = {"label": "Server status badge"}
    meta_input = {"extensions": {"telemetry": {"traceId": "t1"}}}
    raw_message = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{
                "component": "StatusBadge",
                "id": "b1",
                "status": "ok",
                "title": "Server",
                "accessibility": a11y_input,
                "catalogId": basic_cid,
                "metadata": meta_input,
                "weight": 2.0,
            }],
        ),
    )

    expander = MacroExpander([StatusBadge])
    # Calling to_catalog() must not disable macro expansion on basic catalog surfaces
    _ = expander.to_catalog()
    result = expander.transform_to_transport([raw_message])
    assert len(result) == 1
    comps = result[0].update_components.components
    assert [c["component"] for c in comps] == ["Text", "Text", "Row", "Card"]

    for c in comps:
        assert c["catalogId"] == basic_cid

    root_card = comps[-1]
    assert root_card["id"] == "b1"
    assert root_card["weight"] == 2.0
    assert root_card["accessibility"] == {
        "label": "Server status badge",
        "description": "Default badge description",
    }
    assert root_card["metadata"] == {
        "extensions": {
            "macroMeta": {"source": "StatusBadge"},
            "telemetry": {"traceId": "t1"},
        }
    }
    # Ensure caller inputs were not mutated in-place
    assert a11y_input == {"label": "Server status badge"}
    assert meta_input == {"extensions": {"telemetry": {"traceId": "t1"}}}

    # Verify nested "parameters" dict with declared accessibility parameter
    @macro
    def CustomA11yCard(
        title: str, accessibility: AccessibilityAttributes | None = None
    ) -> Card:
        return Card(
            child=Text(text=title),
            accessibility=AccessibilityAttributes(label="Internal"),
        )

    exp_a11y = MacroExpander([CustomA11yCard])
    nested_param_msg = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{
                "component": "CustomA11yCard",
                "id": "c1",
                "parameters": {"title": "Hello"},
                "accessibility": {"label": "Passed as param"},
            }],
        ),
    )
    res_a11y = exp_a11y.transform_to_transport([nested_param_msg])
    card_out = res_a11y[0].update_components.components[-1]
    assert card_out["accessibility"] == {"label": "Internal"}


def test_macro_mixable_catalogs_scoping_and_same_named_primitive():
    brand_cid = "https://example.com/brand.json"
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

    class BrandBox(builder_v1_0.ComponentBuilderNode):
        component: Literal["BrandBox"] = "BrandBox"
        child: builder_v1_0.Child

    @macro(name="Text")
    def BrandText(text: str, variant: str = "body") -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=BrandBox(
                child=builder_v1_0.Text(
                    text=f"[Brand] {text}",
                    variant=variant,  # type: ignore[arg-type]
                )
            )
        )

    brand_base = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": brand_cid,
            "components": {
                "BrandBox": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "BrandBox"},
                        "id": {"type": "string"},
                        "child": {"type": "string"},
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/BrandBox"}]}},
        },
        protocol_version="1.0",
        catalog_id=brand_cid,
    )

    expander = MacroExpander([BrandText])
    brand_inf = expander.transform_to_inference_catalog(brand_base)
    assert "Text" in brand_inf.validation_schema["components"]
    assert "BrandBox" in brand_inf.validation_schema["components"]

    # 1. Surface defaulting to basic catalog: basic Text stays unexpanded; brand Text expands
    msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(
                surfaceId="main",
                catalogId=basic_cid,
            ),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["t_basic", "t_brand"],
                    },
                    {
                        "id": "t_basic",
                        "component": "Text",
                        "text": "Plain basic text",
                        "variant": "body",
                    },
                    {
                        "id": "t_brand",
                        "component": "Text",
                        "catalogId": brand_cid,
                        "text": "Brand title",
                        "variant": "body",
                    },
                ],
            ),
        ),
    ]

    lowered = expander.transform_to_transport(msgs)
    comps = lowered[1].update_components.components
    by_id = {c["id"]: c for c in comps}

    # Unannotated basic Text was NOT expanded
    assert by_id["t_basic"] == {
        "id": "t_basic",
        "component": "Text",
        "text": "Plain basic text",
        "variant": "body",
    }
    # Brand Text WAS expanded into Text -> BrandBox -> Card
    assert by_id["t_brand"]["component"] == "Card"
    assert "catalogId" not in by_id["t_brand"]
    brand_box = by_id["t_brand__brandbox_1"]
    assert brand_box["component"] == "BrandBox"
    # BrandBox belongs to brand_base's base components, so it gets brand_cid
    assert brand_box["catalogId"] == brand_cid
    inner_text = by_id["t_brand__text_1"]
    assert inner_text["component"] == "Text"
    assert inner_text["text"] == "[Brand] Brand title"
    assert "catalogId" not in inner_text

    # 2. Delete surface and re-create with brand_cid as surface default
    lifecycle_msgs = [
        DeleteSurfaceMessageV10(
            version="1.0",
            deleteSurface=DeleteSurfaceV10(surfaceId="main"),
        ),
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(
                surfaceId="main",
                catalogId=brand_cid,
            ),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[{
                    "id": "root",
                    "component": "Text",
                    "text": "Default brand surface text",
                    "variant": "body",
                }],
            ),
        ),
    ]
    lowered_brand_surface = expander.transform_to_transport(lifecycle_msgs)
    brand_surface_comps = lowered_brand_surface[2].update_components.components
    assert [c["component"] for c in brand_surface_comps] == [
        "Text",
        "BrandBox",
        "Card",
    ]
    assert brand_surface_comps[-1]["id"] == "root"
    assert brand_surface_comps[0]["catalogId"] == basic_cid
    assert "catalogId" not in brand_surface_comps[1]
    assert brand_surface_comps[2]["catalogId"] == basic_cid

    # Validate both lowered streams through MessageProcessor with both catalogs
    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )
    mp = MessageProcessor([basic_cat_v10, brand_base])
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_brand_surface]
    )

    # 3. Scoped MacroExpander(catalog_id=...) ignores unannotated Text when surface_catalog_id is None
    # or even if transform_to_inference_catalog is called on basic_cat_v10
    scoped_expander = MacroExpander([BrandText], catalog_id=brand_cid)
    standalone_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="untracked_surface",
            components=[
                {
                    "id": "plain_text",
                    "component": "Text",
                    "text": "Should remain plain",
                },
                {
                    "id": "empty_cid_text",
                    "component": "Text",
                    "catalogId": "",
                    "text": "Invalid empty catalogId",
                },
            ],
        ),
    )
    scoped_out = scoped_expander.transform_to_transport([standalone_msg])
    assert len(scoped_out[0].update_components.components) == 2
    assert scoped_out[0].update_components.components[0]["id"] == "plain_text"
    assert scoped_out[0].update_components.components[1]["id"] == "empty_cid_text"


def test_macro_nested_deferred_component_expansion():
    class InnerBadgeNode(ComponentBuilderNode):
        component: Literal["InnerBadge"] = "InnerBadge"
        label: str

    @macro
    def InnerBadge(label: str) -> Text:
        return Text(text=f"Badge: {label}")

    @macro
    def OuterPanel(title: str) -> Card:
        return Card(
            child=Column(
                children=[
                    Text(text=title),
                    InnerBadgeNode(label=title),
                ]
            )
        )

    expander = MacroExpander([InnerBadge, OuterPanel])
    msg = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{
                "component": "OuterPanel",
                "id": "panel_1",
                "title": "Prod",
            }],
        ),
    )
    lowered = expander.transform_to_transport([msg])
    comps = lowered[0].update_components.components
    assert [c["component"] for c in comps] == ["Text", "Text", "Column", "Card"]
    assert any(c.get("text") == "Badge: Prod" for c in comps)


def test_v1_0_canonical_protocol_types_schema():
    # Also verify that a local alias named 'name' does not collide with @macro's own locals
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
        """v1.0 card testing all protocol common types and PEP 604 unions."""
        return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    meta = ComplexCardV10.__a2ui_macro__
    assert meta is not None
    assert meta.is_v1_0 is True
    schema = meta.to_json_schema()
    props = schema["properties"]

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
        "description": "Checks",
    }
    assert (
        props["accessibility"]["$ref"]
        == "common_types.json#/$defs/AccessibilityAttributes"
    )
    assert props["footer"]["$ref"] == "common_types.json#/$defs/ComponentId"
    assert props["items"]["$ref"] == "common_types.json#/$defs/ChildList"
    assert props["fn_call"]["$ref"] == "common_types.json#/$defs/FunctionCall"
    assert props["binding"]["$ref"] == "common_types.json#/$defs/DataBinding"


def test_v1_0_processor_argument_coercion():
    @macro
    def FormPanelV10(
        status: builder_v1_0.DynamicString,
        formatted: builder_v1_0.DynamicString,
        on_submit: builder_v1_0.Action,
        on_open: builder_v1_0.Action,
        checks: Sequence[builder_v1_0.CheckRule],
        items: builder_v1_0.ChildList,
        seq_children: Sequence[builder_v1_0.Child],
        meta_obj: builder_v1_0.DynamicValue,
    ) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=status),
                    builder_v1_0.Text(text=formatted),
                    builder_v1_0.TextField(
                        label="Email",
                        value=status,
                        checks=list(checks),
                    ),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text="Submit"),
                        action=on_submit,
                    ),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text="Open"),
                        action=on_open,
                    ),
                    builder_v1_0.List(children=items),
                    builder_v1_0.Row(children=seq_children),
                ]
            ),
            extensions={"literalMeta": meta_obj}
            if isinstance(meta_obj, dict)
            else None,
        )

    expander = MacroExpander([FormPanelV10])
    expanded = expander.processor.expand(
        "FormPanelV10",
        {
            "status": {"@path": "/user/email"},
            "formatted": {
                "@call": "formatString",
                "args": {"value": "User: ${/user/email}"},
            },
            "on_submit": {
                "name": "submit_form",
                "userMessage": "Submitting email",
                "context": {"email": {"@path": "/user/email"}},
            },
            "on_open": {
                "@call": "openUrl",
                "args": {"url": "https://a2ui.org"},
            },
            "checks": [{
                "condition": {
                    "@call": "required",
                    "args": {"value": {"@path": "/user/email"}},
                },
                "message": "Email is required",
            }],
            "items": {
                "path": "/user/items",
                "componentId": "item_tmpl_1",
            },
            "seq_children": {
                "@path": "/user/rows",
                "componentId": "row_tmpl_1",
            },
            # In v1.0, {"path": "/usr/bin"} (without '@') on DynamicValue is a LiteralObject, not DataBinding
            "meta_obj": {"path": "/usr/bin"},
        },
        instance_id="form_1",
    )

    by_id = {c["id"]: c for c in expanded}
    assert by_id["form_1"]["component"] == "Card"
    assert by_id["form_1"]["metadata"] == {
        "extensions": {"literalMeta": {"path": "/usr/bin"}}
    }

    texts = [c for c in expanded if c["component"] == "Text"]
    assert any(t.get("text") == {"@path": "/user/email"} for t in texts)
    assert any(
        t.get("text")
        == {
            "@call": "formatString",
            "args": {"value": "User: ${/user/email}"},
        }
        for t in texts
    )

    tf = [c for c in expanded if c["component"] == "TextField"][0]
    assert tf["checks"] == [{
        "condition": {
            "@call": "required",
            "args": {"value": {"@path": "/user/email"}},
        },
        "message": "Email is required",
    }]

    buttons = [c for c in expanded if c["component"] == "Button"]
    assert any(
        b["action"]
        == {
            "event": {
                "name": "submit_form",
                "userMessage": "Submitting email",
                "context": {"email": {"@path": "/user/email"}},
            }
        }
        for b in buttons
    )
    assert any(
        b["action"]
        == {
            "functionCall": {
                "@call": "openUrl",
                "args": {"url": "https://a2ui.org"},
            }
        }
        for b in buttons
    )

    lst = [c for c in expanded if c["component"] == "List"][0]
    assert lst["children"] == {
        "path": "/user/items",
        "componentId": "item_tmpl_1",
    }
    row = [c for c in expanded if c["component"] == "Row"][0]
    assert row["children"] == {
        "path": "/user/rows",
        "componentId": "row_tmpl_1",
    }

    # Also verify an unannotated v1.0 macro coerces @path and @call properly
    @macro
    def UnannotatedV10Text(content):
        return builder_v1_0.Text(text=content)

    unann_exp = MacroExpander([UnannotatedV10Text])
    unann_out = unann_exp.processor.expand(
        "UnannotatedV10Text",
        {"content": {"@path": "/headline"}},
        instance_id="u1",
    )
    assert unann_out[0]["text"] == {"@path": "/headline"}


def test_v1_0_to_catalog_inference_and_explicit_version():
    @macro
    def V10Badge(label: builder_v1_0.DynamicString) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=label))

    exp_v10 = MacroExpander([V10Badge])
    cat_inferred = exp_v10.to_catalog()
    assert cat_inferred.protocol_version == "1.0"
    assert cat_inferred.validation_schema["protocolVersion"] == "1.0"
    # Validate against v1.0 CatalogDefinition schema (requires anyComponent and anyFunction in $defs)
    CatalogDefinitionV10.model_validate(cat_inferred.to_json())

    # Empty macro expander also produces a valid v1.0 CatalogDefinition
    CatalogDefinitionV10.model_validate(
        MacroExpander().to_catalog(protocol_version="1.0").to_json()
    )

    @macro
    def V09Badge(label: str) -> Card:
        return Card(child=Text(text=label))

    exp_v09 = MacroExpander([V09Badge])
    assert exp_v09.to_catalog().protocol_version == "0.9.1"
    assert exp_v09.to_catalog(protocol_version="1.0").protocol_version == "1.0"


def test_v1_0_reserved_surface_name_and_invalid_identifier_rejected():
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

    class FakeSurfaceNode(builder_v1_0.ComponentBuilderNode):
        component: Literal["Surface"] = "Surface"

    @macro
    def EmitsSurface() -> builder_v1_0.ComponentBuilderNode:
        return FakeSurfaceNode()

    expander = MacroExpander([EmitsSurface])
    msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{"id": "root", "component": "EmitsSurface"}],
        ),
    )
    with pytest.raises(A2uiValidationError, match="reserved component name 'Surface'"):
        expander.transform_to_transport([msg])


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

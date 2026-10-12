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
from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema.v0_9 import UpdateComponents, UpdateComponentsMessage
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


def make_test_catalog(components: Optional[dict[str, Any]] = None) -> CatalogApi:
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
    assert "QuickAlert" in inf_cat.catalog_schema["components"]

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
    from a2ui.inference_formats.experimental.express import ExpressFormat

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
        "Button": {"type": "object", "properties": {"variant": {"type": "string"}}},
        "Card": {"type": "object", "properties": {"child": {"type": "string"}}},
        "Text": {"type": "object", "properties": {"text": {"type": "string"}}},
    })

    expander = MacroExpander([MiniBadge])
    inference_cat = expander.transform_to_inference_catalog(base_cat)
    # Prune primitives so model only sees MiniBadge and Text:
    pruned_cat = ComponentPruningTransformer(["MiniBadge", "Text"]).transform(
        inference_cat
    )
    schema = pruned_cat.catalog_schema
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
            "a11y": {"label": "Clickable banner", "description": "Banner description"},
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
    assert "Button" in inf_default.catalog_schema["components"]
    assert "Card" in inf_default.catalog_schema["components"]
    assert "Text" in inf_default.catalog_schema["components"]
    assert "AlertBadge" in inf_default.catalog_schema["components"]

    # 2. Selective passthrough retains only allowed base components
    exp_selective = MacroExpander([AlertBadge], passthrough_components=["Text"])
    inf_selective = exp_selective.transform_to_inference_catalog(base_cat)
    assert "Text" in inf_selective.catalog_schema["components"]
    assert "AlertBadge" in inf_selective.catalog_schema["components"]
    assert "Button" not in inf_selective.catalog_schema["components"]
    assert "Card" not in inf_selective.catalog_schema["components"]

    # 3. Empty list retains exclusively the macros
    exp_only_macros = MacroExpander([AlertBadge], passthrough_components=[])
    inf_only_macros = exp_only_macros.transform_to_inference_catalog(base_cat)
    assert "AlertBadge" in inf_only_macros.catalog_schema["components"]
    assert "Button" not in inf_only_macros.catalog_schema["components"]
    assert "Card" not in inf_only_macros.catalog_schema["components"]
    assert "Text" not in inf_only_macros.catalog_schema["components"]


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
    base_schema = copy.deepcopy(cat_v09.catalog_schema)
    exp = MacroExpander([DynCard])
    inf = exp.transform_to_inference_catalog(cat_v09)
    # Catalog.from_json normalizes external common_types refs to local #/$defs/ pointers
    assert (
        inf.catalog_schema["components"]["DynCard"]["properties"]["label"]["$ref"]
        == "#/$defs/DynamicString"
    )
    assert (
        inf.catalog_schema["components"]["Text"]["properties"]["text"]["$ref"]
        == "#/$defs/DynamicString"
    )
    # The base catalog remains untouched
    assert cat_v09.catalog_schema == base_schema


def test_macro_expander_to_catalog():
    @macro
    def MetricBadge(title: str, count: int) -> Card:
        """A simple metric badge."""
        return Card(child=Text(text=f"{title}: {count}"))

    exp = MacroExpander([MetricBadge])
    macro_cat = exp.to_catalog()

    assert macro_cat.catalog_id == "https://a2ui.org/catalogs/macros"
    assert macro_cat.protocol_version == "0.9.1"
    assert "MetricBadge" in macro_cat.catalog_schema["components"]
    assert macro_cat.catalog_schema["catalogId"] == "https://a2ui.org/catalogs/macros"
    assert (
        macro_cat.catalog_schema["components"]["MetricBadge"]["properties"]["title"][
            "type"
        ]
        == "string"
    )
    assert (
        macro_cat.catalog_schema["components"]["MetricBadge"]["properties"]["count"][
            "type"
        ]
        == "integer"
    )
    any_comp = macro_cat.catalog_schema["$defs"]["anyComponent"]["oneOf"]
    assert {"$ref": "#/components/MetricBadge"} in any_comp

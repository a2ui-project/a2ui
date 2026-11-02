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
import logging
from typing import Any, Literal, Optional, Sequence

import pytest

from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    Button,
    Card,
    CheckRule,
    Column,
    ComponentBuilderNode,
    ComponentRef,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
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
    SurfaceModel,
)
from a2ui.core.basic_catalog import BasicCatalog
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
from a2ui.transformers.macros import MacroExpander, macro


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

    for comp in comps:
        assert "catalogId" not in comp

    root_card = comps[-1]
    assert root_card["id"] == "b1"
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

    # Explicit catalog_id on a v1.0 builder node is preserved on the wire
    @macro
    def ExplicitCidBadge(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=builder_v1_0.Text(text=label, catalog_id=basic_cid),
        )

    explicit_out = MacroExpander([ExplicitCidBadge]).transform_to_transport([
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[{
                    "component": "ExplicitCidBadge",
                    "id": "b_exp",
                    "catalogId": "https://example.com/macros.json",
                    "label": "Explicit",
                }],
            ),
        )
    ])
    for comp in explicit_out[0].update_components.components:
        assert comp["catalogId"] == basic_cid

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


def test_macro_weight_not_treated_as_envelope_key(caplog):
    @macro
    def PlainBadge(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=label))

    @macro
    def WeightedBadge(label: str, weight: float | None = None) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=label),
            weight=weight,
        )

    expander_plain = MacroExpander([PlainBadge])
    with pytest.raises(TypeError, match="weight"):
        expander_plain.processor.expand(
            "PlainBadge",
            {"label": "Server", "weight": 2.0},
            instance_id="b1",
        )

    undeclared_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{
                "component": "PlainBadge",
                "id": "b1",
                "label": "Server",
                "weight": 2.0,
            }],
        ),
    )
    with caplog.at_level(logging.ERROR):
        lowered_undeclared = expander_plain.transform_to_transport([undeclared_msg])
    assert lowered_undeclared[0].update_components.components[0]["component"] == (
        "PlainBadge"
    )
    assert any(
        "Failed to expand macro 'PlainBadge'" in rec.message for rec in caplog.records
    )

    expander_weighted = MacroExpander([WeightedBadge])
    declared_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{
                "component": "WeightedBadge",
                "id": "b2",
                "label": "Server",
                "weight": 2.0,
            }],
        ),
    )
    lowered_declared = expander_weighted.transform_to_transport([declared_msg])
    root_card = lowered_declared[0].update_components.components[-1]
    assert root_card["id"] == "b2"
    assert root_card["weight"] == 2.0


def test_macro_v09_gates_v10_only_envelope_fields():
    @macro
    def InfoBanner(title: str) -> Card:
        return Card(child=Text(text=title))

    basic_v09 = Catalog.from_json(
        catalog_schema=BasicCatalog("0.9.1").validation_schema,
        protocol_version="0.9.1",
        catalog_id=BasicCatalog("0.9.1").catalog_id,
    )
    expander = MacroExpander([InfoBanner])
    msg = UpdateComponentsMessage(
        version="v0.9.1",
        updateComponents=UpdateComponents(
            surfaceId="main",
            components=[{
                "component": "InfoBanner",
                "id": "root",
                "title": "Notice",
                "accessibility": {"label": "Notice banner"},
                "catalogId": "https://example.com/ignored_in_v09.json",
                "metadata": {"extensions": {"telemetry": {"traceId": "t09"}}},
            }],
        ),
    )
    lowered = expander.transform_to_transport([msg])
    comps = lowered[0].update_components.components
    assert [c["component"] for c in comps] == ["Text", "Card"]
    for c in comps:
        assert "catalogId" not in c
        assert "metadata" not in c
    assert comps[-1]["accessibility"] == {"label": "Notice banner"}

    mp = MessageProcessor(
        [basic_v09],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.model.add_surface(SurfaceModel(surface_id="main", default_catalog=basic_v09))
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )


def test_macro_non_basic_catalog_id_and_to_catalog_default_id():
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    custom_macro_cid = "https://example.com/my_catalog.json"

    @macro
    def StatusBadge(status: str, title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Row(
                children=[
                    builder_v1_0.Text(text=status.upper(), variant="caption"),
                    builder_v1_0.Text(text=title, variant="body"),
                ]
            )
        )

    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )

    # 1. Unscoped expander with non-basic explicit catalogId on a basic surface
    expander = MacroExpander([StatusBadge])
    macro_cat = expander.to_catalog()
    assert macro_cat.catalog_id == "https://a2ui.org/catalogs/macros"

    msgs_custom_cid = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s1", catalogId=basic_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s1",
                components=[{
                    "id": "root",
                    "component": "StatusBadge",
                    "catalogId": custom_macro_cid,
                    "status": "ok",
                    "title": "Healthy",
                }],
            ),
        ),
    ]
    lowered_custom = expander.transform_to_transport(msgs_custom_cid)
    for c in lowered_custom[1].update_components.components:
        assert "catalogId" not in c

    mp_basic = MessageProcessor(
        [basic_cat_v10],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp_basic.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_custom]
    )

    # 2. v1.0 surface defaulting to to_catalog().catalog_id: unannotated builder nodes
    #    are NOT auto-stamped with basic_cid; cross-catalog builder nodes declare
    #    catalog_id=basic_cid explicitly.
    msgs_macro_surface_unannotated = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(
                surfaceId="s2_unannotated", catalogId=macro_cat.catalog_id
            ),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s2_unannotated",
                components=[{
                    "id": "root",
                    "component": "StatusBadge",
                    "status": "ok",
                    "title": "Unannotated",
                }],
            ),
        ),
    ]
    lowered_unannotated = expander.transform_to_transport(
        msgs_macro_surface_unannotated
    )
    for c in lowered_unannotated[1].update_components.components:
        assert "catalogId" not in c

    @macro
    def CrossCatalogStatusBadge(status: str, title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=builder_v1_0.Row(
                catalog_id=basic_cid,
                children=[
                    builder_v1_0.Text(
                        text=status.upper(),
                        variant="caption",
                        catalog_id=basic_cid,
                    ),
                    builder_v1_0.Text(
                        text=title,
                        variant="body",
                        catalog_id=basic_cid,
                    ),
                ],
            ),
        )

    exp_cross = MacroExpander([CrossCatalogStatusBadge])
    cross_macro_cat = exp_cross.to_catalog()
    assert cross_macro_cat.protocol_version == "1.0"
    msgs_macro_surface = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(
                surfaceId="s2", catalogId=macro_cat.catalog_id
            ),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s2",
                components=[{
                    "id": "root",
                    "component": "CrossCatalogStatusBadge",
                    "status": "ok",
                    "title": "Standalone",
                }],
            ),
        ),
    ]
    lowered_macro_surface = exp_cross.transform_to_transport(msgs_macro_surface)
    for c in lowered_macro_surface[1].update_components.components:
        assert c["catalogId"] == basic_cid

    mp_mixed = MessageProcessor(
        [basic_cat_v10, cross_macro_cat],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp_mixed.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_macro_surface]
    )

    # 3. Basic-primitive-named macro tagged with default macro catalogId expands even
    #    after base catalog registration
    @macro(name="Text")
    def MacroText(text: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=f"[Macro] {text}"))

    exp_text = MacroExpander([MacroText], base_catalogs=[basic_cat_v10])
    msgs_tagged_default = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s3", catalogId=basic_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s3",
                components=[{
                    "id": "root",
                    "component": "Text",
                    "catalogId": macro_cat.catalog_id,
                    "text": "Tagged",
                }],
            ),
        ),
    ]
    lowered_tagged = exp_text.transform_to_transport(msgs_tagged_default)
    comps_tagged = lowered_tagged[1].update_components.components
    assert [c["component"] for c in comps_tagged] == ["Text", "Card"]
    for c in comps_tagged:
        assert "catalogId" not in c
    mp_basic.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_tagged]
    )


def test_macro_mixable_catalogs_scoping_and_same_named_primitive(caplog):
    brand_cid = "https://example.com/brand.json"
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

    class BrandBox(builder_v1_0.ComponentBuilderNode):
        component: Literal["BrandBox"] = "BrandBox"
        child: builder_v1_0.Child

    @macro(name="Text")
    def BrandText(text: str, variant: str = "body") -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=BrandBox(
                catalog_id=brand_cid,
                child=builder_v1_0.Text(
                    text=f"[Brand] {text}",
                    variant=variant,  # type: ignore[arg-type]
                ),
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
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
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
    assert brand_box["catalogId"] == brand_cid
    inner_text = by_id["t_brand__text_1"]
    assert inner_text["component"] == "Text"
    assert inner_text["text"] == "[Brand] Brand title"
    assert "catalogId" not in inner_text

    # 2. Delete surface and re-create with brand_cid as surface default:
    #    cross-catalog basic primitives declare catalog_id=basic_cid explicitly, while
    #    BrandBox omits catalog_id to resolve against the brand_cid surface default.
    @macro(name="Text")
    def BrandSurfaceText(text: str, variant: str = "body") -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=BrandBox(
                child=builder_v1_0.Text(
                    text=f"[Brand] {text}",
                    variant=variant,  # type: ignore[arg-type]
                    catalog_id=basic_cid,
                )
            ),
        )

    brand_surface_expander = MacroExpander(
        [BrandSurfaceText], base_catalogs=[brand_base]
    )
    _ = brand_surface_expander.transform_to_transport(msgs[:1])
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
    lowered_brand_surface = brand_surface_expander.transform_to_transport(
        lifecycle_msgs
    )
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

    # Validate both lowered streams through MessageProcessor with STRICT_VALIDATION
    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )
    mp = MessageProcessor(
        [basic_cat_v10, brand_base],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_brand_surface]
    )

    # 3. Scoped MacroExpander(catalog_id=...) ignores unannotated components when
    #    surface_catalog_id is None, even after transform_to_inference_catalog on basic_cat_v10,
    #    and logs a warning on empty/invalid catalogId
    @macro
    def BrandBadge(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=builder_v1_0.Text(text=f"[Badge] {label}", catalog_id=basic_cid),
        )

    scoped_noncolliding = MacroExpander([BrandBadge], catalog_id=brand_cid)
    _ = scoped_noncolliding.transform_to_inference_catalog(basic_cat_v10)

    scoped_expander = MacroExpander([BrandText, BrandBadge], catalog_id=brand_cid)
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
                {
                    "id": "non_str_cid_badge",
                    "component": "BrandBadge",
                    "catalogId": 123,
                    "label": "Invalid int catalogId",
                },
            ],
        ),
    )
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        scoped_out = scoped_expander.transform_to_transport([standalone_msg])
        noncolliding_out = scoped_noncolliding.transform_to_transport([
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="untracked_surface",
                    components=[{
                        "id": "b_untracked",
                        "component": "BrandBadge",
                        "label": "Skipped",
                    }],
                ),
            )
        ])
    assert len(scoped_out[0].update_components.components) == 3
    assert scoped_out[0].update_components.components[0]["id"] == "plain_text"
    assert scoped_out[0].update_components.components[1]["id"] == "empty_cid_text"
    assert scoped_out[0].update_components.components[2]["id"] == "non_str_cid_badge"
    assert (
        noncolliding_out[0].update_components.components[0]["component"] == "BrandBadge"
    )
    warning_msgs = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    debug_msgs = [r.message for r in caplog.records if r.levelno == logging.DEBUG]
    assert any(
        "empty_cid_text" in m and "invalid catalogId ''" in m for m in warning_msgs
    )
    assert any(
        "non_str_cid_badge" in m and "invalid catalogId 123" in m for m in warning_msgs
    )
    assert not any("b_untracked" in m or "plain_text" in m for m in warning_msgs)
    assert any("plain_text" in m and "untracked_surface" in m for m in debug_msgs)
    assert any("b_untracked" in m and "untracked_surface" in m for m in debug_msgs)

    # 4. Raw "catalogId": None is treated identically to unset catalogId
    null_cid_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_brand", catalogId=brand_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_brand",
                components=[{
                    "id": "root",
                    "component": "BrandBadge",
                    "catalogId": None,
                    "label": "Null cid",
                }],
            ),
        ),
    ]
    lowered_null_cid = scoped_expander.transform_to_transport(null_cid_msgs)
    assert [
        c["component"] for c in lowered_null_cid[1].update_components.components
    ] == [
        "Text",
        "Card",
    ]


def test_macro_v10_three_catalog_and_defaultless_surfaces():
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    brand_cid = "https://example.com/brand.json"
    theme_cid = "https://example.com/theme.json"

    class BrandBox(builder_v1_0.ComponentBuilderNode):
        component: Literal["BrandBox"] = "BrandBox"
        child: builder_v1_0.Child

    @macro
    def BrandCard(title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=BrandBox(
                catalog_id=brand_cid,
                child=builder_v1_0.Text(
                    text=title, variant="body", catalog_id=basic_cid
                ),
            ),
        )

    @macro
    def UnannotatedBrandCard(title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=BrandBox(child=builder_v1_0.Text(text=title, variant="body"))
        )

    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
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
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/BrandBox"}]}},
        },
        protocol_version="1.0",
        catalog_id=brand_cid,
    )
    theme_cat = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": theme_cid,
            "components": {
                "ThemeShell": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ThemeShell"},
                        "id": {"type": "string"},
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/ThemeShell"}]}},
        },
        protocol_version="1.0",
        catalog_id=theme_cid,
    )

    expander = MacroExpander(
        [BrandCard], catalog_id=brand_cid, base_catalogs=[brand_base]
    )

    # 1. Three-catalog surface: surface defaults to theme_cid, macro is in brand_cid,
    #    emitted Card and Text get basic_cid
    three_cat_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_theme", catalogId=theme_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_theme",
                components=[
                    {
                        "id": "root",
                        "component": "ThemeShell",
                        "child": "b_card",
                    },
                    {
                        "id": "b_card",
                        "component": "BrandCard",
                        "catalogId": brand_cid,
                        "title": "Welcome",
                    },
                ],
            ),
        ),
    ]
    lowered_three = expander.transform_to_transport(three_cat_msgs)
    by_id_three = {c["id"]: c for c in lowered_three[1].update_components.components}
    assert by_id_three["b_card"]["catalogId"] == basic_cid
    assert by_id_three["b_card__brandbox_1"]["catalogId"] == brand_cid
    assert by_id_three["b_card__text_1"]["catalogId"] == basic_cid

    # 2. Defaultless v1.0 surface: createSurface omits catalogId
    defaultless_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_none"),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_none",
                components=[{
                    "id": "root",
                    "component": "BrandCard",
                    "catalogId": brand_cid,
                    "title": "No default catalog",
                }],
            ),
        ),
    ]
    lowered_defaultless = expander.transform_to_transport(defaultless_msgs)
    by_id_none = {
        c["id"]: c for c in lowered_defaultless[1].update_components.components
    }
    assert by_id_none["root"]["catalogId"] == basic_cid
    assert by_id_none["root__brandbox_1"]["catalogId"] == brand_cid
    assert by_id_none["root__text_1"]["catalogId"] == basic_cid

    mp = MessageProcessor(
        [basic_cat_v10, brand_base, theme_cat],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_three]
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_defaultless]
    )

    # 3. Unannotated cross-catalog builder nodes are NOT auto-stamped with basic_cid
    #    or brand_cid even when base_catalogs are registered
    exp_unannotated = MacroExpander(
        [UnannotatedBrandCard],
        catalog_id=brand_cid,
        base_catalogs=[basic_cat_v10, brand_base],
    )
    lowered_unannotated = exp_unannotated.transform_to_transport([
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_none"),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_none",
                components=[{
                    "id": "root",
                    "component": "UnannotatedBrandCard",
                    "catalogId": brand_cid,
                    "title": "No auto stamping",
                }],
            ),
        ),
    ])
    for comp in lowered_unannotated[1].update_components.components:
        assert "catalogId" not in comp


def test_macro_explicit_base_catalogs_and_surface_catalogs_override(caplog):
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    brand_cid = "https://example.com/brand.json"

    @macro(name="Text")
    def BrandText(text: str, variant: str = "body") -> builder_v1_0.Card:
        return builder_v1_0.Card(
            catalog_id=basic_cid,
            child=builder_v1_0.Text(
                text=f"[Brand] {text}",
                variant=variant,  # type: ignore[arg-type]
                catalog_id=basic_cid,
            ),
        )

    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )
    brand_base = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": brand_cid,
            "components": {},
        },
        protocol_version="1.0",
        catalog_id=brand_cid,
    )

    shared_expander = MacroExpander(
        [BrandText], base_catalogs=[basic_cat_v10, brand_base]
    )
    update_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{
                "id": "root",
                "component": "Text",
                "text": "Session text",
                "variant": "body",
            }],
        ),
    )

    # Session A: surface defaults to brand_cid -> expands without mutating shared state
    lowered_a = shared_expander.transform_to_transport(
        [update_msg], surface_catalogs={"main": brand_cid}
    )
    assert [c["component"] for c in lowered_a[0].update_components.components] == [
        "Text",
        "Card",
    ]
    assert shared_expander._surface_catalogs == {}

    # Session B: surface defaults to basic_cid -> stays plain Text
    lowered_b = shared_expander.transform_to_transport(
        [update_msg], surface_catalogs={"main": basic_cid}
    )
    assert [c["component"] for c in lowered_b[0].update_components.components] == [
        "Text"
    ]

    # Exceeding _MAX_TRACKED_SURFACES (256) evicts oldest entry and logs debug
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        shared_expander.transform_to_transport([
            CreateSurfaceMessageV10(
                version="1.0",
                createSurface=CreateSurfaceV10(
                    surfaceId=f"surf_{i}", catalogId=basic_cid
                ),
            )
            for i in range(257)
        ])
    assert "surf_0" not in shared_expander._surface_catalogs
    assert "surf_256" in shared_expander._surface_catalogs
    assert any(
        "Evicted oldest tracked surface 'surf_0'" in r.message for r in caplog.records
    )


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

    # Verify nested deferred macro expansion under catalog_id scoping on a basic surface,
    # including a deferred inner macro that emits a custom primitive BrandBox, and verify
    # that an unannotated primitive emitted by a scoped macro is not hijacked by a sibling
    # same-name macro when the surface catalog is unregistered
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    brand_cid = "https://example.com/brand.json"

    class BrandBox(builder_v1_0.ComponentBuilderNode):
        component: Literal["BrandBox"] = "BrandBox"
        child: builder_v1_0.Child

    class InnerBadgeV10Node(builder_v1_0.ComponentBuilderNode):
        component: Literal["InnerBadgeV10"] = "InnerBadgeV10"
        label: str

    @macro(name="Text")
    def BrandText(text: str, variant: str = "body") -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Text(
                text=f"[Brand] {text}",
                variant=variant,  # type: ignore[arg-type]
            )
        )

    @macro
    def InnerBadgeV10(label: str) -> BrandBox:
        return BrandBox(
            catalog_id=brand_cid,
            child=builder_v1_0.Text(text=f"Scoped Badge: {label}", variant="caption"),
        )

    @macro
    def OuterPanelV10(title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=title, variant="body"),
                    InnerBadgeV10Node(label=title, catalog_id=brand_cid),
                ]
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
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/BrandBox"}]}},
        },
        protocol_version="1.0",
        catalog_id=brand_cid,
    )

    scoped_nested = MacroExpander(
        [BrandText, InnerBadgeV10, OuterPanelV10],
        catalog_id=brand_cid,
        base_catalogs=[brand_base],
    )
    scoped_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="main", catalogId=basic_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[{
                    "id": "root",
                    "component": "OuterPanelV10",
                    "catalogId": brand_cid,
                    "title": "Staging",
                }],
            ),
        ),
    ]
    lowered_scoped = scoped_nested.transform_to_transport(scoped_msgs)
    scoped_comps = lowered_scoped[1].update_components.components
    assert [c["component"] for c in scoped_comps] == [
        "Text",
        "Text",
        "BrandBox",
        "Column",
        "Card",
    ]
    brand_box_comp = [c for c in scoped_comps if c["component"] == "BrandBox"][0]
    assert brand_box_comp["catalogId"] == brand_cid
    assert any(c.get("text") == "Scoped Badge: Staging" for c in scoped_comps)

    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )
    mp = MessageProcessor(
        [basic_cat_v10, brand_base],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_scoped]
    )

    # Also verify unannotated base primitives inside scoped macros across:
    #   (a) three-catalog surface (surface_catalog_id = theme_cid)
    #   (b) same-catalog surface (surface_catalog_id = brand_cid)
    #   (c) sibling macro hijacking on defaultless / standalone updateComponents
    #   (d) scoped same-name macro without base_catalogs on standalone / defaultless surface
    theme_cid = "https://example.com/theme.json"
    theme_cat = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": theme_cid,
            "components": {
                "ThemeShell": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ThemeShell"},
                        "id": {"type": "string"},
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/ThemeShell"}]}},
        },
        protocol_version="1.0",
        catalog_id=theme_cid,
    )

    full_scoped = MacroExpander(
        [BrandText, InnerBadgeV10, OuterPanelV10],
        catalog_id=brand_cid,
        base_catalogs=[basic_cat_v10, brand_base, theme_cat],
    )
    # (a) Three-catalog surface
    lowered_theme = full_scoped.transform_to_transport([
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_theme", catalogId=theme_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_theme",
                components=[{
                    "id": "root",
                    "component": "OuterPanelV10",
                    "catalogId": brand_cid,
                    "title": "ThemeTitle",
                }],
            ),
        ),
    ])
    assert [c["component"] for c in lowered_theme[1].update_components.components] == [
        "Text",
        "Text",
        "BrandBox",
        "Column",
        "Card",
    ]
    assert not any(
        str(c.get("text", "")).startswith("[Brand]")
        for c in lowered_theme[1].update_components.components
    )

    # (b) Same-catalog surface (surface_catalog_id = brand_cid)
    lowered_same = full_scoped.transform_to_transport([
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_brand", catalogId=brand_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_brand",
                components=[{
                    "id": "root",
                    "component": "Text",
                    "text": "BrandOnly",
                }],
            ),
        ),
    ])
    assert [c["component"] for c in lowered_same[1].update_components.components] == [
        "Text",
        "Card",
    ]
    assert (
        lowered_same[1].update_components.components[0]["text"] == "[Brand] BrandOnly"
    )

    # (c) Defaultless surface & standalone updateComponents do not hijack plain Text child
    for standalone_or_defaultless in (
        [
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
                        "component": "OuterPanelV10",
                        "catalogId": brand_cid,
                        "title": "PlainTitle",
                    }],
                ),
            ),
        ],
        [
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="s_untracked",
                    components=[{
                        "id": "root",
                        "component": "OuterPanelV10",
                        "catalogId": brand_cid,
                        "title": "PlainTitle",
                    }],
                ),
            ),
        ],
    ):
        lowered_c = full_scoped.transform_to_transport(standalone_or_defaultless)
        comps_c = lowered_c[-1].update_components.components
        assert [c["component"] for c in comps_c] == [
            "Text",
            "Text",
            "BrandBox",
            "Column",
            "Card",
        ]
        assert not any(str(c.get("text", "")).startswith("[Brand]") for c in comps_c)

    # (d) Scoped same-name macro without base_catalogs on standalone / defaultless surface
    bare_scoped = MacroExpander([BrandText], catalog_id=brand_cid)
    lowered_bare = bare_scoped.transform_to_transport([
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_bare",
                components=[{
                    "id": "root",
                    "component": "Text",
                    "catalogId": brand_cid,
                    "text": "NoBaseCatalogs",
                }],
            ),
        )
    ])
    assert [c["component"] for c in lowered_bare[0].update_components.components] == [
        "Text",
        "Card",
    ]


def test_macro_custom_catalog_collision_and_same_name_wrapper(caplog):
    basic_cid = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    cat_a_cid = "https://example.com/catalog_a.json"
    cat_b_cid = "https://example.com/catalog_b.json"

    # 1. Custom catalog A has primitive ProductCard; custom catalog B has macro ProductCard
    @macro
    def ProductCard(name: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=builder_v1_0.Text(text=f"Product: {name}"))

    cat_a = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": cat_a_cid,
            "components": {
                "ProductCard": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ProductCard"},
                        "id": {"type": "string"},
                        "sku": {"type": "string"},
                    },
                    "required": ["component", "id", "sku"],
                }
            },
            "$defs": {
                "anyComponent": {"oneOf": [{"$ref": "#/components/ProductCard"}]}
            },
        },
        protocol_version="1.0",
        catalog_id=cat_a_cid,
    )
    cat_b = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": cat_b_cid,
            "components": {},
        },
        protocol_version="1.0",
        catalog_id=cat_b_cid,
    )

    expander = MacroExpander([ProductCard], base_catalogs=[cat_b])
    collision_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="main", catalogId=basic_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="main",
                components=[
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["p_cat_a", "p_cat_b"],
                    },
                    {
                        "id": "p_cat_a",
                        "component": "ProductCard",
                        "catalogId": cat_a_cid,
                        "sku": "SKU-1",
                    },
                    {
                        "id": "p_cat_b",
                        "component": "ProductCard",
                        "catalogId": cat_b_cid,
                        "name": "Widget",
                    },
                ],
            ),
        ),
    ]
    lowered_collision = expander.transform_to_transport(collision_msgs)
    by_id = {c["id"]: c for c in lowered_collision[1].update_components.components}
    assert by_id["p_cat_a"]["component"] == "ProductCard"
    assert by_id["p_cat_a"]["sku"] == "SKU-1"
    assert by_id["p_cat_b"]["component"] == "Card"
    assert by_id["p_cat_b__text_1"]["text"] == "Product: Widget"

    # 2. Same-name custom primitive wrapper passes through without re-entry or error logs
    class BrandBoxNode(builder_v1_0.ComponentBuilderNode):
        component: Literal["BrandBox"] = "BrandBox"
        child: builder_v1_0.Child

    @macro(name="BrandBox")
    def BrandBoxMacro(title: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=BrandBoxNode(
                catalog_id=cat_a_cid,
                child=builder_v1_0.Text(text=title),
            )
        )

    brand_primitives = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": cat_a_cid,
            "components": {
                "BrandBox": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "BrandBox"},
                        "id": {"type": "string"},
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                }
            },
            "$defs": {"anyComponent": {"oneOf": [{"$ref": "#/components/BrandBox"}]}},
        },
        protocol_version="1.0",
        catalog_id=cat_a_cid,
    )

    wrapper_expander = MacroExpander(
        [BrandBoxMacro],
        passthrough_components=[],
        base_catalogs=[brand_primitives],
    )
    caplog.clear()
    with caplog.at_level(logging.ERROR):
        lowered_wrapper = wrapper_expander.transform_to_transport([
            CreateSurfaceMessageV10(
                version="1.0",
                createSurface=CreateSurfaceV10(surfaceId="s_wrap", catalogId=basic_cid),
            ),
            UpdateComponentsMessageV10(
                version="1.0",
                updateComponents=UpdateComponentsV10(
                    surfaceId="s_wrap",
                    components=[{
                        "id": "root",
                        "component": "BrandBox",
                        "catalogId": cat_a_cid,
                        "title": "Wrapped",
                    }],
                ),
            ),
        ])
    assert not caplog.records
    wrap_comps = lowered_wrapper[1].update_components.components
    assert [c["component"] for c in wrap_comps] == ["Text", "BrandBox", "Card"]

    basic_cat_v10 = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=basic_cid,
    )
    mp = MessageProcessor(
        [basic_cat_v10, brand_primitives],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    mp.process_messages(
        [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_wrapper]
    )

    # 3. Genuine deferred self-recursion still raises A2uiRecursionError
    class DeferredCycleNode(ComponentBuilderNode):
        component: Literal["DeferredCycle"] = "DeferredCycle"
        label: str

    @macro
    def DeferredCycle(label: str) -> Card:
        return Card(child=DeferredCycleNode(label=label))

    cycle_expander = MacroExpander([DeferredCycle])
    with pytest.raises(A2uiRecursionError):
        cycle_expander.transform_to_transport([
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

    # Deferred self-recursion and mutual recursion also raise A2uiRecursionError when
    # enclosing_catalog_id is non-None across:
    #   (a) standalone updateComponents (surface_catalog_id is None)
    #   (b) defaultless v1.0 surface (createSurface without catalogId)
    #   (c) foreign-default surface when surface catalog's base_catalogs are registered
    class DeferredCycleV10Node(builder_v1_0.ComponentBuilderNode):
        component: Literal["DeferredCycle"] = "DeferredCycle"
        label: str

    @macro(name="DeferredCycle")
    def DeferredCycleV10(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=DeferredCycleV10Node(label=label))

    class CycleANode(builder_v1_0.ComponentBuilderNode):
        component: Literal["CycleA"] = "CycleA"
        label: str

    class CycleBNode(builder_v1_0.ComponentBuilderNode):
        component: Literal["CycleB"] = "CycleB"
        label: str

    @macro
    def CycleA(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=CycleBNode(label=label))

    @macro
    def CycleB(label: str) -> builder_v1_0.Card:
        return builder_v1_0.Card(child=CycleANode(label=label))

    scoped_cycle_expander = MacroExpander(
        [DeferredCycleV10, CycleA, CycleB],
        catalog_id=cat_b_cid,
        base_catalogs=[basic_cat_v10],
    )
    for cyclic_comp in ("DeferredCycle", "CycleA"):
        # (a) Standalone updateComponents with explicit catalogId
        with pytest.raises(A2uiRecursionError):
            scoped_cycle_expander.transform_to_transport([
                UpdateComponentsMessageV10(
                    version="1.0",
                    updateComponents=UpdateComponentsV10(
                        surfaceId="untracked_cycle",
                        components=[{
                            "id": "root",
                            "component": cyclic_comp,
                            "catalogId": cat_b_cid,
                            "label": "loop",
                        }],
                    ),
                )
            ])
        # (b) Defaultless v1.0 surface with explicit catalogId
        with pytest.raises(A2uiRecursionError):
            scoped_cycle_expander.transform_to_transport([
                CreateSurfaceMessageV10(
                    version="1.0",
                    createSurface=CreateSurfaceV10(surfaceId="defaultless_cycle"),
                ),
                UpdateComponentsMessageV10(
                    version="1.0",
                    updateComponents=UpdateComponentsV10(
                        surfaceId="defaultless_cycle",
                        components=[{
                            "id": "root",
                            "component": cyclic_comp,
                            "catalogId": cat_b_cid,
                            "label": "loop",
                        }],
                    ),
                ),
            ])
        # (c) Foreign-default surface (basic_cid) with registered base_catalogs
        with pytest.raises(A2uiRecursionError):
            scoped_cycle_expander.transform_to_transport([
                CreateSurfaceMessageV10(
                    version="1.0",
                    createSurface=CreateSurfaceV10(
                        surfaceId="foreign_cycle", catalogId=basic_cid
                    ),
                ),
                UpdateComponentsMessageV10(
                    version="1.0",
                    updateComponents=UpdateComponentsV10(
                        surfaceId="foreign_cycle",
                        components=[{
                            "id": "root",
                            "component": cyclic_comp,
                            "catalogId": cat_b_cid,
                            "label": "loop",
                        }],
                    ),
                ),
            ])

    # 4. Non-basic custom catalog same-name primitive collision (@macro(name="Chart")
    #    scoped to brand.json emitting unannotated Chart on a charts.json surface)
    charts_cid = "https://example.com/charts.json"
    brand_cid = "https://example.com/brand.json"

    class ChartNode(builder_v1_0.ComponentBuilderNode):
        component: Literal["Chart"] = "Chart"
        series: str

    class ChartCardNode(builder_v1_0.ComponentBuilderNode):
        component: Literal["ChartCard"] = "ChartCard"
        child: builder_v1_0.Child

    @macro(name="Chart")
    def BrandChart(series: str) -> ChartCardNode:
        return ChartCardNode(child=ChartNode(series=f"[Brand] {series}"))

    charts_cat = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": charts_cid,
            "components": {
                "Chart": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Chart"},
                        "id": {"type": "string"},
                        "series": {"type": "string"},
                    },
                    "required": ["component", "id", "series"],
                },
                "ChartCard": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ChartCard"},
                        "id": {"type": "string"},
                        "child": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ComponentId"
                            )
                        },
                    },
                    "required": ["component", "id", "child"],
                },
                "ChartGrid": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ChartGrid"},
                        "id": {"type": "string"},
                        "children": {
                            "$ref": (
                                "https://a2ui.org/specification/v1_0/json/"
                                "common_types.json#/$defs/ChildList"
                            )
                        },
                    },
                    "required": ["component", "id", "children"],
                },
            },
            "$defs": {
                "anyComponent": {
                    "oneOf": [
                        {"$ref": "#/components/Chart"},
                        {"$ref": "#/components/ChartCard"},
                        {"$ref": "#/components/ChartGrid"},
                    ]
                }
            },
        },
        protocol_version="1.0",
        catalog_id=charts_cid,
    )
    brand_chart_cat = Catalog.from_json(
        catalog_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": "1.0",
            "catalogId": brand_cid,
            "components": {},
        },
        protocol_version="1.0",
        catalog_id=brand_cid,
    )
    chart_msgs = [
        CreateSurfaceMessageV10(
            version="1.0",
            createSurface=CreateSurfaceV10(surfaceId="s_charts", catalogId=charts_cid),
        ),
        UpdateComponentsMessageV10(
            version="1.0",
            updateComponents=UpdateComponentsV10(
                surfaceId="s_charts",
                components=[
                    {
                        "id": "root",
                        "component": "ChartGrid",
                        "children": ["c_brand", "c_plain"],
                    },
                    {
                        "id": "c_brand",
                        "component": "Chart",
                        "catalogId": brand_cid,
                        "series": "revenue",
                    },
                    {
                        "id": "c_plain",
                        "component": "Chart",
                        "series": "latency",
                    },
                ],
            ),
        ),
    ]

    for chart_expander in (
        MacroExpander([BrandChart], catalog_id=brand_cid),
        MacroExpander([BrandChart], base_catalogs=[charts_cat, brand_chart_cat]),
    ):
        lowered_charts = chart_expander.transform_to_transport(chart_msgs)
        charts_by_id = {
            c["id"]: c for c in lowered_charts[1].update_components.components
        }
        assert charts_by_id["c_plain"] == {
            "id": "c_plain",
            "component": "Chart",
            "series": "latency",
        }
        assert charts_by_id["c_brand"] == {
            "id": "c_brand",
            "component": "ChartCard",
            "child": "c_brand__chart_1",
        }
        assert charts_by_id["c_brand__chart_1"] == {
            "id": "c_brand__chart_1",
            "component": "Chart",
            "series": "[Brand] revenue",
        }
        mp_charts = MessageProcessor(
            [charts_cat, brand_chart_cat],
            options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
        )
        mp_charts.process_messages(
            [m.model_dump(by_alias=True, exclude_none=True) for m in lowered_charts]
        )


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


def _define_macro_with_unresolved_hint() -> Any:
    """Module-level helper whose string annotation must not resolve from caller locals."""

    @macro
    def UnresolvedHintCard(x: "CallerFrameShadowType") -> builder_v1_0.Card:  # noqa: F821
        return builder_v1_0.Card(child=builder_v1_0.Text(text=str(x)))

    return UnresolvedHintCard


def test_v1_0_processor_argument_coercion():
    @macro
    def FormPanelV10(
        status: builder_v1_0.DynamicString,
        formatted: builder_v1_0.DynamicString,
        on_submit: builder_v1_0.Action,
        on_cancel: builder_v1_0.Action,
        on_open: builder_v1_0.Action,
        checks: Sequence[builder_v1_0.CheckRule],
        items: builder_v1_0.ChildList,
        seq_children: Sequence[builder_v1_0.Child],
        meta_obj: builder_v1_0.DynamicValue,
        call_meta: builder_v1_0.DynamicValue,
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
                        child=builder_v1_0.Text(text="Cancel"),
                        action=on_cancel,
                    ),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text="Open"),
                        action=on_open,
                    ),
                    builder_v1_0.List(children=items),
                    builder_v1_0.Row(children=seq_children),
                ]
            ),
            extensions={
                "literalMeta": meta_obj,
                "callMeta": call_meta,
            }
            if isinstance(meta_obj, dict) and isinstance(call_meta, dict)
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
            "on_cancel": {
                "event": "cancel_form",
                "userMessage": "Cancelling form",
                "context": {"step": 2},
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
            "seq_children": ["row_child_1", "row_child_2"],
            # In v1.0, plain {"path": ...} and {"call": ...} (without '@') on DynamicValue stay LiteralObject dicts
            "meta_obj": {"path": "/usr/bin"},
            "call_meta": {"call": "1-800-555-0199", "ext": "123"},
        },
        instance_id="form_1",
    )

    by_id = {c["id"]: c for c in expanded}
    assert by_id["form_1"]["component"] == "Card"
    assert by_id["form_1"]["metadata"] == {
        "extensions": {
            "literalMeta": {"path": "/usr/bin"},
            "callMeta": {"call": "1-800-555-0199", "ext": "123"},
        }
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
            "event": {
                "name": "cancel_form",
                "userMessage": "Cancelling form",
                "context": {"step": 2},
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
    assert row["children"] == ["row_child_1", "row_child_2"]

    # Plain Sequence[Child] (unlike ChildList) rejects DynamicChildList dicts
    with pytest.raises(TypeError, match="seq_children"):
        expander.processor.expand(
            "FormPanelV10",
            {
                "status": "ok",
                "formatted": "ok",
                "on_submit": "submit",
                "on_cancel": "cancel",
                "on_open": "open",
                "checks": [],
                "items": [],
                "seq_children": {
                    "path": "/user/rows",
                    "componentId": "row_tmpl_1",
                },
                "meta_obj": {},
                "call_meta": {},
            },
            instance_id="form_bad",
        )

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
    badge_schema = cat_inferred.validation_schema["components"]["V10Badge"]
    assert badge_schema["properties"]["component"] == {"const": "V10Badge"}
    assert "component" in badge_schema["required"]

    # Validate against v1.0 CatalogDefinition schema and MessageProcessor (discriminator check)
    CatalogDefinitionV10.model_validate(cat_inferred.to_json())
    mp = MessageProcessor([cat_inferred])
    mp.process_messages([
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": cat_inferred.catalog_id,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {"id": "root", "component": "V10Badge", "label": "Ready"}
                ],
            },
        },
    ])

    # Empty macro expander also produces a valid v1.0 CatalogDefinition
    CatalogDefinitionV10.model_validate(
        MacroExpander().to_catalog(protocol_version="1.0").to_json()
    )

    @macro
    def V09Badge(label: str) -> Card:
        return Card(child=Text(text=label))

    exp_v09 = MacroExpander([V09Badge])
    assert exp_v09.to_catalog().protocol_version == "0.9.1"
    with pytest.raises(A2uiValidationError, match="Cannot export v0.9 macros"):
        exp_v09.to_catalog(protocol_version="1.0")


def test_single_version_enforcement_rejects_mixing():
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

    v10_base = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=BasicCatalog("1.0").catalog_id,
    )
    v09_base = Catalog.from_json(
        catalog_schema=BasicCatalog("0.9").validation_schema,
        protocol_version="0.9.1",
        catalog_id=BasicCatalog("0.9").catalog_id,
    )

    with pytest.raises(A2uiValidationError, match="Cannot register"):
        MacroExpander([V09Only], base_catalogs=[v10_base])

    with pytest.raises(A2uiValidationError, match="Cannot register"):
        MacroExpander(base_catalogs=[v09_base, v10_base])

    with pytest.raises(A2uiValidationError, match="Cannot augment"):
        MacroExpander([V09Only]).transform_to_inference_catalog(v10_base)

    with pytest.raises(A2uiValidationError, match="Cannot augment"):
        MacroExpander([V10Only]).transform_to_inference_catalog(v09_base)

    v10_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="s1",
            components=[{"id": "root", "component": "V09Only", "label": "hi"}],
        ),
    )
    v09_msg = UpdateComponentsMessage(
        version="v0.9",
        updateComponents=UpdateComponents(
            surfaceId="s1",
            components=[{"id": "root", "component": "V10Only", "label": "hi"}],
        ),
    )
    with pytest.raises(A2uiValidationError, match="Cannot lower"):
        MacroExpander([V09Only]).transform_to_transport([v10_msg])

    with pytest.raises(A2uiValidationError, match="Cannot lower"):
        MacroExpander([V10Only]).transform_to_transport([v09_msg])


def test_macro_version_detection_custom_subclasses_expander_version_and_frame_isolation(
    caplog,
):
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

    # Inferring v1.0 from base_catalogs for an untyped macro also exports a v1.0 catalog
    v10_base = Catalog.from_json(
        catalog_schema=BasicCatalog("1.0").validation_schema,
        protocol_version="1.0",
        catalog_id=BasicCatalog("1.0").catalog_id,
    )
    inferred_from_base = MacroExpander([DelegatingV10Macro], base_catalogs=[v10_base])
    assert inferred_from_base.to_catalog().protocol_version == "1.0"

    # Caller frame variable must not leak into enclosing @macro annotation resolution
    CallerFrameShadowType = int  # noqa: F841
    with caplog.at_level(logging.WARNING):
        unresolved_macro = _define_macro_with_unresolved_hint()
    assert unresolved_macro.__a2ui_macro__.parameters["x"].type_hint is Any
    assert (
        "Could not resolve type annotations for macro 'UnresolvedHintCard'"
        in caplog.text
    )


def test_primitive_parameters_reject_binding_dicts():
    @macro
    def StockCard(in_stock: bool, tags: list[str]) -> builder_v1_0.Card:
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text="Buy" if in_stock else "Out")
        )

    exp = MacroExpander([StockCard])
    with pytest.raises(TypeError, match="in_stock"):
        exp.processor.expand(
            "StockCard",
            {"in_stock": {"@path": "/stock"}, "tags": ["sale"]},
            instance_id="s1",
        )
    with pytest.raises(TypeError, match="tags"):
        exp.processor.expand(
            "StockCard",
            {"in_stock": True, "tags": {"@path": "/tags"}},
            instance_id="s2",
        )


def test_author_validation_error_degrades_gracefully_and_v0_9_allows_surface_name():
    @macro
    def AuthorChecksMacro(count: int) -> builder_v1_0.Card:
        if count < 0:
            raise A2uiValidationError("count must be non-negative")
        return builder_v1_0.Card(child=builder_v1_0.Text(text=str(count)))

    exp = MacroExpander([AuthorChecksMacro])
    bad_msg = UpdateComponentsMessageV10(
        version="1.0",
        updateComponents=UpdateComponentsV10(
            surfaceId="main",
            components=[{"id": "root", "component": "AuthorChecksMacro", "count": -1}],
        ),
    )
    lowered = exp.transform_to_transport([bad_msg])
    assert lowered[0].update_components.components == [
        {"id": "root", "component": "AuthorChecksMacro", "count": -1}
    ]

    # v0.9 continues to allow a macro named 'Surface', while exporting to v1.0 rejects it
    @macro
    def Surface(title: str) -> Card:
        return Card(child=Text(text=title))

    v09_exp = MacroExpander([Surface])
    assert "Surface" in v09_exp.to_catalog().validation_schema["components"]

    @macro(name="Surface")
    def NeutralSurface(title: str):
        return title

    with pytest.raises(A2uiValidationError, match="reserved"):
        MacroExpander([NeutralSurface]).to_catalog(protocol_version="1.0")


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

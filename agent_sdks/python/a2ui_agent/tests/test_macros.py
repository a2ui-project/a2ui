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

"""Exhaustive unit tests for A2UI Macros and Typesafe Builders."""

import pytest
from a2ui.inference_formats.experimental.macros import (
    Action,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    DataBinding,
    DynamicChildList,
    ExternalComponentBuilderNode,
    FunctionCall,
    MacroInferenceFormat,
    MacroProcessor,
    Surface,
    bind,
    clear_macros,
    flatten_component_tree,
    get_macro,
    list_macros,
    macro,
)
from a2ui.inference_formats.experimental.macros.builder import (
    Button,
    Card,
    Column,
    Row,
    Text,
)


@pytest.fixture(autouse=True)
def cleanup_macros():
    clear_macros()
    yield
    clear_macros()


def test_data_binding():
    b1 = bind("user/name")
    assert b1.to_dict() == {"path": "/user/name"}

    b2 = bind("/user/name")
    assert b2.to_dict() == {"path": "/user/name"}


def test_function_call_and_action():
    fn = FunctionCall(call="formatString", args={"value": "Hello ${/user/name}"})
    assert fn.to_dict() == {
        "call": "formatString",
        "args": {"value": "Hello ${/user/name}"},
    }

    action_fn = Action(function=fn)
    assert action_fn.to_dict() == {
        "function": {
            "call": "formatString",
            "args": {"value": "Hello ${/user/name}"},
        }
    }

    action_ev = Action(event={"name": "submit_form", "data": {"id": 123}})
    assert action_ev.to_dict() == {
        "event": {"name": "submit_form", "data": {"id": 123}}
    }


def test_check_rule():
    cond = FunctionCall(call="regex", args={"pattern": "^[A-Z]"})
    rule = CheckRule(condition=cond, message="Must start with uppercase letter")
    assert rule.to_dict() == {
        "condition": {"call": "regex", "args": {"pattern": "^[A-Z]"}},
        "message": "Must start with uppercase letter",
    }


def test_dynamic_child_list():
    template = Card(child=Text(text=bind("item/title")))
    dyn = DynamicChildList(data_model_path="items", template=template)
    d = dyn.to_dict()
    assert d["dataModelPath"] == "/items"
    assert "template" in d
    assert d["template"]["component"] == "Card"


def test_flatten_single_node():
    txt = Text(text="Hello World", variant="h1")
    flat = flatten_component_tree(txt, root_id="header")
    assert len(flat) == 1
    assert flat[0]["component"] == "Text"
    assert flat[0]["id"] == "header"
    assert flat[0]["text"] == "Hello World"
    assert flat[0]["variant"] == "h1"


def test_flatten_nested_tree_with_root_anchor_and_namespacing():
    tree = Card(
        child=Column(
            children=[
                Text(text="Profile", variant="h2"),
                Text(text="Software Engineer", variant="caption"),
            ]
        )
    )

    flat = flatten_component_tree(tree, root_id="user_card_1")
    assert len(flat) == 4

    by_id = {c["id"]: c for c in flat}
    assert "user_card_1" in by_id
    root_comp = by_id["user_card_1"]
    assert root_comp["component"] == "Card"

    # Column child of Card
    col_id = root_comp["child"]
    assert col_id.startswith("user_card_1__")
    assert col_id in by_id
    col_comp = by_id[col_id]
    assert col_comp["component"] == "Column"

    # Children of Column
    children_ids = col_comp["children"]
    assert len(children_ids) == 2
    for cid in children_ids:
        assert cid.startswith("user_card_1__")
        assert cid in by_id
        assert by_id[cid]["component"] == "Text"


def test_slot_boundary_preservation_with_component_ref():
    external_slot = ComponentRef("caller_provided_child_42")

    macro_root = Card(
        child=Column(
            children=[
                Text(text="Card Header", variant="h3"),
                external_slot,
            ]
        )
    )

    flat = flatten_component_tree(macro_root, root_id="modal_dialog")

    by_id = {c["id"]: c for c in flat}
    # The external component itself MUST NOT be in the flattened output list
    assert "caller_provided_child_42" not in by_id

    # The column must reference the verbatim external ID without namespacing it
    col_comp = [c for c in flat if c["component"] == "Column"][0]
    assert "caller_provided_child_42" in col_comp["children"]
    # But internal Text must be namespaced
    assert col_comp["children"][0].startswith("modal_dialog__")


def test_flatten_sequence_of_roots():
    rows = [
        Row(children=[Text(text="Row 1")]),
        Row(children=[Text(text="Row 2")]),
    ]
    flat = flatten_component_tree(rows, root_id="table_row")
    assert len(flat) == 4
    # All rows and texts are flattened
    comps = [c["component"] for c in flat]
    assert comps.count("Row") == 2
    assert comps.count("Text") == 2


def test_surface_serialization_and_messages():
    surf = Surface(
        surface_id="home",
        root=Card(child=Text(text="Welcome")),
        data_model={"user": {"name": "Alice"}},
    )
    d = surf.to_dict()
    assert d["surfaceId"] == "home"
    assert "components" in d
    assert d["dataModel"] == {"user": {"name": "Alice"}}

    messages = surf.to_messages()
    assert len(messages) == 2
    assert "surfaceUpdate" in messages[0]
    assert messages[0]["surfaceUpdate"]["surfaceId"] == "home"
    assert "dataModelUpdate" in messages[1]
    assert messages[1]["dataModelUpdate"]["path"] == "/user"
    assert messages[1]["dataModelUpdate"]["value"] == {"name": "Alice"}


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

    meta = get_macro("profile_card")
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

    processor = MacroProcessor()
    flat = processor.expand(
        "status_badge",
        args={"status": "active", "title": "Server 1"},
        invocation_id="badge_main",
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

    processor = MacroProcessor()
    # Pass a string ID into the ComponentBuilderNode slot parameter
    flat = processor.expand(
        "slot_container",
        args={"title": "My Title", "content": "external_child_id"},
        invocation_id="container_1",
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

    meta = get_macro("MetricCard")
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

    meta = get_macro("EmployeeRoster")
    assert meta is not None
    assert meta.name == "EmployeeRoster"

    # 2. Explicit positional name
    @macro("CustomAlert")
    def alert_fn(msg: str) -> Card:
        return Card(child=Text(text=msg))

    meta2 = get_macro("CustomAlert")
    assert meta2 is not None
    assert meta2.name == "CustomAlert"


def test_macro_inference_format_pipeline():
    from a2ui.inference_formats.experimental.express.format import ExpressFormat

    @macro("QuickAlert")
    def quick_alert(msg: str) -> Card:
        return Card(child=Text(text=msg, variant="h4"))

    # Verify base_format is required
    with pytest.raises(ValueError, match="requires a base_format to be passed"):
        MacroInferenceFormat(macros=[quick_alert])  # type: ignore

    base = ExpressFormat(surface_id="main")
    inf_format = MacroInferenceFormat(base_format=base, macros=[quick_alert])
    assert "QuickAlert" in inf_format.combined_catalog.catalog_schema["components"]

    # Test parser compilation and macro expansion
    raw_message = [
        {
            "surfaceUpdate": {
                "surfaceId": "main",
                "components": [
                    {
                        "component": "QuickAlert",
                        "id": "alert_instance_1",
                        "msg": "Payment received!",
                    }
                ],
            }
        }
    ]

    from a2ui.parser.parser import Parser

    class MockUnderlyingParser(Parser):
        def has_format_content(self, content: str, *, complete: bool = False) -> bool:
            return True

        def unwrap(self, content: str):
            return []

        def compile(self, format_content: str, *, is_final: bool = True):
            return raw_message

        def parse_response(self, content: str):
            return []

        @property
        def supports_streaming(self) -> bool:
            return False

        def decompile(self, val: Any) -> str:
            return ""

        def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
            return ""

    from a2ui.inference_formats.experimental.macros import MacroParser
    macro_parser = MacroParser(MockUnderlyingParser(), processor=MacroProcessor())
    expanded = macro_parser.compile("dummy")

    assert len(expanded) == 1
    surf_update = expanded[0]["surfaceUpdate"]
    comps = surf_update["components"]
    assert len(comps) == 2
    card_comp = [c for c in comps if c["component"] == "Card"][0]
    text_comp = [c for c in comps if c["component"] == "Text"][0]
    assert card_comp["id"] == "alert_instance_1"
    assert text_comp["text"] == "Payment received!"

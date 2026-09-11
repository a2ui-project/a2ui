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

"""Tests for Phase 1 Pydantic builder models, ComponentTree, and envelope helpers."""

import pytest
from pydantic import BaseModel, ValidationError

from a2ui.builder.v0_9 import (
    Action,
    ComponentBuilderNode,
    ComponentTree,
    FunctionCall,
    bind,
    create_surface,
    flatten_component_tree,
    update_components,
)
from a2ui.builder.v0_9.catalogs.basic_catalog import (
    Button,
    Card,
    Column,
    Text,
    Image,
    Icon,
)


def test_pydantic_inheritance():
    """Verifies that builder nodes and supporting types are Pydantic BaseModels."""
    text = Text(text="Hello world")
    assert isinstance(text, BaseModel)
    assert isinstance(text, ComponentBuilderNode)
    assert text.component == "Text"
    assert text.component_name == "Text"

    action = Action(event="click")
    assert isinstance(action, BaseModel)

    binding = bind("/user/name")
    assert isinstance(binding, BaseModel)
    assert binding.path == "/user/name"


def test_strict_authoring_validation_rejects_typos():
    """Verifies that direct instantiation with misspelled attributes raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        Text(text="Hello", vairant="h1")  # typo: vairant instead of variant
    assert "vairant" in str(exc_info.value)
    assert "extra_forbidden" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Button(child=Text(text="Save"), lable="Save")  # typo: lable instead of label
    assert "lable" in str(exc_info.value)


def test_strict_enums_reject_unknown_variants():
    """Verifies that unrecognized enum string variants raise ValidationError."""
    # Standard catalog variants succeed
    t_std = Text(text="Standard Heading", variant="h1")
    assert t_std.variant == "h1"

    b_std = Button(
        child=Text(text="Click"),
        action=Action(event="click"),
        variant="primary",
    )
    assert b_std.variant == "primary"

    # Unrecognized variants fail validation immediately
    with pytest.raises(ValidationError) as exc_info:
        Text(text="Custom Display", variant="display-super-large")
    assert "variant" in str(exc_info.value)
    assert "literal_error" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Button(
            child=Text(text="Click"),
            action=Action(event="click"),
            variant="brand-gradient",
        )
    assert "variant" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Image(url="https://example.com/img.png", fit="custom-smart-crop")
    assert "fit" in str(exc_info.value)


def test_missing_required_parameters_rejected():
    """Verifies that omitting required parameters raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        Text()  # missing required 'text'
    assert "text" in str(exc_info.value)
    assert "missing" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Button(action=Action(event="click"))  # missing required 'child'
    assert "child" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Icon()  # missing required 'name'
    assert "name" in str(exc_info.value)


def test_arbitrary_objects_rejected():
    """Verifies that arbitrary un-serializable objects cannot be assigned to builder models."""

    class CustomArbitraryObject:
        pass

    with pytest.raises(ValidationError):
        Text(text=CustomArbitraryObject())  # type: ignore

    with pytest.raises(ValidationError):
        Button(
            child=CustomArbitraryObject(),  # type: ignore
            action=Action(event="click"),
        )


def test_assignment_validation_rejects_invalid_mutations():
    """Verifies that assigning invalid values to an existing model raises ValidationError."""
    t = Text(text="Valid Text", variant="h1")

    with pytest.raises(ValidationError):
        t.variant = "unrecognized_variant"  # type: ignore

    with pytest.raises(ValidationError):
        t.text = 12345  # type: ignore

    assert t.variant == "h1"
    assert t.text == "Valid Text"


def test_direct_node_serialization():
    """Verifies that node.to_components() serializes subtrees directly."""
    layout = Card(
        child=Column(
            children=[
                Text(text="Title", variant="h2"),
                Button(child=Text(text="Submit"), action=Action(event="submit")),
            ]
        )
    )

    comps = layout.to_components()
    assert len(comps) == 5
    comp_types = [c["component"] for c in comps]
    assert "Card" in comp_types
    assert "Column" in comp_types
    assert "Text" in comp_types
    assert "Button" in comp_types

    # With prefix
    prefixed_comps = layout.to_components(prefix="macro_test")
    assert any("macro_test" in c["id"] for c in prefixed_comps)


def test_component_tree_envelope_packaging():
    """Verifies ComponentTree container methods: to_components, to_update, to_surface."""
    card = Card(child=Text(text="Dashboard Info"))
    tree = ComponentTree(root=card, surface_id="dashboard")

    # 1. Flat components
    comps = tree.to_components()
    assert len(comps) == 2

    # 2. Incremental update envelope
    update_msg = tree.to_update()
    assert "updateComponents" in update_msg
    assert update_msg["updateComponents"]["surfaceId"] == "dashboard"
    assert len(update_msg["updateComponents"]["components"]) == 2

    # 3. Surface creation envelope
    surface_msgs = tree.to_surface(catalog_id="basic")
    assert len(surface_msgs) == 2
    assert "createSurface" in surface_msgs[0]
    assert surface_msgs[0]["createSurface"]["surfaceId"] == "dashboard"
    assert surface_msgs[0]["createSurface"]["catalogId"] == "basic"
    assert "updateComponents" in surface_msgs[1]


def test_top_level_envelope_helpers():
    """Verifies create_surface and update_components functional helpers."""
    root_col = Column(children=[Text(text="Status")])

    # create_surface helper emits CreateSurfaceMessage + UpdateComponentsMessage
    create_msgs = create_surface(
        "my-surface", root=root_col, catalog_id="org.a2ui.basic"
    )
    assert len(create_msgs) == 2
    assert create_msgs[0].create_surface.surface_id == "my-surface"
    assert create_msgs[0].create_surface.catalog_id == "org.a2ui.basic"
    assert create_msgs[1].update_components.surface_id == "my-surface"

    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in create_msgs]
    assert "createSurface" in dumped[0]
    assert "updateComponents" in dumped[1]

    # update_components helper emits ONLY updateComponents (does not reset surface)
    update_msgs = update_components("my-surface", root=root_col)
    assert len(update_msgs) == 1
    assert update_msgs[0].update_components.surface_id == "my-surface"


def test_component_tree_methods():
    """Verifies that ComponentTree methods and serialization work as expected."""
    card = Card(child=Text(text="Tree Test"))
    tree = ComponentTree(root=card, surface_id="s1")
    assert tree.surface_id == "s1"

    # to_components and to_json
    comps = tree.to_components()
    assert len(comps) == 2
    assert tree.to_json() is not None

    # to_update
    update_msg = tree.to_update()
    assert "updateComponents" in update_msg
    assert update_msg["updateComponents"]["surfaceId"] == "s1"

    # to_surface with data_model
    surface_msgs = tree.to_surface(
        catalog_id="basic", data_model={"user/name": "Alice"}
    )
    assert len(surface_msgs) == 3
    assert "createSurface" in surface_msgs[0]
    assert "updateComponents" in surface_msgs[1]
    assert "updateDataModel" in surface_msgs[2]
    assert surface_msgs[2]["updateDataModel"]["path"] == "/user/name"
    assert surface_msgs[2]["updateDataModel"]["value"] == "Alice"


def test_action_context_convenience():
    """Verifies Action accepts both string events and dict events with context."""
    a1 = Action(event="simple_event")
    assert a1.to_dict() == {"event": {"name": "simple_event"}}

    a2 = Action(event="server_action", context={"server": "db1", "port": 5432})
    assert a2.to_dict() == {
        "event": {
            "name": "server_action",
            "context": {"server": "db1", "port": 5432},
        }
    }


def test_static_typechecker_compiler_rejections():
    """Verifies that static type checker (mypy) halts with compiler errors on invalid syntax."""
    try:
        import mypy.api
    except ImportError:
        pytest.skip("mypy is not installed in the environment")

    # 1. Invalid enum variant
    code_bad_enum = """
from a2ui.builder.v0_9.catalogs.basic_catalog import Button, Text
from a2ui.builder.v0_9 import Action
b = Button(child=Text(text="Hi"), action=Action(event="click"), variant="invalid_variant")
"""
    normal_report, _, exit_status = mypy.api.run(["-c", code_bad_enum])
    assert exit_status != 0
    assert 'Argument "variant" to "Button" has incompatible type' in normal_report

    # 2. Misspelled argument name
    code_typo_arg = """
from a2ui.builder.v0_9.catalogs.basic_catalog import Button, Text
from a2ui.builder.v0_9 import Action
b = Button(child=Text(text="Hi"), action=Action(event="click"), lable="Save")
"""
    normal_report, _, exit_status = mypy.api.run(["-c", code_typo_arg])
    assert exit_status != 0
    assert 'Unexpected keyword argument "lable" for "Button"' in normal_report

    # 3. Invalid child type (raw string instead of component node)
    code_bad_child = """
from a2ui.builder.v0_9.catalogs.basic_catalog import Button
from a2ui.builder.v0_9 import Action
b = Button(child="not_a_component", action=Action(event="click"))
"""
    normal_report, _, exit_status = mypy.api.run(["-c", code_bad_child])
    assert exit_status != 0
    assert 'Argument "child" to "Button" has incompatible type' in normal_report


def test_id_collision_prevention():
    """Verifies that auto-generated sequential IDs never collide with user-provided IDs."""
    tree = Column(
        id="root",
        children=[
            Text(id="text_1", text="Explicit text_1"),
            Text(text="Auto-allocated text"),
        ],
    )
    comps = flatten_component_tree(tree)
    ids = [c["id"] for c in comps]
    assert len(ids) == len(set(ids)), f"Duplicate IDs detected: {ids}"
    assert "root__text_1" in ids
    assert "root__text_2" in ids


def test_tab_item_and_choice_option_models():
    """Verifies typed TabItem and ChoiceOption item models with nested child resolution."""
    from a2ui.builder.v0_9.catalogs.basic_catalog import (
        ChoiceOption,
        ChoicePicker,
        TabItem,
        Tabs,
    )

    tabs_comp = Tabs(
        id="my_tabs",
        tabs=[
            TabItem(title="Tab 1", child=Text(id="tab1_txt", text="First Tab Content")),
            TabItem(
                title="Tab 2",
                child=Button(
                    id="tab2_btn",
                    child=Text(text="Click"),
                    action=Action(event="click"),
                ),
            ),
        ],
    )
    comps = flatten_component_tree(tabs_comp)
    assert len(comps) == 4
    tabs_wire = next(c for c in comps if c["id"] == "my_tabs")
    assert tabs_wire["tabs"][0]["child"] == "my_tabs__tab1_txt"
    assert tabs_wire["tabs"][0]["title"] == "Tab 1"
    assert tabs_wire["tabs"][1]["child"] == "my_tabs__tab2_btn"

    picker = ChoicePicker(
        id="my_picker",
        value=["opt1"],
        options=[
            ChoiceOption(label="Option 1", value="opt1"),
            ChoiceOption(label="Option 2", value="opt2"),
        ],
    )
    picker_comps = flatten_component_tree(picker)
    assert len(picker_comps) == 1
    assert picker_comps[0]["options"][0] == {"label": "Option 1", "value": "opt1"}
    assert picker_comps[0]["options"][1] == {"label": "Option 2", "value": "opt2"}


def test_typed_function_call_classes():
    """Verifies typed FunctionCall classes and factory helpers."""
    from a2ui.builder.v0_9.catalogs.basic_catalog import (
        OpenUrl,
        open_url,
    )

    fn_obj = OpenUrl(url="https://example.com", call_id="c1")
    assert isinstance(fn_obj, FunctionCall)
    assert fn_obj.call == "openUrl"
    assert fn_obj.args == {"url": "https://example.com"}
    assert fn_obj.call_id == "c1"

    fn_helper = open_url(url="https://example.com", call_id="c1")
    assert isinstance(fn_helper, OpenUrl)
    assert fn_helper.to_dict() == fn_obj.to_dict()




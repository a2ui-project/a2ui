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

from a2ui.builder import (
    Action,
    AccessibilityAttributes,
    ComponentBuilderNode,
    ComponentRef,
    ComponentTree,
    DataBinding,
    DynamicChildList,
    FunctionCall,
    Surface,
    bind,
    create_surface,
    flatten_component_tree,
    update_components,
)
from a2ui.builder.catalogs.basic import (
    Button,
    Card,
    Column,
    Row,
    Text,
    Image,
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


def test_open_enums_allow_catalog_evolution():
    """Verifies that unrecognized enum string variants are accepted without error."""
    # Standard catalog variants
    t_std = Text(text="Standard Heading", variant="h1")
    assert t_std.variant == "h1"

    # Future / custom variants introduced upstream
    t_future = Text(text="Custom Display", variant="display-super-large")
    assert t_future.variant == "display-super-large"

    b_future = Button(
        child=Text(text="Click"),
        action=Action(event="click"),
        variant="brand-gradient",
    )
    assert b_future.variant == "brand-gradient"

    img_future = Image(url="https://example.com/img.png", fit="scaleDown")
    assert img_future.fit == "scaleDown"

    img_custom = Image(url="https://example.com/img.png", fit="custom-smart-crop")
    assert img_custom.fit == "custom-smart-crop"


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

    # 4. Unlinked roots and pruning
    unlinked_text = Text(text="Orphaned Widget")
    tree.unlinked_roots.append(unlinked_text)
    assert len(tree.to_components()) == 3

    tree.prune_unlinked()
    assert len(tree.unlinked_roots) == 0
    assert len(tree.to_components()) == 2


def test_top_level_envelope_helpers():
    """Verifies create_surface and update_components functional helpers."""
    root_col = Column(children=[Text(text="Status")])

    # create_surface helper emits createSurface + updateComponents
    create_msgs = create_surface("my-surface", root=root_col, catalog_id="org.a2ui.basic")
    assert len(create_msgs) == 2
    assert create_msgs[0]["createSurface"]["surfaceId"] == "my-surface"
    assert create_msgs[0]["createSurface"]["catalogId"] == "org.a2ui.basic"
    assert create_msgs[1]["updateComponents"]["surfaceId"] == "my-surface"

    # update_components helper emits ONLY updateComponents (does not reset surface)
    update_msgs = update_components("my-surface", root=root_col)
    assert len(update_msgs) == 1
    assert "updateComponents" in update_msgs[0]
    assert update_msgs[0]["updateComponents"]["surfaceId"] == "my-surface"
    assert "createSurface" not in update_msgs[0]


def test_surface_backward_compatibility():
    """Verifies that legacy Surface instantiation and methods continue to work."""
    card = Card(child=Text(text="Legacy Surface Test"))

    # Keyword root and surface_id
    s1 = Surface(surface_id="s1", root=card)
    assert s1.surface_id == "s1"
    assert len(s1.to_messages()) == 1
    assert len(s1.to_surface()) == 2

    # Positional or root-first
    s2 = Surface(root=card, surface_id="s2")
    assert s2.surface_id == "s2"
    assert s2.to_json() is not None


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

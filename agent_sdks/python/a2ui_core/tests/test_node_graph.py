# Copyright 2026 Google LLC
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

from typing import Any, Dict, List
import pytest

from a2ui.core.state import (
    ComponentModel,
    ComponentNode,
    Signal,
    SurfaceModel,
    NodeGraph,
)
from a2ui.core.basic_catalog import BasicCatalog


def test_component_node_lifecycle():
    sig = Signal({"text": "Initial"})
    node = ComponentNode(
        instance_id="inst_1",
        component_id="comp_1",
        node_type="Text",
        data_path="/",
        props=sig,
    )
    assert node.instance_id == "inst_1"
    assert node.component_id == "comp_1"
    assert node.type == "Text"
    assert node.data_path == "/"
    assert str(node) == "comp_1"
    assert (
        repr(node)
        == "ComponentNode(instance_id='inst_1', component_id='comp_1', type='Text')"
    )

    cleanup_executed = []
    node.add_cleanup(lambda: cleanup_executed.append(True))

    destroyed = []
    node.on_destroyed.subscribe(lambda _: destroyed.append(True))

    node.dispose()
    assert cleanup_executed == [True]
    assert destroyed == [True]

    # Double dispose is idempotent
    node.dispose()
    assert len(cleanup_executed) == 1


def test_surface_model_node_layer_resolution():
    catalog = BasicCatalog()
    surface = SurfaceModel("main", catalog)
    node_graph = NodeGraph(surface)

    # 1. Access root node placeholder
    node = node_graph.get_or_create_node("root", "/")
    assert node.type == "Placeholder"
    assert "root" in node_graph.active_nodes

    # 2. Add actual root component
    root_comp = ComponentModel("root", "Column", {"children": ["child_1"]})
    surface.components_model.add_component(root_comp)
    assert node_graph.rootNode.value is not None
    assert node_graph.rootNode.value.type == "Column"

    # 3. Add child component
    child_comp = ComponentModel("child_1", "Text", {"text": "Hello Node"})
    surface.components_model.add_component(child_comp)

    child_node = node_graph.get_or_create_node("child_1", "/")
    assert child_node.type == "Text"
    assert child_node.props.value.get("text") == "Hello Node"

    # 4. Deleting child component turns its reference back into progressive rendering placeholder
    surface.components_model.remove_component("child_1")
    assert node_graph.get_or_create_node("child_1", "/").type == "Placeholder"

    node_graph.dispose()
    surface.dispose()


def test_node_core_properties():
    props_signal = Signal({"title": "Test Component"})
    node = ComponentNode(
        instance_id="comp-1",
        component_id="comp-1",
        node_type="Text",
        data_path="/",
        props=props_signal,
    )

    assert node.instance_id == "comp-1"
    assert node.component_id == "comp-1"
    assert node.type == "Text"
    assert node.data_path == "/"
    assert node.props.value == {"title": "Test Component"}
    assert str(node) == "comp-1"

    destroyed = []
    node.on_destroyed.subscribe(lambda _: destroyed.append(True))
    node.dispose()
    assert destroyed == [True]


def test_surface_model_root_node_resolution():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Initial state: no root component, rootNode is None
    assert node_graph.rootNode.value is None

    # Add a root component
    root_comp = ComponentModel("root", "Column", {"children": []})
    surface.components_model.add_component(root_comp)

    assert node_graph.rootNode.value is not None
    assert isinstance(node_graph.rootNode.value, ComponentNode)
    assert node_graph.rootNode.value.component_id == "root"
    assert node_graph.rootNode.value.type == "Column"

    # Remove root component
    surface.components_model.remove_component("root")
    assert node_graph.rootNode.value is None

    node_graph.dispose()
    surface.dispose()


def test_node_layer_reactive_property_resolution():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Initialize data model
    surface.data_model.set("/username", "Alice")

    # Add a component with dynamic binding
    comp = ComponentModel("root", "Text", {"text": {"path": "/username"}})
    surface.components_model.add_component(comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None
    assert root_node.props.value["text"] == "Alice"

    # Mutate data model
    surface.data_model.set("/username", "Bob")
    assert root_node.props.value["text"] == "Bob"

    # Verify cleanup
    node_graph.dispose()
    surface.dispose()


def test_structural_child_resolution():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup parent component pointing to a child component
    parent_comp = ComponentModel("root", "Card", {"child": "text-1"})
    child_comp = ComponentModel("text-1", "Text", {"text": "Hello"})

    surface.components_model.add_component(parent_comp)
    surface.components_model.add_component(child_comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    # The "child" property should resolve to the actual ComponentNode instance, not a string ID
    child_node = root_node.props.value["child"]
    assert isinstance(child_node, ComponentNode)
    assert child_node.component_id == "text-1"
    assert child_node.props.value["text"] == "Hello"

    # Dispose of surface and verify children are disposed recursively
    child_destroyed = []
    child_node.on_destroyed.subscribe(lambda _: child_destroyed.append(True))

    node_graph.dispose()
    surface.dispose()
    assert child_destroyed == [True]


def test_template_child_list_spawning():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Set up dynamic array data
    surface.data_model.set(
        "/users", [{"name": "Alice"}, {"name": "Bob"}, {"name": "Charlie"}]
    )

    # List component using templated children
    list_comp = ComponentModel(
        "root",
        "List",
        {"children": {"componentId": "user-card", "path": "/users"}},
    )

    # Template component definition
    template_comp = ComponentModel("user-card", "Text", {"text": {"path": "name"}})

    surface.components_model.add_component(list_comp)
    surface.components_model.add_component(template_comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    # Children prop resolves to a Signal of ComponentNode list
    children_signal = root_node.props.value["children"]
    assert isinstance(children_signal, Signal)

    spawned_nodes = children_signal.value
    assert len(spawned_nodes) == 3

    # Verify instance IDs incorporate the data paths
    assert spawned_nodes[0].instance_id == "user-card-[/users/0]"
    assert spawned_nodes[1].instance_id == "user-card-[/users/1]"
    assert spawned_nodes[2].instance_id == "user-card-[/users/2]"

    # Verify scoped bindings resolved correctly for each template instance
    assert spawned_nodes[0].props.value["text"] == "Alice"
    assert spawned_nodes[1].props.value["text"] == "Bob"
    assert spawned_nodes[2].props.value["text"] == "Charlie"

    # Add a 4th item to the array
    current_users = surface.data_model.get("/users")
    surface.data_model.set("/users", current_users + [{"name": "Dave"}])

    spawned_nodes = children_signal.value
    assert len(spawned_nodes) == 4
    assert spawned_nodes[3].instance_id == "user-card-[/users/3]"
    assert spawned_nodes[3].props.value["text"] == "Dave"

    # Delete an item (shorten the array to 2 items)
    surface.data_model.set("/users", [{"name": "Alice"}, {"name": "Bob"}])
    spawned_nodes = children_signal.value
    assert len(spawned_nodes) == 2
    assert spawned_nodes[0].props.value["text"] == "Alice"
    assert spawned_nodes[1].props.value["text"] == "Bob"

    node_graph.dispose()
    surface.dispose()


def test_progressive_rendering_and_reconciliation():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Parent component references a child that hasn't arrived yet
    parent_comp = ComponentModel("root", "Card", {"child": "pending-child"})
    surface.components_model.add_component(parent_comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    # The child resolves as a Placeholder ComponentNode
    placeholder_child = root_node.props.value["child"]
    assert isinstance(placeholder_child, ComponentNode)
    assert placeholder_child.component_id == "pending-child"
    assert placeholder_child.type == "Placeholder"

    # Now the child component arrives
    real_child_comp = ComponentModel("pending-child", "Text", {"text": "Ready"})
    surface.components_model.add_component(real_child_comp)

    # The parent's property should reactively update to the newly reconciled node
    updated_child = root_node.props.value["child"]
    assert isinstance(updated_child, ComponentNode)
    assert updated_child.component_id == "pending-child"
    assert updated_child.type == "Text"
    assert updated_child.props.value["text"] == "Ready"

    node_graph.dispose()
    surface.dispose()


def test_action_binding_closures():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Data model state
    surface.data_model.set("/current_id", "u-99")

    # Button component with Action prop
    btn_comp = ComponentModel(
        "root",
        "Button",
        {
            "child": "text-id",
            "action": {
                "event": {
                    "name": "submit_form",
                    "context": {
                        "userId": {"path": "/current_id"},
                        "staticFlag": "active",
                    },
                }
            },
        },
    )
    surface.components_model.add_component(btn_comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    action_closure = root_node.props.value["action"]
    assert callable(action_closure)

    # Trigger action via the closure and catch the emitted event
    emitted_actions = []
    surface.on_action.subscribe(lambda evt: emitted_actions.append(evt))

    action_closure()

    assert len(emitted_actions) == 1
    event = emitted_actions[0]
    assert event["name"] == "submit_form"
    assert event["sourceComponentId"] == "root"
    # Context dynamic bindings should be resolved
    assert event["context"] == {"userId": "u-99", "staticFlag": "active"}

    node_graph.dispose()
    surface.dispose()


def test_unresolved_data_binding_warning_and_value():
    from a2ui.core.rendering.data_context import MissingDataBindingWarning

    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup component pointing to a missing path
    comp = ComponentModel("root", "Text", {"text": {"path": "/missing_path"}})

    with pytest.warns(
        MissingDataBindingWarning,
        match="does not physically exist in the active DataModel",
    ):
        surface.components_model.add_component(comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None
    # Unresolved path should evaluate to None
    assert root_node.props.value["text"] is None

    node_graph.dispose()
    surface.dispose()


def test_structural_child_modification():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup parent component and two potential child components
    parent_comp = ComponentModel("root", "Card", {"child": "child-1"})
    child_1 = ComponentModel("child-1", "Text", {"text": "First"})
    child_2 = ComponentModel("child-2", "Text", {"text": "Second"})

    surface.components_model.add_component(parent_comp)
    surface.components_model.add_component(child_1)
    surface.components_model.add_component(child_2)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    # Child resolves to child-1 initially
    node_1 = root_node.props.value["child"]
    assert isinstance(node_1, ComponentNode)
    assert node_1.component_id == "child-1"
    assert node_1.props.value["text"] == "First"

    # Subscribe to child-1 destruction
    node_1_destroyed = []
    node_1.on_destroyed.subscribe(lambda _: node_1_destroyed.append(True))

    # Modify parent component's child property to "child-2"
    parent_comp.properties = {"child": "child-2"}

    # Child resolves to child-2 now
    node_2 = root_node.props.value["child"]
    assert isinstance(node_2, ComponentNode)
    assert node_2.component_id == "child-2"
    assert node_2.props.value["text"] == "Second"

    # Old child should have been reactively disposed
    assert node_1_destroyed == [True]

    node_graph.dispose()
    surface.dispose()


def test_structural_children_and_template_modification():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup parent component pointing to an explicit list of children
    parent_comp = ComponentModel("root", "Column", {"children": ["c1", "c2"]})
    c1 = ComponentModel("c1", "Text", {"text": "C1"})
    c2 = ComponentModel("c2", "Text", {"text": "C2"})
    c3 = ComponentModel("c3", "Text", {"text": "C3"})

    surface.components_model.add_component(parent_comp)
    surface.components_model.add_component(c1)
    surface.components_model.add_component(c2)
    surface.components_model.add_component(c3)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    # Children resolved to c1 and c2 initially
    children = root_node.props.value["children"]
    assert len(children) == 2
    assert children[0].component_id == "c1"
    assert children[1].component_id == "c2"

    c1_destroyed = []
    children[0].on_destroyed.subscribe(lambda _: c1_destroyed.append(True))

    # Modify parent's children property to ["c2", "c3"]
    parent_comp.properties = {"children": ["c2", "c3"]}

    # Children resolved to c2 and c3 now
    new_children = root_node.props.value["children"]
    assert len(new_children) == 2
    assert new_children[0].component_id == "c2"
    assert new_children[1].component_id == "c3"

    # Removed c1 should have been reactively disposed
    assert c1_destroyed == [True]

    # Setup a dynamic template list
    surface.data_model.set("/items", [{"label": "A"}, {"label": "B"}])

    # Swap to template child list
    parent_comp.properties = {
        "children": {"componentId": "item-comp", "path": "/items"}
    }
    item_comp = ComponentModel("item-comp", "Text", {"text": {"path": "label"}})
    surface.components_model.add_component(item_comp)

    # Verify template is evaluated
    template_children_sig = root_node.props.value["children"]
    assert isinstance(template_children_sig, Signal)
    assert len(template_children_sig.value) == 2
    assert template_children_sig.value[0].props.value["text"] == "A"
    assert template_children_sig.value[1].props.value["text"] == "B"

    # Swap path to vip list
    surface.data_model.set("/vip_items", [{"label": "VIP A"}])
    parent_comp.properties = {
        "children": {"componentId": "item-comp", "path": "/vip_items"}
    }

    # Verify template is reactively swapped to new path
    new_template_children_sig = root_node.props.value["children"]
    assert len(new_template_children_sig.value) == 1
    assert new_template_children_sig.value[0].props.value["text"] == "VIP A"

    node_graph.dispose()
    surface.dispose()


def test_data_context_function_call_bindings():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Populate data model with string template arguments
    surface.data_model.set("/user/firstName", "John")
    surface.data_model.set("/user/lastName", "Doe")

    # 1. Test standard formatString function execution via node layer props resolution
    comp_1 = ComponentModel(
        "text-1",
        "Text",
        {
            "text": {
                "call": "formatString",
                "args": {"value": "Welcome, ${/user/firstName} ${/user/lastName}!"},
            }
        },
    )
    surface.components_model.add_component(comp_1)

    node_1 = node_graph.get_or_create_node("text-1", "/")
    assert node_1.props.value["text"] == "Welcome, John Doe!"

    # 2. Test static parameters validation of formatString with escaped expressions
    comp_2 = ComponentModel(
        "text-2",
        "Text",
        {
            "text": {
                "call": "formatString",
                "args": {
                    "value": r"Name: \${escaped} and real name ${/user/firstName}"
                },
            }
        },
    )
    surface.components_model.add_component(comp_2)

    node_2 = node_graph.get_or_create_node("text-2", "/")
    assert node_2.props.value["text"] == "Name: ${escaped} and real name John"

    # 3. Test catalog custom math function execution ("add" custom catalog invoker)
    class MathCatalog(BasicCatalog):

        def __init__(self):
            super().__init__()

            class AddFn:

                def execute(self, args, context=None, abort_signal=None):
                    return args.get("a", 0) + args.get("b", 0)

            self.functions["add"] = AddFn()
            self.functions["Add"] = self.functions["add"]

    math_surface = SurfaceModel("surf-2", MathCatalog())
    math_node_graph = NodeGraph(math_surface)

    comp_3 = ComponentModel(
        "text-3", "Text", {"text": {"call": "add", "args": {"a": 15, "b": 25}}}
    )
    math_surface.components_model.add_component(comp_3)

    node_3 = math_node_graph.get_or_create_node("text-3", "/")
    assert node_3.props.value["text"] == 40

    node_graph.dispose()
    surface.dispose()
    math_node_graph.dispose()
    math_surface.dispose()


def test_nested_tab_list_child_resolution():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup parent component with tabs property (list of TabItem dicts referencing children)
    parent_comp = ComponentModel(
        "root",
        "Tabs",
        {
            "tabs": [
                {"title": "Tab One", "child": "tab-content-1"},
                {"title": "Tab Two", "child": "tab-content-2"},
            ]
        },
    )
    child_1 = ComponentModel("tab-content-1", "Text", {"text": "Content A"})
    child_2 = ComponentModel("tab-content-2", "Text", {"text": "Content B"})

    surface.components_model.add_component(parent_comp)
    surface.components_model.add_component(child_1)
    surface.components_model.add_component(child_2)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    resolved_tabs = root_node.props.value["tabs"]
    assert len(resolved_tabs) == 2

    # Check that child component ID strings are resolved to actual ComponentNode objects
    tab_item_1 = resolved_tabs[0]
    assert tab_item_1["title"] == "Tab One"
    assert isinstance(tab_item_1["child"], ComponentNode)
    assert tab_item_1["child"].component_id == "tab-content-1"
    assert tab_item_1["child"].props.value["text"] == "Content A"

    tab_item_2 = resolved_tabs[1]
    assert tab_item_2["title"] == "Tab Two"
    assert isinstance(tab_item_2["child"], ComponentNode)
    assert tab_item_2["child"].component_id == "tab-content-2"
    assert tab_item_2["child"].props.value["text"] == "Content B"

    node_graph.dispose()
    surface.dispose()


def test_component_deletion_reconciliation():
    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # Setup parent referencing a child component
    parent_comp = ComponentModel("root", "Card", {"child": "target-child"})
    child_comp = ComponentModel("target-child", "Text", {"text": "Living"})

    surface.components_model.add_component(parent_comp)
    surface.components_model.add_component(child_comp)

    root_node = node_graph.rootNode.value
    assert root_node is not None

    child_node = root_node.props.value["child"]
    assert isinstance(child_node, ComponentNode)
    assert child_node.component_id == "target-child"
    assert child_node.type == "Text"

    child_destroyed = []
    child_node.on_destroyed.subscribe(lambda _: child_destroyed.append(True))

    # Delete the child component from SurfaceComponentsModel
    surface.components_model.remove_component("target-child")

    # Child node should have been reactively disposed
    assert child_destroyed == [True]

    # Parent should reactively update its child property back to a Placeholder node
    reresolved_child = root_node.props.value["child"]
    assert isinstance(reresolved_child, ComponentNode)
    assert reresolved_child.component_id == "target-child"
    assert reresolved_child.type == "Placeholder"

    node_graph.dispose()
    surface.dispose()


def test_a2ui_text_renderer_reactive_layouts():
    import sys
    import os

    sys.path.insert(0, os.path.dirname(__file__))
    from text_renderer import A2uiTextRenderer

    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # 1. Set up initial static surface components
    root_comp = ComponentModel(
        "root", "Column", {"children": ["title-comp", "card-comp"]}
    )
    title_comp = ComponentModel(
        "title-comp",
        "Text",
        {"text": "My App Dashboard", "variant": "h1"},
    )
    card_comp = ComponentModel("card-comp", "Card", {"child": "card-content"})
    card_content = ComponentModel(
        "card-content", "Text", {"text": "User Session Active"}
    )

    surface.components_model.add_component(root_comp)
    surface.components_model.add_component(title_comp)
    surface.components_model.add_component(card_comp)
    surface.components_model.add_component(card_content)

    # Instantiate renderer
    renderer = A2uiTextRenderer(node_graph)

    expected_initial = (
        "<Column>\n"
        "  <Text variant='h1'>My App Dashboard</Text>\n"
        "  <Card>\n"
        "    <Text variant='body'>User Session Active</Text>\n"
        "  </Card>\n"
        "</Column>"
    )
    assert renderer.output.value == expected_initial

    # 2. Mutate dynamic property on title-comp
    title_comp.properties = {"text": "Updated App Dashboard", "variant": "h1"}

    # Verify renderer's output reactively and automatically rebuilt!
    expected_updated = (
        "<Column>\n"
        "  <Text variant='h1'>Updated App Dashboard</Text>\n"
        "  <Card>\n"
        "    <Text variant='body'>User Session Active</Text>\n"
        "  </Card>\n"
        "</Column>"
    )
    assert renderer.output.value == expected_updated

    # 3. Set up dynamic templating under Column children
    surface.data_model.set("/items", ["Task A", "Task B"])
    root_comp.properties = {"children": {"componentId": "task-item", "path": "/items"}}
    task_item_comp = ComponentModel("task-item", "Text", {"text": {"path": "label"}})
    # Wait, item template resolver binds the array's index scope
    task_item_comp.properties = {
        "text": {"path": ""}
    }  # resolves directly to array item string literal
    surface.components_model.add_component(task_item_comp)

    # Verify template is initially rendered
    expected_template = (
        "<Column>\n"
        "  <Text variant='body'>Task A</Text>\n"
        "  <Text variant='body'>Task B</Text>\n"
        "</Column>"
    )
    assert renderer.output.value == expected_template

    # 4. Append a 3rd item to the dynamic items array
    surface.data_model.set("/items", ["Task A", "Task B", "Task C"])

    # Verify renderer automatically resolved, spawned, and rendered Task C reactively!
    expected_appended = (
        "<Column>\n"
        "  <Text variant='body'>Task A</Text>\n"
        "  <Text variant='body'>Task B</Text>\n"
        "  <Text variant='body'>Task C</Text>\n"
        "</Column>"
    )
    assert renderer.output.value == expected_appended

    renderer.dispose()
    node_graph.dispose()
    surface.dispose()


def test_node_graph_yaml_serialization():
    import yaml

    catalog = BasicCatalog()
    surface = SurfaceModel("surf-1", catalog)
    node_graph = NodeGraph(surface)

    # 1. Set up initial static surface components
    root_comp = ComponentModel(
        "root", "Column", {"children": ["title-comp", "card-comp"]}
    )
    title_comp = ComponentModel(
        "title-comp",
        "Text",
        {"text": "My App Dashboard", "variant": "h1"},
    )
    card_comp = ComponentModel("card-comp", "Card", {"child": "card-content"})
    card_content = ComponentModel(
        "card-content", "Text", {"text": "User Session Active"}
    )

    surface.components_model.add_component(root_comp)
    surface.components_model.add_component(title_comp)
    surface.components_model.add_component(card_comp)
    surface.components_model.add_component(card_content)

    # 2. Serialize to dictionary
    node_dict = node_graph.to_dict()
    assert node_dict is not None

    # 3. Dump to YAML string
    yaml_str = yaml.dump(node_dict, sort_keys=False)

    expected_yaml = """\
instance_id: root
component_id: root
type: Column
props:
  children:
  - instance_id: title-comp
    component_id: title-comp
    type: Text
    props:
      text: My App Dashboard
      variant: h1
  - instance_id: card-comp
    component_id: card-comp
    type: Card
    props:
      child:
        instance_id: card-content
        component_id: card-content
        type: Text
        props:
          text: User Session Active
"""
    assert yaml_str.strip() == expected_yaml.strip()

    node_graph.dispose()
    surface.dispose()

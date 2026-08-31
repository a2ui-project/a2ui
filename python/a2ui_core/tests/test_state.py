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

from typing import Any
import pytest

from a2ui.core.state import (
    ComponentModel,
    ComponentNode,
    DataModel,
    EventSource,
    Signal,
    SurfaceComponentsModel,
    SurfaceModel,
    SurfaceGroupModel,
)
from a2ui.core.basic_catalog import BasicCatalog

dummy_catalog = BasicCatalog()


def test_component_model_lifecycle():
    events: list[ComponentModel] = []
    comp = ComponentModel("c1", "Button", dummy_catalog, {"label": "Click"})

    comp.on_updated.subscribe(lambda c: events.append(c))

    assert comp.properties == {"label": "Click"}
    assert comp.component_tree == {"id": "c1", "type": "Button", "label": "Click"}

    comp.properties = {"label": "Submit", "disabled": True}
    assert len(events) == 1
    assert events[0].properties == {"label": "Submit", "disabled": True}

    comp.dispose()


def test_component_model_get_child_references():
    comp = ComponentModel(
        "c1",
        "Container",
        dummy_catalog,
        {
            "singleChild": "child1",
            "childrenList": ["child2", "child3"],
            "nestedObj": {"componentId": "child4"},
            "tabs": [{"child": "tab1"}, {"child": "tab2"}],
        },
    )

    refs = list(comp.get_child_references())
    ref_ids = [r[0] for r in refs]

    assert "child1" in ref_ids
    assert "child2" in ref_ids
    assert "child3" in ref_ids
    assert "child4" in ref_ids
    assert "tab1" in ref_ids
    assert "tab2" in ref_ids


def test_component_model_get_child_references_with_typed_references():
    from a2ui.core.schema.common_types import (
        SingleReference,
        TemplateChildList,
        ComponentId,
    )

    comp = ComponentModel(
        "c1",
        "CustomLayout",
        dummy_catalog,
        {
            "customSlot": SingleReference("slot1"),
            "items": TemplateChildList(
                componentId=ComponentId("template1"), path="/items"
            ),
        },
    )

    refs = list(comp.get_child_references())
    ref_ids = [r[0] for r in refs]

    assert "slot1" in ref_ids
    assert "template1" in ref_ids


def test_component_model_get_child_references_with_custom_schema():
    from a2ui.core.catalog import Catalog, ComponentApi

    custom_cat = Catalog(
        catalog_id="https://a2ui.org/custom-slots",
        protocol_version="v1.0",
        components=[
            ComponentApi(
                name="SplitPane",
                schema={
                    "type": "object",
                    "properties": {
                        "leftPane": {"$ref": "common_types.json#/$defs/ComponentId"},
                        "rightPane": {"$ref": "common_types.json#/$defs/ComponentId"},
                        "title": {"type": "string"},
                    },
                },
            )
        ],
        functions=[],
    )

    comp = ComponentModel(
        "p1",
        "SplitPane",
        custom_cat,
        {
            "leftPane": "side_nav",
            "rightPane": "main_content",
            "title": "My Split View",
        },
    )

    refs = list(comp.get_child_references())
    ref_ids = [r[0] for r in refs]

    assert "side_nav" in ref_ids
    assert "main_content" in ref_ids
    assert "My Split View" not in ref_ids


def test_surface_components_model_duplicate_reject():
    scm = SurfaceComponentsModel()
    c1 = ComponentModel("c1", "Text", dummy_catalog, {"text": "Hello"})
    scm.add_component(c1)

    assert scm.get("c1") == c1

    with pytest.raises(ValueError, match="already exists"):
        scm.add_component(ComponentModel("c1", "Image", dummy_catalog, {}))

    scm.remove_component("c1")
    assert scm.get("c1") is None
    scm.dispose()


def test_surface_model_action_and_error_dispatch():
    actions: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    surface = SurfaceModel("main", dummy_catalog)
    surface.on_action.subscribe(lambda act: actions.append(act))
    surface.on_error.subscribe(lambda err: errors.append(err))

    surface.dispatch_action({"name": "click", "context": {"x": 1}}, "btn1")
    assert len(actions) == 1
    assert actions[0]["name"] == "click"
    assert actions[0]["surfaceId"] == "main"
    assert actions[0]["sourceComponentId"] == "btn1"

    surface.dispatch_error({"code": "ERR_1", "message": "Failed"})
    assert len(errors) == 1
    assert errors[0]["code"] == "ERR_1"
    assert errors[0]["surfaceId"] == "main"

    surface.dispose()


def test_surface_group_model_unsubscription():
    group = SurfaceGroupModel()
    actions: list[dict[str, Any]] = []
    group.on_action.subscribe(lambda act: actions.append(act))

    s1 = SurfaceModel("s1", dummy_catalog)
    group.add_surface(s1)

    s1.dispatch_action({"name": "a1"}, "c1")
    assert len(actions) == 1

    group.delete_surface("s1")
    # Dispatching on deleted surface should no longer forward to group
    s1.dispatch_action({"name": "a2"}, "c1")
    assert len(actions) == 1

    group.dispose()


def test_event_source():
    source = EventSource()
    emitted = []

    sub = source.subscribe(lambda x: emitted.append(x))
    source.emit("first")
    assert emitted == ["first"]

    sub.unsubscribe()
    source.emit("second")
    assert emitted == ["first"]  # Unsubscribed, so no second entry


def test_component_model():
    comp = ComponentModel("comp_1", "Text", dummy_catalog, {"text": "Hello"})
    assert comp.id == "comp_1"
    assert comp.type == "Text"
    assert comp.properties == {"text": "Hello"}

    updated = []
    comp.on_updated.subscribe(lambda c: updated.append(c.properties["text"]))

    comp.properties = {"text": "World"}
    assert updated == ["World"]

    expected_tree = {"id": "comp_1", "type": "Text", "text": "World"}
    assert comp.component_tree == expected_tree


def test_component_model_validate():
    comp = ComponentModel("c1", "Text", dummy_catalog, {"text": "Hello"})
    errors = comp.validate()
    assert errors == []


def test_validate_components_update_atomic():
    from a2ui.core.exceptions import A2uiValidationError
    from a2ui.core.validation import ValidationConfig

    scm = SurfaceComponentsModel()
    root_comp = ComponentModel("root", "Text", dummy_catalog, {"text": "Original Root"})
    scm.add_component(root_comp)

    invalid_comp = ComponentModel("root", "Text", dummy_catalog, {})

    with pytest.raises(A2uiValidationError):
        scm.validate_components_update(
            [invalid_comp], root_id="root", config=ValidationConfig()
        )

    assert scm.get("root").properties == {"text": "Original Root"}


def test_validate_components_update_aggregates_errors():
    from a2ui.core.exceptions import A2uiValidationError
    from a2ui.core.validation import ValidationConfig

    scm = SurfaceComponentsModel()
    comp1 = ComponentModel("c1", "Text", dummy_catalog, {})
    comp2 = ComponentModel("c2", "Text", dummy_catalog, {})

    with pytest.raises(A2uiValidationError) as exc_info:
        scm.validate_components_update(
            [comp1, comp2],
            root_id="c1",
            config=ValidationConfig(allow_orphan_components=True),
        )

    err = exc_info.value
    assert len(err.details) == 2


def test_surface_components_model():
    scm = SurfaceComponentsModel()
    comp = ComponentModel("comp_1", "Text", dummy_catalog, {"text": "Hello"})

    created = []
    scm.on_created.subscribe(lambda c: created.append(c.id))

    scm.add_component(comp)
    assert created == ["comp_1"]
    assert scm.get("comp_1") is comp

    deleted = []
    scm.on_deleted.subscribe(lambda cid: deleted.append(cid))
    scm.remove_component("comp_1")
    assert deleted == ["comp_1"]
    assert scm.get("comp_1") is None


# ==============================================================================
# DataModel Pointers & Cascade Tests
# ==============================================================================


def test_data_model_basic_get_set():
    dm = DataModel()
    dm.set("/user/name", "Alice")
    assert dm.get("/user/name") == "Alice"
    assert dm.get("/user") == {"name": "Alice"}
    assert dm.get("/") == {"user": {"name": "Alice"}}


def test_data_model_auto_vivification():
    dm = DataModel()
    # Numeric segment "0" should auto-vivify a List array, while others vivify dicts
    dm.set("/users/0/name", "Bob")
    assert dm.get("/users/0/name") == "Bob"
    assert isinstance(dm.get("/users"), list)
    assert isinstance(dm.get("/users/0"), dict)

    # Mixed traversal
    dm.set("/data/lists/1/value", 42)
    assert dm.get("/data/lists/1/value") == 42
    assert dm.get("/data/lists/0") is None  # Placeholder pad


def test_data_model_reactive_subscriptions():
    dm = DataModel()
    updates = []

    # Subscribe to specific path
    sub = dm.subscribe("/user/name", lambda val: updates.append(val))
    assert sub.value is None  # Initial

    dm.set("/user/name", "Alice")
    assert updates == ["Alice"]

    dm.set("/user/name", "Bob")
    assert updates == ["Alice", "Bob"]


def test_data_model_cascade_and_bubble():
    dm = DataModel()
    parent_updates = []
    child_updates = []

    # Subscribe to parent
    dm.subscribe("/user", lambda val: parent_updates.append(copy_dict(val)))
    # Subscribe to child
    dm.subscribe("/user/details/age", lambda val: child_updates.append(val))

    # Set deep child
    dm.set("/user/details/age", 30)

    # Parent updates should have bubbled up
    assert parent_updates == [{"details": {"age": 30}}]
    # Child updates should have cascaded down
    assert child_updates == [30]


def copy_dict(d):
    import copy

    return copy.deepcopy(d) if d is not None else None


def test_signal_reactivity():
    sig = Signal(10)
    assert sig.value == 10
    assert repr(sig) == "Signal(10)"

    emitted = []
    sub = sig.subscribe(lambda val: emitted.append(val))
    # Initially calls listener with 10
    assert emitted == [10]

    sig.value = 20
    assert sig.value == 20
    assert emitted == [10, 20]

    # Assigning identical value should not re-emit
    sig.value = 20
    assert emitted == [10, 20]

    sub.unsubscribe()
    sig.value = 30
    assert emitted == [10, 20]


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

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
    DataModel,
    EventSource,
    Signal,
    SurfaceComponentsModel,
    SurfaceModel,
    SurfaceGroupModel,
)
from a2ui.core.state.data_model import MAX_ARRAY_INDEX
from a2ui.core.exceptions import (
    A2uiDataError,
    A2uiRecursionError,
    A2uiStateError,
    A2uiValidationError,
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
    assert "catalogId" not in actions[0]

    # Action with catalogId at root
    surface.dispatch_action({"name": "submit", "catalogId": "custom_cat"}, "btn2")
    assert len(actions) == 2
    assert actions[1]["name"] == "submit"
    assert actions[1]["catalogId"] == "custom_cat"

    # Action with catalogId inside event
    surface.dispatch_action(
        {"event": {"name": "save", "catalogId": "another_cat"}}, "btn3"
    )
    assert len(actions) == 3
    assert actions[2]["name"] == "save"
    assert actions[2]["catalogId"] == "another_cat"

    # Action with non-dict event payload or missing name does not emit
    surface.dispatch_action({"event": "custom_string_event"}, "btn4")
    assert len(actions) == 3

    surface.dispatch_action({"name": ""}, "btn5")
    assert len(actions) == 3

    surface.dispatch_action("not_a_dict", "btn6")  # type: ignore[arg-type]
    assert len(actions) == 3

    # Context explicitly None normalizes to empty dict
    surface.dispatch_action({"name": "reset", "context": None}, "btn7")
    assert len(actions) == 4
    assert actions[3]["name"] == "reset"
    assert actions[3]["context"] == {}

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
    assert comp.validate() is None

    invalid_comp = ComponentModel("c2", "Text", dummy_catalog, {})
    with pytest.raises(A2uiValidationError) as exc_info:
        invalid_comp.validate()
    assert exc_info.value.details


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


def test_data_model_set_fluent_chaining():
    dm = DataModel()
    res = dm.set("/a", 1).set("/b", 2).delete("/a")
    assert res is dm
    assert dm.get("/b") == 2
    assert dm.get("/a") is None


def test_data_model_max_array_index_exceeded():
    dm = DataModel()
    with pytest.raises(A2uiDataError, match="exceeds maximum supported index"):
        dm.set(f"/items/{MAX_ARRAY_INDEX + 1}", "overflow")
    with pytest.raises(A2uiDataError, match="exceeds maximum supported index"):
        dm.set(f"/matrix/{MAX_ARRAY_INDEX + 1}/0", "overflow")


def test_data_model_forbidden_keys():
    dm = DataModel()
    for seg in ("__proto__", "constructor", "prototype"):
        with pytest.raises(A2uiDataError, match=f"Forbidden path segment '{seg}'"):
            dm.get(f"/{seg}")
        with pytest.raises(A2uiDataError, match=f"Forbidden path segment '{seg}'"):
            dm.set(f"/nested/{seg}/value", 123)
        with pytest.raises(A2uiDataError, match=f"Forbidden path segment '{seg}'"):
            dm.has_path(f"/{seg}")


def test_data_model_absent_null_write_is_noop():
    dm = DataModel()
    res = dm.set("/nonexistent/child/path", None)
    assert res is dm
    assert dm.get("/") == {}
    assert not dm.has_path("/nonexistent")


def test_data_model_stores_references_directly():
    raw_dict = {"item": [1, 2, 3]}
    dm = DataModel(raw_dict)
    assert dm.get("/") is raw_dict

    obj = {"inner": "val"}
    dm.set("/obj", obj)
    assert dm.get("/obj") is obj

    arr = [10, 20]
    dm.set("/arr", arr)
    assert dm.get("/arr") is arr


def test_exception_hierarchy_normalization():
    from a2ui.core.exceptions import (
        A2uiError,
        A2uiValidationError,
        A2uiIntegrityError,
        A2uiRecursionError,
        RpcErrorCode,
    )

    assert issubclass(A2uiIntegrityError, A2uiValidationError)
    assert issubclass(A2uiRecursionError, A2uiValidationError)
    assert issubclass(A2uiValidationError, A2uiError)

    expected_codes = {
        "INVALID_FUNCTION_CALL",
        "EXECUTION_ERROR",
        "UNKNOWN_FUNCTION",
        "UNKNOWN_ERROR",
        "CANCELLED",
        "TIMEOUT",
        "DISPOSED",
        "NO_LISTENER",
        "DUPLICATE",
    }
    actual_codes = {member.value for member in RpcErrorCode}
    assert actual_codes == expected_codes


def test_package_root_and_resolution_exports():
    import a2ui.core
    import a2ui.core.resolution

    for name in a2ui.core.__all__:
        assert hasattr(a2ui.core, name), f"Missing export {name} in a2ui.core"

    for name in [
        "ResolvedBinding",
        "WritableBinding",
        "is_writable",
        "ComponentContext",
        "DataContext",
        "GenericBinder",
        "MissingDataBindingWarning",
    ]:
        assert hasattr(
            a2ui.core.resolution, name
        ), f"Missing export {name} in a2ui.core.resolution"

    # Verify ResolvedBinding and WritableBinding behavior
    rb = a2ui.core.resolution.ResolvedBinding("val")
    assert rb.value == "val"
    assert not a2ui.core.resolution.is_writable(rb)

    assigned = []
    wb = a2ui.core.resolution.WritableBinding(
        "val", lambda v: assigned.append(v), "/path"
    )
    assert wb.value == "val"
    assert wb.path == "/path"
    assert a2ui.core.resolution.is_writable(wb)
    wb.set("new_val")
    assert assigned == ["new_val"]

    # Verify __slots__ prevents arbitrary attributes
    with pytest.raises(AttributeError):
        rb.undeclared = True  # type: ignore[attr-defined]

    with pytest.raises(AttributeError):
        wb.undeclared = True  # type: ignore[attr-defined]


def test_resolved_binding_equality():
    """Verifies value-based equality for ResolvedBinding and WritableBinding."""
    from a2ui.core.resolution import ResolvedBinding, WritableBinding, is_writable

    rb1 = ResolvedBinding("hello")
    rb2 = ResolvedBinding("hello")
    rb3 = ResolvedBinding("world")

    assert rb1 == rb2
    assert rb1 != rb3
    assert rb1 != "hello"

    setter1 = lambda v: None
    setter2 = lambda v: None
    wb1 = WritableBinding("hello", setter1, "/path/1")
    wb2 = WritableBinding("hello", setter2, "/path/1")
    wb3 = WritableBinding("hello", setter1, "/path/2")
    wb4 = WritableBinding("world", setter1, "/path/1")

    # Writable bindings with same value and same path are equal regardless of setter closure
    assert wb1 == wb2
    assert wb1 != wb3
    assert wb1 != wb4
    assert wb1 != "hello"

    # ResolvedBinding and WritableBinding are not equal even with the same value
    assert rb1 != wb1
    assert wb1 != rb1

    # Generic type narrowing with is_writable
    int_rb: ResolvedBinding[int] = WritableBinding(42, lambda v: None, "/val")
    if is_writable(int_rb):
        # Type checker should recognize int_rb as WritableBinding[int]
        assert int_rb.value == 42
        assert int_rb.path == "/val"


def test_data_model_primitive_root_rejection():
    dm = DataModel()
    dm.set("/", 42)
    assert dm.get("/") == 42
    with pytest.raises(
        A2uiDataError, match="the data model root is a primitive value"
    ) as err:
        dm.set("/count", 1)
    assert err.value.path == "/count"


def test_data_model_set_through_primitive_raises():
    dm = DataModel({"user": "Alice", "counts": [7]})

    with pytest.raises(A2uiDataError) as dict_err:
        dm.set("/user/name", "Bob")
    assert dict_err.value.path == "/user/name"

    with pytest.raises(A2uiDataError) as list_err:
        dm.set("/counts/0/total", 1)
    assert list_err.value.path == "/counts/0/total"

    # The rejected writes must leave the originals intact rather than replacing
    # them with an empty container.
    assert dm.get("/user") == "Alice"
    assert dm.get("/counts/0") == 7


def test_data_model_set_through_none_placeholder_vivifies():
    dm = DataModel({"user": None, "counts": [None]})

    dm.set("/user/name", "Bob")
    dm.set("/counts/0/total", 1)

    assert dm.get("/user/name") == "Bob"
    assert dm.get("/counts/0/total") == 1


def test_surface_model_initialization_and_catalogs():
    cat = BasicCatalog()
    surface = SurfaceModel("s1", default_catalog=cat, root_id="custom_root")

    assert surface.root_id == "custom_root"
    assert surface.catalog is cat
    assert cat.id in surface.available_catalogs
    assert surface.available_catalogs[cat.id] is cat


def test_surface_model_dispatch_warning_and_error():
    cat = BasicCatalog()
    surface = SurfaceModel("s1", default_catalog=cat)

    warnings_received: list[dict[str, Any]] = []
    surface.on_warning.subscribe(lambda w: warnings_received.append(w))
    surface.dispatch_warning({"code": "TEST_WARN", "message": "caution"})
    assert len(warnings_received) == 1
    assert warnings_received[0]["code"] == "TEST_WARN"
    assert warnings_received[0]["surfaceId"] == "s1"

    errors_received: list[dict[str, Any]] = []
    surface.on_error.subscribe(lambda e: errors_received.append(e))
    # Foreign surfaceId should be overwritten to surface.id
    surface.dispatch_error({"code": "ERR", "surfaceId": "other_surface"})
    assert len(errors_received) == 1
    assert errors_received[0]["surfaceId"] == "s1"

    # Non-dict error and warning payloads raise TypeError
    with pytest.raises(TypeError, match="Expected error payload to be a dict, got str"):
        surface.dispatch_error("not_a_dict")  # type: ignore[arg-type]

    with pytest.raises(
        TypeError, match="Expected warning payload to be a dict, got int"
    ):
        surface.dispatch_warning(123)  # type: ignore[arg-type]


def test_surface_model_dispatch_action_payload_handling():
    cat = BasicCatalog()
    surface = SurfaceModel("s1", default_catalog=cat)

    actions_received: list[dict[str, Any]] = []
    surface.on_action.subscribe(lambda a: actions_received.append(a))

    # Non-dict payload is dropped without emitting
    surface.dispatch_action("invalid", "c1")  # type: ignore[arg-type]
    assert len(actions_received) == 0

    # String userMessage is preserved
    surface.dispatch_action({"name": "submit", "userMessage": "hello agent"}, "c1")
    assert len(actions_received) == 1
    assert actions_received[0]["name"] == "submit"
    assert actions_received[0]["userMessage"] == "hello agent"

    # Non-string userMessage is not coerced to string
    surface.dispatch_action({"name": "reset", "userMessage": {"not": "a string"}}, "c1")
    assert len(actions_received) == 2
    assert "userMessage" not in actions_received[1]


def test_surface_model_disposal():
    cat = BasicCatalog()
    surface = SurfaceModel("s1", default_catalog=cat)

    def on_act(_: Any) -> None:
        pass

    surface.on_action.subscribe(on_act)
    surface.dispose()


def test_surface_components_model_membership_and_storage():
    cat = BasicCatalog()
    scm = SurfaceComponentsModel(default_catalog=cat)
    assert scm.default_catalog is cat

    c1 = ComponentModel("c1", "Text", cat, {"text": "hello"})
    c2 = ComponentModel("c2", "Button", cat, {"label": "click"})
    scm.add_component(c1)
    scm.add_component(c2)

    assert len(scm) == 2
    assert "c1" in scm
    assert "c2" in scm
    assert "c3" not in scm
    assert scm.get_all() == {"c1": c1, "c2": c2}


def test_surface_components_model_duplicate_rejection():
    cat = BasicCatalog()
    scm = SurfaceComponentsModel(default_catalog=cat)
    scm.add_component(ComponentModel("c1", "Text", cat, {}))

    with pytest.raises(A2uiStateError, match="already exists"):
        scm.add_component(ComponentModel("c1", "Text", cat, {}))


def test_surface_components_model_child_references():
    cat = BasicCatalog()
    scm = SurfaceComponentsModel(default_catalog=cat)
    c1 = ComponentModel("c1", "Text", cat, {"text": "hello"})
    scm.add_component(c1)

    assert scm.get_child_references("c1") == []
    assert scm.get_child_ids("c1") == []


def test_surface_components_model_cycle_detection_ignores_orphans():
    cat = BasicCatalog()
    scm = SurfaceComponentsModel(default_catalog=cat)
    # root connected to c1
    scm.add_component(ComponentModel("root", "Box", cat, {"child": "c1"}))
    scm.add_component(ComponentModel("c1", "Text", cat, {"text": "hello"}))
    # orphan component disconnected from root
    scm.add_component(ComponentModel("orphan", "Text", cat, {"text": "unreachable"}))

    # detect_cycles should validate topology without raising A2uiIntegrityError for orphan
    visited = scm.detect_cycles()
    assert "root" in visited
    assert "c1" in visited


def test_surface_components_model_max_depth_enforcement():
    from a2ui.core.validation import ValidationConfig

    cat = BasicCatalog()
    chain_scm = SurfaceComponentsModel(default_catalog=cat)
    chain_scm.add_component(ComponentModel("root", "Box", cat, {"child": "node1"}))
    chain_scm.add_component(ComponentModel("node1", "Box", cat, {"child": "node2"}))
    chain_scm.add_component(ComponentModel("node2", "Text", cat, {"text": "leaf"}))

    with pytest.raises(A2uiRecursionError, match="logical depth > 1"):
        chain_scm.detect_cycles(ValidationConfig(root_id="root", max_depth=1))
    visited_chain = chain_scm.detect_cycles(
        ValidationConfig(root_id="root", max_depth=5)
    )
    assert len(visited_chain) == 3


def test_surface_components_model_collection_helpers_and_topology():
    from a2ui.core.validation import ValidationConfig
    from a2ui.core.exceptions import A2uiIntegrityError

    cat = BasicCatalog()
    scm = SurfaceComponentsModel(default_catalog=cat)

    # Empty topology validation is a no-op
    scm.validate_topology()
    assert scm.validate_references() == []

    root = ComponentModel("root", "Box", cat, {"child": "child1"})
    child1 = ComponentModel("child1", "Text", cat, {"text": "hello"})
    orphan = ComponentModel("orphan", "Text", cat, {"text": "orphan"})

    scm.add_component(root)
    scm.add_component(child1)
    scm.add_component(orphan)

    assert scm.has("root") is True
    assert scm.has("missing") is False
    assert scm.size == 3
    assert set(scm.keys) == {"root", "child1", "orphan"}
    assert set(scm.values) == {root, child1, orphan}
    assert dict(scm.entries) == {"root": root, "child1": child1, "orphan": orphan}
    assert scm.components_map["root"] is root

    # detect_cycles isolates cycle/depth detection and allows orphans
    visited = scm.detect_cycles()
    assert visited == {"root", "child1"}

    # validate_topology enforces orphan check by default
    with pytest.raises(A2uiIntegrityError, match="orphan"):
        scm.validate_topology()

    # validate_references returns error list without raising
    errs = scm.validate_references()
    assert len(errs) == 1
    assert "orphan" in str(errs[0])

    # Relaxed orphan option passes
    scm.validate_topology(ValidationConfig(allow_orphan_components=True))
    assert scm.validate_references(ValidationConfig(allow_orphan_components=True)) == []

    # detect_cycles accepts ValidationConfig with custom root_id
    assert scm.detect_cycles(ValidationConfig(root_id="child1")) == {"child1"}

    # Missing root is still caught even when allow_dangling_references=True
    missing_root_scm = SurfaceComponentsModel(default_catalog=cat)
    missing_root_scm.add_component(
        ComponentModel("not_root", "Box", cat, {"child": "dangling_child"})
    )
    with pytest.raises(A2uiIntegrityError, match="Missing root component"):
        missing_root_scm.validate_topology(
            ValidationConfig(
                allow_dangling_references=True, allow_orphan_components=True
            )
        )


def test_uax31_identifier_helpers():
    from a2ui.core.common import assert_uax31_identifier, is_valid_uax31_identifier
    from a2ui.core.exceptions import A2uiCatalogError

    assert is_valid_uax31_identifier("validName_1") is True
    assert is_valid_uax31_identifier("@index") is True
    assert is_valid_uax31_identifier("123invalid") is False
    assert is_valid_uax31_identifier("invalid-name") is False
    assert is_valid_uax31_identifier("") is False

    assert_uax31_identifier("validName_1", "component identifier")
    with pytest.raises(A2uiCatalogError, match="Invalid UAX #31 function identifier"):
        assert_uax31_identifier("bad-fn!", "function identifier")

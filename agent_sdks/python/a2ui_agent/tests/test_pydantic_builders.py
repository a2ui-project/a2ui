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

"""Tests for the Python authoring surface of the fluent builders.

Wire-format parity is covered by the language-agnostic conformance suite. What
is tested here is the part that suite cannot express, because it is specific to
this SDK: what the type checker rejects, what Pydantic rejects at runtime, and
the graph behaviours (ID allocation, slot boundaries, shared children) that the
child serializer is responsible for.
"""

import pytest
from pydantic import BaseModel, ValidationError

from a2ui.builder.v0_9 import (
    LENIENT_ENUM_CONTEXT,
    AccessibilityAttributes,
    Action,
    ActionEvent,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    ComponentTree,
    DataBinding,
    DynamicChildList,
    FunctionCall,
    create_surface,
    flatten_component_tree,
    update_components,
)
from a2ui.builder.v0_9.catalogs.basic import (
    OpenUrl,
    Regex,
    Required,
    Button,
    Card,
    Column,
    List,
    Text,
    Image,
    Icon,
    TextField,
)


# =============================================================================
# Model basics
# =============================================================================


def test_pydantic_inheritance():
    """Verifies that builder nodes and supporting types are Pydantic BaseModels."""
    text = Text(text="Hello world")
    assert isinstance(text, BaseModel)
    assert isinstance(text, ComponentBuilderNode)
    assert text.component == "Text"
    assert text.component_name == "Text"

    action = Action(event=ActionEvent(name="click"))
    assert isinstance(action, BaseModel)

    binding = DataBinding(path="/user/name")
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


def test_missing_required_parameters_rejected():
    """Verifies that omitting required parameters raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        Text()  # missing required 'text'
    assert "text" in str(exc_info.value)
    assert "missing" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Button(action=Action(event=ActionEvent(name="click")))  # missing required 'child'
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
            action=Action(event=ActionEvent(name="click")),
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


# =============================================================================
# Enums: strict when authoring, open when parsing
# =============================================================================


def test_strict_enums_reject_unknown_variants():
    """Verifies that unrecognized enum string variants raise ValidationError."""
    assert Text(text="Standard Heading", variant="h1").variant == "h1"
    assert (
        Button(
            child=Text(text="Click"), action=Action(event=ActionEvent(name="click")), variant="primary"
        ).variant
        == "primary"
    )

    with pytest.raises(ValidationError) as exc_info:
        Text(text="Custom Display", variant="display-super-large")
    assert "variant" in str(exc_info.value)
    assert "literal_error" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Button(
            child=Text(text="Click"),
            action=Action(event=ActionEvent(name="click")),
            variant="brand-gradient",
        )
    assert "variant" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        Image(url="https://example.com/img.png", fit="custom-smart-crop")
    assert "fit" in str(exc_info.value)


def test_lenient_context_accepts_forward_compatible_enum_values():
    """Verifies that parsing with a lenient context preserves values from newer catalogs.

    Dropping or rejecting an unrecognized variant on the parse path would lose
    information that a newer client understood perfectly well. Authoring stays
    strict, which is why this is a context flag rather than a wider annotation.
    """
    payload = {"component": "Text", "text": "Hi", "variant": "displayLarge"}

    with pytest.raises(ValidationError):
        Text.model_validate(payload)

    parsed = Text.model_validate(payload, context=LENIENT_ENUM_CONTEXT)
    assert parsed.variant == "displayLarge"

    # Known values are unaffected by the relaxation.
    assert (
        Text.model_validate(
            {"component": "Text", "text": "Hi", "variant": "h1"},
            context=LENIENT_ENUM_CONTEXT,
        ).variant
        == "h1"
    )


# =============================================================================
# Actions
# =============================================================================


def test_action_requires_exactly_one_branch():
    """Verifies the spec's oneOf between a server event and a client function call."""
    with pytest.raises(ValidationError) as exc_info:
        Action()
    assert "exactly one" in str(exc_info.value)

    with pytest.raises(ValidationError):
        Action(
            event=ActionEvent(name="save"),
            function_call=OpenUrl(url="https://example.com"),
        )


def test_action_event_and_context_serialization():
    """Verifies event actions and that bindings inside a context map serialize."""
    assert Action(event=ActionEvent(name="simple_event")).model_dump(
        by_alias=True, exclude_none=True
    ) == {"event": {"name": "simple_event"}}

    with_context = Action(
        event=ActionEvent(
            name="server_action",
            context={
                "server": "db1",
                "port": 5432,
                "user": DataBinding(path="/session/uid"),
            },
        )
    )
    assert with_context.model_dump(by_alias=True, exclude_none=True) == {
        "event": {
            "name": "server_action",
            "context": {
                "server": "db1",
                "port": 5432,
                "user": {"path": "/session/uid"},
            },
        }
    }


def test_function_call_action_uses_wire_key():
    """Verifies the client-function branch emits 'functionCall', the key the spec requires."""
    action = Action(function_call=OpenUrl(url="https://a2ui.org"))
    assert action.model_dump(by_alias=True, exclude_none=True) == {
        "functionCall": {"call": "openUrl", "args": {"url": "https://a2ui.org"}}
    }


# =============================================================================
# Flattening: IDs, slot boundaries, shared children
# =============================================================================


def test_direct_node_serialization():
    """Verifies that node.flatten() serializes subtrees directly."""
    layout = Card(
        child=Column(
            children=[
                Text(text="Title", variant="h2"),
                Button(child=Text(text="Submit"), action=Action(event=ActionEvent(name="submit"))),
            ]
        )
    )

    comps = layout.flatten()
    assert len(comps) == 5
    comp_types = [c["component"] for c in comps]
    assert "Card" in comp_types
    assert "Column" in comp_types
    assert "Text" in comp_types
    assert "Button" in comp_types

    prefixed_comps = layout.flatten(prefix="macro_test")
    assert any("macro_test" in c["id"] for c in prefixed_comps)


def test_children_are_emitted_before_their_parent():
    """Verifies depth-first post-order, so every reference resolves to an earlier sibling."""
    comps = flatten_component_tree(
        Card(id="outer", child=Column(id="inner", children=[Text(id="leaf", text="x")]))
    )
    assert [c["id"] for c in comps] == ["outer__leaf", "outer__inner", "outer"]

    seen: set[str] = set()
    for comp in comps:
        for key in ("child", "children"):
            if key not in comp:
                continue
            refs = comp[key] if isinstance(comp[key], list) else [comp[key]]
            assert all(ref in seen for ref in refs)
        seen.add(comp["id"])


def test_id_collision_prevention():
    """Verifies that auto-generated sequential IDs never collide with user-provided IDs.

    Allocation happens lazily during serialization, so an explicit ID declared
    later in the tree would collide with an earlier auto-allocated one. A scan
    pass reserves every author-supplied ID before allocation begins.
    """
    tree = Column(
        id="root",
        children=[
            Text(id="text_1", text="Explicit text_1"),
            Text(text="Auto-allocated text"),
        ],
    )
    ids = [c["id"] for c in flatten_component_tree(tree)]
    assert len(ids) == len(set(ids)), f"Duplicate IDs detected: {ids}"
    assert "root__text_1" in ids
    assert "root__text_2" in ids

    # The collision-prone ordering: the auto-allocated node comes first.
    reordered = Column(
        id="root",
        children=[
            Text(text="Auto-allocated text"),
            Text(id="text_1", text="Explicit text_1"),
        ],
    )
    reordered_ids = [c["id"] for c in flatten_component_tree(reordered)]
    assert len(reordered_ids) == len(set(reordered_ids)), reordered_ids
    assert "root__text_1" in reordered_ids


def test_component_ref_is_referenced_not_redefined():
    """Verifies slot boundaries keep their address and are never emitted or namespaced."""
    comps = flatten_component_tree(
        Column(id="wrapper", children=[ComponentRef(id="already_on_surface")])
    )
    assert [c["id"] for c in comps] == ["wrapper"]
    assert comps[0]["children"] == ["already_on_surface"]


def test_shared_child_is_emitted_once_and_referenced_twice():
    """Verifies that the same node object in two slots is one component, not two."""
    shared = Text(id="shared", text="Reused")
    comps = flatten_component_tree(
        Column(id="wrapper", children=[shared, shared])
    )
    assert [c["id"] for c in comps] == ["wrapper__shared", "wrapper"]
    assert comps[1]["children"] == ["wrapper__shared", "wrapper__shared"]


def test_dynamic_child_list_emits_a_component_id_reference():
    """Verifies the spec shape, where the template is an ordinary sibling component."""
    comps = flatten_component_tree(
        Column(
            id="feed",
            children=DynamicChildList(
                path="posts", template=Card(id="tpl", child=Text(text="t"))
            ),
        )
    )
    assert comps[-1]["children"] == {"path": "posts", "componentId": "feed__tpl"}
    # The reference resolves: the template really is in the emitted list.
    assert "feed__tpl" in {c["id"] for c in comps}


def test_template_scopes_keep_relative_and_absolute_paths_distinct():
    """Verifies the spec's own mixed-scope example survives a build.

    From "Path resolution & scope" in ``specification/v0_9_1/docs/a2ui_protocol.md``:
    inside a template iterating ``/employees``, the relative ``name`` resolves to
    ``/employees/N/name`` while the absolute ``/company`` stays global. Collapsing
    the two spellings would silently repoint every item-scoped binding at the
    document root, where it resolves to nothing.
    """
    comps = flatten_component_tree(
        List(
            id="employee_list",
            children=DynamicChildList(
                path="/employees",
                template=Column(
                    id="card",
                    children=[
                        Text(id="name_text", text=DataBinding(path="name")),
                        Text(id="company_text", text=DataBinding(path="/company")),
                    ],
                ),
            ),
        )
    )
    by_id = {c["id"]: c for c in comps}
    assert by_id["employee_list__name_text"]["text"] == {"path": "name"}
    assert by_id["employee_list__company_text"]["text"] == {"path": "/company"}


def test_serialization_aliases_are_honoured():
    """Verifies snake_case fields reach the wire under their camelCase alias."""
    comp = flatten_component_tree(
        TextField(id="zip", label="ZIP", validation_regexp="^[0-9]{5}$")
    )[0]
    assert comp["validationRegexp"] == "^[0-9]{5}$"
    assert "validation_regexp" not in comp


def test_checks_serialize_on_checkable_components():
    """Verifies CheckRule reaches the wire via a component's checks slot."""
    comp = flatten_component_tree(
        TextField(
            id="zip",
            label="ZIP",
            checks=[
                CheckRule(
                    condition=Regex(value=DataBinding(path="/user/zip"), pattern="^[0-9]{5}$"),
                    message="ZIP code must be 5 digits",
                )
            ],
        )
    )[0]
    assert comp["checks"] == [
        {
            "condition": {
                "call": "regex",
                "args": {"value": {"path": "/user/zip"}, "pattern": "^[0-9]{5}$"},
            },
            "message": "ZIP code must be 5 digits",
        }
    ]


def test_check_condition_accepts_any_dynamic_boolean():
    """Verifies CheckRule.condition is not narrowed to a FunctionCall.

    The spec and the core models both type this as a DynamicBoolean. A catalog
    validation function is the usual spelling, but a literal and a binding are
    legitimate, so all three are accepted and reach the wire unchanged.
    """
    dump = lambda r: r.model_dump(by_alias=True, exclude_none=True)

    assert dump(CheckRule(condition=True, message="m"))["condition"] is True
    assert dump(CheckRule(condition=DataBinding(path="/agreed"), message="m"))[
        "condition"
    ] == {"path": "/agreed"}
    assert dump(CheckRule(condition=Required(value="x"), message="m"))["condition"] == {
        "call": "required",
        "args": {"value": "x"},
    }


def test_reused_core_models_stay_identical_to_core():
    """Pins which models the builder takes from a2ui_core rather than restating.

    Reuse is only safe while it stays visible. If core's ActionEvent gains a
    field or DataBinding's shape moves, that has to break a test here rather
    than silently change what every builder payload puts on the wire.
    """
    from a2ui.core.schema.common_types import ActionEvent as CoreActionEvent
    from a2ui.core.schema.common_types import DataBinding as CoreDataBinding

    # Both are core's classes outright, not copies that happen to match.
    assert ActionEvent is CoreActionEvent
    assert DataBinding is CoreDataBinding

    # Paths reach the wire exactly as written. The leading slash distinguishes
    # an absolute path from one resolved against a template's item scope, so
    # rewriting either form would change what the client resolves.
    assert DataBinding(path="user/name").path == "user/name"
    assert DataBinding(path="/user/name").path == "/user/name"


def test_bare_model_dump_keeps_children_nested():
    """Verifies a builder tree stays inspectable outside a flatten pass."""
    tree = Card(id="c", child=Text(id="t", text="Hi"))
    dumped = tree.model_dump(by_alias=True, exclude_none=True)
    assert dumped["child"] == {
        "component": "Text",
        "id": "t",
        "text": "Hi",
        "variant": "body",
    }


# =============================================================================
# Trees and envelopes
# =============================================================================


def test_component_tree_methods():
    """Verifies the ComponentTree container's shape-only responsibilities."""
    card = Card(child=Text(text="Tree Test"))
    tree = ComponentTree(root=card, surface_id="s1")
    assert tree.surface_id == "s1"
    assert len(tree.flatten()) == 2
    assert tree.to_json() is not None


def test_top_level_envelope_helpers():
    """Verifies create_surface and update_components emit typed, versioned messages."""
    root_col = Column(children=[Text(text="Status")])

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
    # Every envelope carries the protocol version; the validator requires it.
    assert all("version" in m for m in dumped)

    # update_components emits ONLY updateComponents, so it does not reset the surface.
    update_msgs = update_components("my-surface", root=root_col)
    assert len(update_msgs) == 1
    assert update_msgs[0].update_components.surface_id == "my-surface"


def test_envelope_helpers_accept_a_list_of_roots():
    """Verifies a forest packages as cleanly as a single tree."""
    msgs = update_components(
        "s", root=[Text(id="a", text="A"), Text(id="b", text="B")]
    )
    components = msgs[0].update_components.components
    assert [c["id"] for c in components] == ["a", "b"]


def test_data_model_paths_are_normalized():
    """Verifies updateDataModel paths gain a leading slash."""
    msgs = create_surface(
        "s",
        root=Card(child=Text(text="x")),
        catalog_id="basic",
        data_model={"user/name": "Alice"},
    )
    dumped = msgs[2].model_dump(by_alias=True, exclude_none=True)
    assert dumped["updateDataModel"]["path"] == "/user/name"
    assert dumped["updateDataModel"]["value"] == "Alice"


# =============================================================================
# Item models and function calls
# =============================================================================


def test_tab_item_and_choice_option_models():
    """Verifies typed item models resolve nested children through the same serializer."""
    from a2ui.builder.v0_9.catalogs.basic import (
        ChoicePickerOption,
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
                    action=Action(event=ActionEvent(name="click")),
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
            ChoicePickerOption(label="Option 1", value="opt1"),
            ChoicePickerOption(label="Option 2", value="opt2"),
        ],
    )
    picker_comps = flatten_component_tree(picker)
    assert len(picker_comps) == 1
    assert picker_comps[0]["options"][0] == {"label": "Option 1", "value": "opt1"}
    assert picker_comps[0]["options"][1] == {"label": "Option 2", "value": "opt2"}


def test_typed_function_call_classes():
    """Verifies typed FunctionCall classes carry their call name and args."""
    fn_obj = OpenUrl(url="https://example.com")
    assert isinstance(fn_obj, FunctionCall)
    assert isinstance(fn_obj, OpenUrl)
    assert fn_obj.call == "openUrl"
    assert fn_obj.args == {"url": "https://example.com"}
    assert fn_obj.model_dump(by_alias=True, exclude_none=True) == {
        "call": "openUrl",
        "args": {"url": "https://example.com"},
    }


# =============================================================================
# Static typing
# =============================================================================


def test_static_typechecker_compiler_rejections():
    """Verifies that a static type checker halts on invalid builder syntax."""
    try:
        import mypy.api
    except ImportError:
        pytest.skip("mypy is not installed in the environment")

    preamble = (
        "from a2ui.builder.v0_9.catalogs.basic import Button, Text\n"
        "from a2ui.builder.v0_9 import event\n"
    )

    cases = [
        (
            'b = Button(child=Text(text="Hi"), action=Action(event=ActionEvent(name="click")), variant="invalid_variant")',
            'Argument "variant" to "Button" has incompatible type',
        ),
        (
            'b = Button(child=Text(text="Hi"), action=Action(event=ActionEvent(name="click")), lable="Save")',
            'Unexpected keyword argument "lable" for "Button"',
        ),
        (
            'b = Button(child="not_a_component", action=Action(event=ActionEvent(name="click")))',
            'Argument "child" to "Button" has incompatible type',
        ),
    ]

    for code, expected in cases:
        report, _, exit_status = mypy.api.run(["-c", preamble + code])
        assert exit_status != 0, code
        assert expected in report, f"{code}\n{report}"


def test_accessibility_attributes_match_the_v0_9_1_schema():
    """Pins the v0.9 model's field set to the v0.9.1 schema.

    The schema omits ``additionalProperties: false`` on this definition, so a
    field that only exists in a later version validates cleanly while no v0.9
    renderer reads it. ``live`` and ``hidden`` reached the builder that way.
    An equality assertion is what makes the drift fail rather than pass.
    """
    import json
    import pathlib

    repo_root = next(
        p
        for p in pathlib.Path(__file__).resolve().parents
        if (p / "specification").is_dir()
    )
    schema_path = repo_root / "specification/v0_9_1/json/common_types.json"
    schema = json.loads(schema_path.read_text())

    expected = set(schema["$defs"]["AccessibilityAttributes"]["properties"])
    actual = set(AccessibilityAttributes.model_fields)

    assert actual == expected, (
        f"builder has {sorted(actual - expected)} not in the v0.9.1 schema; "
        f"schema has {sorted(expected - actual)} not on the builder model"
    )

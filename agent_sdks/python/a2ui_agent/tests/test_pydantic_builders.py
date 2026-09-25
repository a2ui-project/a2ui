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
    OPEN_ENUM_CONTEXT,
    AccessibilityAttributes,
    Action,
    ActionEvent,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    ComponentTree,
    DataBinding,
    DynamicBoolean,
    DynamicChildList,
    DynamicNumber,
    DynamicString,
    FunctionCall,
    flatten_component_tree,
)
from a2ui.core.schema.server_to_client import (
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
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
        Button(
            action=Action(event=ActionEvent(name="click"))
        )  # missing required 'child'
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
            child=Text(text="Click"),
            action=Action(event=ActionEvent(name="click")),
            variant="primary",
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
                Button(
                    child=Text(text="Submit"),
                    action=Action(event=ActionEvent(name="submit")),
                ),
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
    comps = flatten_component_tree(Column(id="wrapper", children=[shared, shared]))
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
    """Verifies relative item-scoped paths and absolute root paths are preserved verbatim."""
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
                    condition=Regex(
                        value=DataBinding(path="/user/zip"), pattern="^[0-9]{5}$"
                    ),
                    message="ZIP code must be 5 digits",
                )
            ],
        )
    )[0]
    assert comp["checks"] == [{
        "condition": {
            "call": "regex",
            "args": {"value": {"path": "/user/zip"}, "pattern": "^[0-9]{5}$"},
        },
        "message": "ZIP code must be 5 digits",
    }]


def test_check_condition_accepts_any_dynamic_boolean():
    """Verifies CheckRule.condition accepts bool literals, DataBindings, and FunctionCalls."""
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
    """Verifies shared builder models are re-exports of core's models and do not emit unset defaults."""
    from a2ui.core.schema.common_types import (
        AccessibilityAttributes as CoreAccessibilityAttributes,
    )
    from a2ui.core.schema.common_types import ActionEvent as CoreActionEvent
    from a2ui.core.schema.common_types import CheckRule as CoreCheckRule
    from a2ui.core.schema.common_types import DataBinding as CoreDataBinding
    from a2ui.core.schema.common_types import FunctionCall as CoreFunctionCall

    assert AccessibilityAttributes is CoreAccessibilityAttributes
    assert ActionEvent is CoreActionEvent
    assert CheckRule is CoreCheckRule
    assert DataBinding is CoreDataBinding
    assert FunctionCall is CoreFunctionCall

    assert DataBinding(path="user/name").path == "user/name"
    assert DataBinding(path="/user/name").path == "/user/name"

    call = FunctionCall(call="validateEmail")
    assert call.return_type is None
    assert call.model_dump(by_alias=True, exclude_none=True) == {
        "call": "validateEmail"
    }

    typed = FunctionCall(call="itemCount", returnType="number")
    assert typed.model_dump(by_alias=True, exclude_none=True) == {
        "call": "itemCount",
        "returnType": "number",
    }

    assert (
        CheckRule(condition=FunctionCall(call="isValid"), message="Invalid.").message
        == "Invalid."
    )
    assert (
        CheckRule(
            condition=DataBinding(path="/form/agreed"), message="Required."
        ).message
        == "Required."
    )


def test_locally_defined_models_still_serialize_as_core_models():
    """Verifies locally defined Action and DynamicChildList serialize into valid core wire schemas."""
    from pydantic import TypeAdapter

    from a2ui.core.schema.common_types import (
        Action as CoreAction,
        ActionEventWrapper,
        ActionFunctionCallWrapper,
        TemplateChildList,
    )

    action_adapter = TypeAdapter(CoreAction)

    event_form = Action(event=ActionEvent(name="save")).model_dump(
        by_alias=True, exclude_none=True
    )
    assert event_form == {"event": {"name": "save"}}
    assert isinstance(action_adapter.validate_python(event_form), ActionEventWrapper)

    call_form = Action(function_call=FunctionCall(call="closeModal")).model_dump(
        by_alias=True, exclude_none=True
    )
    assert call_form == {"functionCall": {"call": "closeModal"}}
    assert isinstance(
        action_adapter.validate_python(call_form), ActionFunctionCallWrapper
    )

    for degenerate in ({}, {"event": {"name": "s"}, "functionCall": {"call": "c"}}):
        with pytest.raises(ValidationError):
            action_adapter.validate_python(degenerate)
    for degenerate_kwargs in (
        {},
        {"event": ActionEvent(name="s"), "function_call": FunctionCall(call="c")},
    ):
        with pytest.raises(ValidationError):
            Action(**degenerate_kwargs)

    tree = Column(
        id="list",
        children=DynamicChildList(
            path="/feed/posts",
            template=Text(id="row", text=DataBinding(path="title")),
        ),
    )
    flattened = flatten_component_tree(tree)
    column = next(c for c in flattened if c["component"] == "Column")
    TemplateChildList.model_validate(column["children"])


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
    """Verifies ComponentTree flatten and JSON serialization."""
    card = Card(child=Text(text="Tree Test"))
    tree = ComponentTree(root=card, surface_id="s1")
    assert tree.surface_id == "s1"
    assert len(tree.flatten()) == 2
    assert tree.to_json() is not None


def test_message_envelope_packaging_with_flattened_tree():
    """Verifies packaging flattened builder trees directly into core message envelopes."""
    root_col = Column(children=[Text(text="Status")])
    components = root_col.flatten()

    create_msg = CreateSurfaceMessage(
        create_surface=CreateSurface(
            surface_id="my-surface",
            catalog_id="org.a2ui.basic",
        )
    )
    update_msg = UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id="my-surface",
            components=components,
        )
    )

    create_dump = create_msg.model_dump(by_alias=True, exclude_none=True)
    update_dump = update_msg.model_dump(by_alias=True, exclude_none=True)

    assert create_dump["createSurface"]["surfaceId"] == "my-surface"
    assert create_dump["createSurface"]["catalogId"] == "org.a2ui.basic"
    assert update_dump["updateComponents"]["surfaceId"] == "my-surface"
    assert len(update_dump["updateComponents"]["components"]) == 2
    assert create_dump["version"] in ("v0.9", "v0.9.1")
    assert update_dump["version"] in ("v0.9", "v0.9.1")


def test_dynamic_types_reject_coerced_primitives():
    """Verifies Dynamic* types enforce strict primitives without implicit coercion."""

    class DummyModel(BaseModel):
        s: DynamicString
        n: DynamicNumber
        b: DynamicBoolean

    # Valid strictly typed literals
    valid = DummyModel(s="valid_str", n=42, b=True)
    assert valid.s == "valid_str"
    assert valid.n == 42
    assert valid.b is True

    valid_float = DummyModel(s="valid_str", n=3.14, b=False)
    assert valid_float.n == 3.14

    # String passed to DynamicNumber must be rejected (no string-to-number coercion)
    with pytest.raises(ValidationError):
        DummyModel(s="ok", n="100", b=True)  # type: ignore[arg-type]

    # String passed to DynamicBoolean must be rejected (no string-to-bool coercion)
    with pytest.raises(ValidationError):
        DummyModel(s="ok", n=1, b="true")  # type: ignore[arg-type]

    # Integer passed to DynamicBoolean must be rejected (no int-to-bool coercion)
    with pytest.raises(ValidationError):
        DummyModel(s="ok", n=1, b=1)  # type: ignore[arg-type]


def test_open_enum_context_naming():
    """Verifies OPEN_ENUM_CONTEXT accepts unknown enum values."""
    # Authoring rejects invalid variant
    with pytest.raises(ValidationError):
        Text(text="Hi", variant="future_variant")  # type: ignore[arg-type]

    # OPEN_ENUM_CONTEXT allows future variant during parsing
    parsed = Text.model_validate(
        {"component": "Text", "text": "Hi", "variant": "future_variant"},
        context=OPEN_ENUM_CONTEXT,
    )
    assert parsed.variant == "future_variant"


# =============================================================================
# Item models and function calls
# =============================================================================


def test_tab_item_and_choice_option_models():
    """Verifies typed item models resolve nested children through the Child serializer."""
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
            (
                'b = Button(child=Text(text="Hi"),'
                ' action=Action(event=ActionEvent(name="click")),'
                ' variant="invalid_variant")'
            ),
            'Argument "variant" to "Button" has incompatible type',
        ),
        (
            (
                'b = Button(child=Text(text="Hi"),'
                ' action=Action(event=ActionEvent(name="click")), lable="Save")'
            ),
            'Unexpected keyword argument "lable" for "Button"',
        ),
        (
            (
                'b = Button(child="not_a_component",'
                ' action=Action(event=ActionEvent(name="click")))'
            ),
            'Argument "child" to "Button" has incompatible type',
        ),
    ]

    for code, expected in cases:
        report, _, exit_status = mypy.api.run(["-c", preamble + code])
        assert exit_status != 0, code
        assert expected in report, f"{code}\n{report}"


def test_accessibility_attributes_match_the_v0_9_1_schema():
    """Verifies shared AccessibilityAttributes supports v0.9.1 fields and omits unset v1.0 fields."""
    import json
    import pathlib

    from a2ui.core.schema.common_types import (
        AccessibilityAttributes as CoreAccessibilityAttributes,
    )

    assert AccessibilityAttributes is CoreAccessibilityAttributes

    repo_root = next(
        p
        for p in pathlib.Path(__file__).resolve().parents
        if (p / "specification").is_dir()
    )
    schema_path = repo_root / "specification/v0_9_1/json/common_types.json"
    schema = json.loads(schema_path.read_text())

    versioned = set(schema["$defs"]["AccessibilityAttributes"]["properties"])
    actual = set(AccessibilityAttributes.model_fields)

    assert versioned <= actual, f"missing from the model: {sorted(versioned - actual)}"
    assert actual - versioned == {
        "live",
        "hidden",
    }, f"unexpected extra fields: {sorted(actual - versioned - {'live', 'hidden'})}"

    for name in ("live", "hidden"):
        assert AccessibilityAttributes.model_fields[name].default is None

    dumped = AccessibilityAttributes(label="Save").model_dump(
        by_alias=True, exclude_none=True
    )
    assert dumped == {"label": "Save"}

    call = FunctionCall(call="localizedLabel", args={"key": "save"})
    assert AccessibilityAttributes(label=call).label == call

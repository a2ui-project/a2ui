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

"""Tests for the A2UI Protocol v1.0 Python fluent builder SDK."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from a2ui.builder.v1_0 import (
    OPEN_ENUM_CONTEXT,
    AccessibilityAttributes,
    Action,
    ActionEvent,
    AudioPlayer,
    Button,
    Card,
    CheckBox,
    CheckRule,
    ChoicePicker,
    ChoicePickerOption,
    Column,
    ComponentBuilderNode,
    DataBinding,
    DateTimeInput,
    Divider,
    DynamicChildList,
    Email,
    FormatCurrency,
    FormatDate,
    FormatNumber,
    FormatString,
    FunctionCall,
    Icon,
    Image,
    Length,
    List,
    Modal,
    Numeric,
    OpenUrl,
    Regex,
    Required,
    Row,
    Slider,
    Tabs,
    TabItem,
    Text,
    TextField,
    Video,
    flatten_component_tree,
)
from a2ui.core.schema.v1_0 import (
    CreateSurfaceMessage,
    UpdateComponentsMessage,
)


def test_v1_0_pydantic_inheritance() -> None:
    """Verifies that v1.0 builder nodes and supporting models are Pydantic BaseModels."""
    text = Text(text="Hello v1.0")
    assert isinstance(text, BaseModel)
    assert isinstance(text, ComponentBuilderNode)
    assert text.component == "Text"

    action = Action(event=ActionEvent(name="click"))
    assert isinstance(action, BaseModel)

    binding = DataBinding(path="/user/name")
    assert isinstance(binding, BaseModel)
    assert binding.path == "/user/name"
    assert binding.model_dump(by_alias=True) == {"@path": "/user/name"}


def test_v1_0_strict_validation_rejects_typos() -> None:
    """Verifies that direct instantiation with invalid or misspelled attributes raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        Text(text="Hello", vairant="body")
    assert "vairant" in str(exc_info.value)
    assert "extra_forbidden" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        TextField(label="Name", placholder="Type here")
    assert "placholder" in str(exc_info.value)


def test_v1_0_data_binding_serialization() -> None:
    """Verifies that v1.0 DataBinding serializes using the '@path' wire alias."""
    binding = DataBinding(path="/items/selected")
    dumped = binding.model_dump(by_alias=True, exclude_none=True)
    assert dumped == {"@path": "/items/selected"}


def test_v1_0_function_call_serialization() -> None:
    """Verifies that v1.0 FunctionCall serializes using the '@call' wire alias."""
    fc = FunctionCall(call="formatString", args={"value": "Hello ${/user/name}"})
    dumped = fc.model_dump(by_alias=True, exclude_none=True)
    assert dumped == {
        "@call": "formatString",
        "args": {"value": "Hello ${/user/name}"},
    }

    helper = FormatString(value="Hello ${/user/name}")
    assert isinstance(helper, FunctionCall)
    assert helper.model_dump(by_alias=True, exclude_none=True) == {
        "@call": "formatString",
        "args": {"value": "Hello ${/user/name}"},
    }


def test_v1_0_action_event_and_function_call() -> None:
    """Verifies that v1.0 Action handles mutually exclusive events and function calls."""
    event_action = Action(
        event=ActionEvent(name="submit", user_message="Submitting data")
    )
    event_dump = event_action.model_dump(by_alias=True, exclude_none=True)
    assert event_dump == {
        "event": {
            "name": "submit",
            "userMessage": "Submitting data",
        }
    }

    fn_action = Action(function_call=OpenUrl(url="https://a2ui.org"))
    fn_dump = fn_action.model_dump(by_alias=True, exclude_none=True)
    assert fn_dump == {
        "functionCall": {
            "@call": "openUrl",
            "args": {"url": "https://a2ui.org"},
        }
    }

    with pytest.raises(ValidationError, match="Action requires exactly one"):
        Action()

    with pytest.raises(ValidationError, match="Action requires exactly one"):
        Action(
            event=ActionEvent(name="evt"),
            function_call=OpenUrl(url="https://example.com"),
        )


def test_v1_0_action_event_with_data_binding_context_and_message() -> None:
    """Verifies that ActionEvent context and user_message correctly accept builder DataBinding and FunctionCall."""
    action = Action(
        event=ActionEvent(
            name="select_item",
            user_message=FormatString(value="Selected item ${/selected/id}"),
            context={
                "itemId": DataBinding(path="/selected/id"),
                "format": "compact",
            },
        )
    )
    dumped = action.model_dump(by_alias=True, exclude_none=True)
    assert dumped == {
        "event": {
            "name": "select_item",
            "userMessage": {
                "@call": "formatString",
                "args": {"value": "Selected item ${/selected/id}"},
            },
            "context": {
                "itemId": {"@path": "/selected/id"},
                "format": "compact",
            },
        }
    }


def test_v1_0_accessibility_attributes_attached_to_component() -> None:
    """Verifies v1.0 AccessibilityAttributes attached to builder components emit correctly on flattening."""
    acc = AccessibilityAttributes(
        label="Dismiss alert dialog",
        live="assertive",
        hidden=False,
    )
    dumped_acc = acc.model_dump(by_alias=True, exclude_none=True)
    assert dumped_acc == {
        "label": "Dismiss alert dialog",
        "live": "assertive",
        "hidden": False,
    }

    text = Text(
        id="dismiss_text",
        text="Dismiss",
        accessibility=acc,
    )
    flat = flatten_component_tree(text)
    assert len(flat) == 1
    assert flat[0]["component"] == "Text"
    assert flat[0]["accessibility"] == dumped_acc


def test_v1_0_component_catalog_id_and_metadata() -> None:
    """Verifies attaching catalog_id and metadata to component nodes."""
    text = Text(
        id="custom_text",
        text="Special",
        catalog_id="https://custom.org/catalog.json",
        metadata={"customProp": "test"},
    )
    flat = flatten_component_tree(text)
    assert len(flat) == 1
    assert flat[0]["catalogId"] == "https://custom.org/catalog.json"
    assert flat[0]["metadata"] == {"customProp": "test"}


def test_v1_0_components_specific_to_v1_0() -> None:
    """Verifies component additions introduced in Protocol v1.0."""
    tf = TextField(
        label="Username",
        placeholder="Enter your username",
        variant="shortText",
        weight=1.5,
        checks=[
            CheckRule(condition=Required(value=DataBinding(path="/username"))),
            CheckRule(
                condition=Length(value=DataBinding(path="/username"), min=3, max=20),
                message="Username must be 3-20 characters",
            ),
        ],
    )
    assert tf.placeholder == "Enter your username"
    assert tf.weight == 1.5
    assert len(tf.checks or []) == 2
    dumped_tf = tf.model_dump(by_alias=True, exclude_none=True)
    assert dumped_tf["placeholder"] == "Enter your username"
    assert dumped_tf["checks"] == [
        {"condition": {"@call": "required", "args": {"value": {"@path": "/username"}}}},
        {
            "condition": {
                "@call": "length",
                "args": {"value": {"@path": "/username"}, "min": 3, "max": 20},
            },
            "message": "Username must be 3-20 characters",
        },
    ]

    slider = Slider(min=0.0, max=100.0, value=50.0, steps=10.0)
    assert slider.steps == 10.0

    video = Video(
        url="https://example.com/video.mp4",
        poster_url="https://example.com/poster.jpg",
    )
    dumped_video = video.model_dump(by_alias=True, exclude_none=True)
    assert dumped_video["posterUrl"] == "https://example.com/poster.jpg"

    btn = Button(
        child=Text(text="Save Profile"),
        variant="primary",
        action=Action(event=ActionEvent(name="save")),
    )
    assert isinstance(btn.child, Text)


def test_v1_0_dynamic_child_list_template_flattening() -> None:
    """Verifies that dynamic child list templating flattens correctly in v1.0."""
    dyn_list = List(
        id="item_list",
        children=DynamicChildList(
            path="/users",
            template=Text(text=DataBinding(path="name")),
        ),
    )
    flat = flatten_component_tree(dyn_list, root_id="item_list")
    assert len(flat) == 2

    template_comp = flat[0]
    parent_list = flat[1]

    assert template_comp["component"] == "Text"
    assert template_comp["text"] == {"@path": "name"}

    assert parent_list["component"] == "List"
    assert parent_list["id"] == "item_list"
    assert parent_list["children"] == {
        "path": "/users",
        "componentId": template_comp["id"],
    }


def test_v1_0_standard_catalog_functions() -> None:
    """Verifies standard catalog function builders produce valid FunctionCall instances."""
    fc_req = Required(value=DataBinding(path="/field"))
    assert fc_req.call == "required"
    assert fc_req.model_dump(by_alias=True, exclude_none=True) == {
        "@call": "required",
        "args": {"value": {"@path": "/field"}},
    }

    fc_regex = Regex(value=DataBinding(path="/code"), pattern="^[A-Z]{3}$")
    assert fc_regex.call == "regex"

    fc_num = Numeric(value=DataBinding(path="/count"))
    assert fc_num.call == "numeric"

    fc_email = Email(value=DataBinding(path="/email"))
    assert fc_email.call == "email"

    fc_cur = FormatCurrency(value=100.5, currency="USD")
    assert fc_cur.call == "formatCurrency"

    fc_date = FormatDate(value="2026-10-08", format="YYYY-MM-DD")
    assert fc_date.call == "formatDate"

    fc_num_fmt = FormatNumber(value=1234.56, decimals=2)
    assert fc_num_fmt.call == "formatNumber"


def test_v1_0_various_catalog_components() -> None:
    """Verifies various basic catalog components instantiate cleanly."""
    audio = AudioPlayer(url="https://example.com/audio.mp3", description="Podcast")
    assert audio.component == "AudioPlayer"

    checkbox = CheckBox(label="Agree", value=True)
    assert checkbox.component == "CheckBox"

    picker = ChoicePicker(
        options=[ChoicePickerOption(label="Option 1", value="1")],
        value=["1"],
    )
    assert picker.component == "ChoicePicker"

    dt = DateTimeInput(value="2026-10-08", enable_date=True)
    assert dt.component == "DateTimeInput"

    divider = Divider(axis="horizontal")
    assert divider.component == "Divider"

    icon = Icon(name="check")
    assert icon.component == "Icon"

    img = Image(url="https://example.com/img.png", fit="cover")
    assert img.component == "Image"

    modal = Modal(
        trigger=Button(
            child=Text(text="Open"),
            action=Action(event=ActionEvent(name="open_modal")),
        ),
        content=Text(text="Modal body"),
    )
    assert modal.component == "Modal"

    row = Row(children=[Text(text="Left"), Text(text="Right")])
    assert row.component == "Row"

    tabs = Tabs(tabs=[TabItem(title="Tab 1", child=Text(text="Content 1"))])
    assert tabs.component == "Tabs"


def test_v1_0_end_to_end_flatten_and_wire_validation() -> None:
    """Builds a complex v1.0 UI tree, flattens it, and verifies validation against v1.0 message envelopes."""
    tree = Card(
        id="main_card",
        child=Column(
            children=[
                Text(text="User Settings", variant="body", weight=1.0),
                TextField(
                    label="Email",
                    placeholder="user@example.com",
                    value=DataBinding(path="/profile/email"),
                    checks=[
                        CheckRule(
                            condition=Required(value=DataBinding(path="/profile/email"))
                        ),
                        CheckRule(
                            condition=Email(value=DataBinding(path="/profile/email"))
                        ),
                    ],
                ),
                Slider(min=0.0, max=10.0, value=5.0, steps=1.0),
                Video(
                    url="https://example.com/intro.mp4",
                    poster_url=DataBinding(path="/profile/avatar"),
                ),
                Button(
                    child=Text(text="Save Changes"),
                    variant="primary",
                    action=Action(
                        event=ActionEvent(
                            name="submit_profile",
                            user_message="Saved user profile",
                            context={"source": "settings_dialog"},
                        )
                    ),
                ),
            ]
        ),
    )

    flat = flatten_component_tree(tree, root_id="main_card")
    assert isinstance(flat, list)
    assert len(flat) == 8

    # Root component must be Card with ID "main_card"
    card_dict = flat[-1]
    assert card_dict["component"] == "Card"
    assert card_dict["id"] == "main_card"

    # Verify that DataBinding has '@path'
    tf_dict = next(c for c in flat if c["component"] == "TextField")
    assert tf_dict["value"] == {"@path": "/profile/email"}
    assert tf_dict["placeholder"] == "user@example.com"

    # Verify Video posterUrl
    video_dict = next(c for c in flat if c["component"] == "Video")
    assert video_dict["posterUrl"] == {"@path": "/profile/avatar"}

    # Test 1: Direct bundling in v1.0 CreateSurfaceMessage
    create_msg = CreateSurfaceMessage.model_validate({
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "settings_surface",
            "catalogId": (
                "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ),
            "components": flat,
            "dataModel": {"profile": {"email": "test@example.com"}},
        },
    })
    assert create_msg.create_surface.components is not None
    assert len(create_msg.create_surface.components) == 8

    # Test 2: Incremental update in v1.0 UpdateComponentsMessage
    update_msg = UpdateComponentsMessage.model_validate({
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "settings_surface",
            "components": flat,
        },
    })
    assert len(update_msg.update_components.components) == 8


def test_v1_0_open_enum_validation() -> None:
    """Verifies OPEN_ENUM handling for v1.0 catalog enums."""
    with pytest.raises(ValidationError):
        Text.model_validate(
            {"component": "Text", "text": "Hi", "variant": "futureVariant"}
        )

    # Tolerates unknown future enum value under OPEN_ENUM_CONTEXT
    lenient = Text.model_validate(
        {"component": "Text", "text": "Hi", "variant": "futureVariant"},
        context=OPEN_ENUM_CONTEXT,
    )
    assert lenient.variant == "futureVariant"  # type: ignore[comparison-overlap]

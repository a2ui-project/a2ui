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

import pytest
from pydantic import ValidationError, TypeAdapter

from a2ui.core.basic_catalog import (
    ImageComponent,
    TextComponent,
    ButtonComponent,
    Theme,
    AnyComponent,
)
from a2ui.core.schema import UpdateComponentsMessage, A2uiMessageListWrapper


def test_image_component_valid_with_description():
    valid_image = {
        "id": "img-1",
        "component": "Image",
        "url": "https://example.com/image.png",
        "description": "An example image",
    }
    parsed = ImageComponent.model_validate(valid_image)
    assert parsed.component == "Image"
    assert parsed.url == "https://example.com/image.png"
    assert parsed.description == "An example image"


def test_image_component_valid_without_description():
    valid_image = {
        "id": "img-2",
        "component": "Image",
        "url": "https://example.com/image.png",
    }
    parsed = ImageComponent.model_validate(valid_image)
    assert parsed.component == "Image"
    assert parsed.url == "https://example.com/image.png"
    assert parsed.description is None


def test_image_component_invalid_field_type():
    invalid_image = {
        "id": "img-3",
        "component": "Image",
        "url": 123,  # Invalid type (should be string/DataBinding)
    }
    with pytest.raises(ValidationError):
        ImageComponent.model_validate(invalid_image)


def test_any_component_discriminated_union():
    adapter = TypeAdapter(AnyComponent)

    # 1. Test TextComponent routing
    text_data = {
        "id": "text-1",
        "component": "Text",
        "text": "Hello, A2UI!",
        "variant": "h1",
    }
    comp = adapter.validate_python(text_data)
    assert isinstance(comp, TextComponent)
    assert comp.component == "Text"
    assert comp.text == "Hello, A2UI!"
    assert comp.variant == "h1"

    # 2. Test ImageComponent routing
    image_data = {
        "id": "img-1",
        "component": "Image",
        "url": "https://example.com/photo.jpg",
    }
    comp = adapter.validate_python(image_data)
    assert isinstance(comp, ImageComponent)
    assert comp.component == "Image"
    assert comp.url == "https://example.com/photo.jpg"

    # 3. Test ButtonComponent routing
    button_data = {
        "id": "btn-1",
        "component": "Button",
        "child": "text-1",
        "action": {
            "event": {
                "name": "click",
                "context": {},
            }
        },
    }
    comp = adapter.validate_python(button_data)
    assert isinstance(comp, ButtonComponent)
    assert comp.component == "Button"
    assert comp.child == "text-1"
    assert comp.action.event.name == "click"


def test_any_component_invalid_discriminator():
    adapter = TypeAdapter(AnyComponent)
    invalid_data = {
        "id": "unknown-1",
        "component": "UnknownComponentType",
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(invalid_data)


def test_text_component_validation():
    # 1. Valid Text component instantiation
    comp = TextComponent(
        id="welcome_text",
        component="Text",
        text="Hello World!",
        variant="h1",
    )
    assert comp.id == "welcome_text"
    assert comp.text == "Hello World!"
    assert comp.variant == "h1"

    # 2. Validation Fails on missing required properties
    with pytest.raises(ValidationError):
        TextComponent(id="bad")  # type: ignore


def test_text_component_variant_enum():
    # 1. Omitted variant uses default value "body"
    comp_default = TextComponent(id="text_1", component="Text", text="Hello Default")
    assert comp_default.variant == "body"

    # 2. Validation fails on invalid variant value
    with pytest.raises(ValidationError) as exc_info:
        TextComponent(
            id="text_2",
            component="Text",
            text="Hello Mismatch",
            variant="bold",  # type: ignore
        )
    assert "Input should be 'h1', 'h2', 'h3', 'h4', 'h5', 'caption' or 'body'" in str(
        exc_info.value
    )


def test_button_component_strict_extra_forbid():
    # StrictBaseModel forbids extra fields
    with pytest.raises(ValidationError):
        ButtonComponent(
            id="btn",
            component="Button",
            child="welcome_text",
            action={"event": {"name": "click"}},  # type: ignore
            extra_invalid_field="not allowed",  # type: ignore
        )


def test_message_payload_parsing():
    payload = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "surface_1",
            "components": [
                {"id": "title", "component": "Text", "text": "My App"},
                {
                    "id": "submit",
                    "component": "Button",
                    "child": "title",
                    "action": {"event": {"name": "submitForm"}},
                },
            ],
        },
    }

    msg = UpdateComponentsMessage.model_validate(payload)
    assert msg.version == "v0.9"
    assert msg.update_components.surface_id == "surface_1"
    assert len(msg.update_components.components) == 2
    assert msg.update_components.components[0]["component"] == "Text"
    assert msg.update_components.components[1]["component"] == "Button"


def test_model_json_schema_generation():
    schema = A2uiMessageListWrapper.model_json_schema()
    assert schema is not None
    assert "properties" in schema
    assert "messages" in schema["properties"]


def test_theme_allows_additional_properties():
    # 1. Valid theme instantiation with documented properties
    theme = Theme(primary_color="#00BFFF")
    assert theme.primary_color == "#00BFFF"

    # 2. Instantiate Theme with extra undocumented properties.
    # Since additionalProperties is True in catalog.json for theme,
    # it compiles Theme extending BaseModel which dynamically permits extra properties.
    # This MUST succeed without raising any ValidationError!
    theme_extra = Theme(
        primary_color="#00BFFF",
        extra_custom_color="#FF0000",
    )
    assert theme_extra.primary_color == "#00BFFF"

    # 3. For comparison, a strict model (like ButtonComponent) must throw ValidationError
    with pytest.raises(ValidationError):
        ButtonComponent(
            id="btn",
            component="Button",
            child="text",
            action={"event": {"name": "click"}},  # type: ignore
            extra_garbage_property="forbidden",  # type: ignore
        )


def test_text_component_discriminator_behavior():
    # 1. Direct Python Instantiation succeeds WITHOUT passing component name explicitly
    # because Pydantic applies the Literal default value.
    comp = TextComponent(id="text_1", text="Direct Instantiation works!")
    assert comp.component == "Text"
    assert comp.text == "Direct Instantiation works!"

    # 2. Discriminated Union Validation from raw JSON requires the "component" key.
    # Valid payload (contains component) succeeds.
    valid_payload = {
        "id": "text_2",
        "component": "Text",
        "text": "Payload works!",
    }
    comp_validated = TypeAdapter(AnyComponent).validate_python(valid_payload)
    assert isinstance(comp_validated, TextComponent)
    assert comp_validated.component == "Text"

    # Invalid payload (missing component key) fails to validate against the union
    # because the discriminator is missing.
    invalid_payload = {"id": "text_3", "text": "Missing component key"}
    with pytest.raises(ValidationError) as exc_info:
        TypeAdapter(AnyComponent).validate_python(invalid_payload)

    assert "Input tag 'component' is missing" in str(
        exc_info.value
    ) or "union_tag_not_found" in str(exc_info.value)

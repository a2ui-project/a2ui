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

import pytest
from pydantic import ValidationError

from a2ui.core.schema.v0_9.common_types import (
    AccessibilityAttributes,
    ComponentCommon,
    DataBinding,
)


def test_accessibility_attributes_defaults():
    attr = AccessibilityAttributes(label="Click Me")
    assert attr.label == "Click Me"
    assert attr.description is None


def test_accessibility_attributes_all_fields():
    attr = AccessibilityAttributes(
        label="Submit Button",
        description="Submits the current active form",
    )
    assert attr.label == "Submit Button"
    assert attr.description == "Submits the current active form"


def test_accessibility_attributes_forbid_extra_properties():
    with pytest.raises(ValidationError):
        AccessibilityAttributes.model_validate({"label": "Submit", "role": "button"})


def test_accessibility_attributes_component_common_integration():
    comp = ComponentCommon(
        id="btn1",
        accessibility=AccessibilityAttributes(
            label="Mute Notifications",
            description="Mutes audio",
        ),
    )
    assert comp.id == "btn1"
    assert isinstance(comp.accessibility, AccessibilityAttributes)
    assert comp.accessibility.label == "Mute Notifications"
    assert comp.accessibility.description == "Mutes audio"

    dumped = comp.model_dump(mode="json", exclude_none=True)
    assert dumped["id"] == "btn1"
    assert dumped["accessibility"]["label"] == "Mute Notifications"
    assert dumped["accessibility"]["description"] == "Mutes audio"


def test_accessibility_attributes_json_serialization_roundtrip():
    payload = {
        "label": "Mute",
        "description": "Mutes audio",
    }
    attr = AccessibilityAttributes.model_validate(payload)
    dumped = attr.model_dump(mode="json", exclude_none=True)
    assert dumped == payload

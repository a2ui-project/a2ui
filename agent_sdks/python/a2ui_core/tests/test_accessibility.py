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
from pydantic import ValidationError

from a2ui.core.schema.common_types import AccessibilityAttributes, DataBinding


def test_accessibility_attributes_defaults():
    attr = AccessibilityAttributes(label="Click Me")
    assert attr.label == "Click Me"
    assert attr.description is None
    assert attr.live == "off"
    assert attr.hidden is None


def test_accessibility_attributes_all_fields():
    attr = AccessibilityAttributes(
        label="Submit Button",
        description="Submits the current active form",
        live="polite",
        hidden=False,
    )
    assert attr.label == "Submit Button"
    assert attr.description == "Submits the current active form"
    assert attr.live == "polite"
    assert attr.hidden is False


def test_accessibility_attributes_live_assertive():
    attr = AccessibilityAttributes(live="assertive")
    assert attr.live == "assertive"


def test_accessibility_attributes_invalid_live_value():
    with pytest.raises(ValidationError):
        AccessibilityAttributes(live="invalid_value")


def test_accessibility_attributes_hidden_data_binding():
    binding = DataBinding(path="/form/is_disabled")
    attr = AccessibilityAttributes(hidden=binding)
    assert isinstance(attr.hidden, DataBinding)
    assert attr.hidden.path == "/form/is_disabled"


def test_accessibility_attributes_forbid_extra_properties():
    with pytest.raises(ValidationError):
        AccessibilityAttributes.model_validate(
            {"label": "Submit", "role": "button"}
        )

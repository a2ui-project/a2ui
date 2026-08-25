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

"""Unit tests for A2UI Template Models (models.py) focusing on Python runtime integration."""

from dataclasses import dataclass

from a2ui.inference_formats.experimental.template.models import (
    DynamicTemplate,
    ParamType,
    normalize_node,
)


def test_normalize_node_dataclass_support():
    """Verifies that Python dataclass instances are normalized to plain dictionaries."""

    @dataclass
    class TextComponent:
        component: str
        text: str

    node = TextComponent(component="Text", text="Hello Dataclass")
    normalized = normalize_node(node)
    assert isinstance(normalized, dict)
    assert normalized == {"component": "Text", "text": "Hello Dataclass"}


def test_normalize_node_duck_typing():
    """Verifies that objects implementing to_dict() are properly normalized."""

    class CustomNode:

        def to_dict(self):
            return {"component": "CustomCard", "score": 99}

    node = CustomNode()
    normalized = normalize_node(node)
    assert isinstance(normalized, dict)
    assert normalized == {"component": "CustomCard", "score": 99}


def test_dynamic_template_signature_inference():
    """Verifies that DynamicTemplate infers typed parameters and defaults from Python callable annotations."""

    def my_resolver(userId: str, count: int = 5, active: bool = True) -> dict:
        return {}

    tmpl = DynamicTemplate(template_id="InferredTmpl", resolver=my_resolver)
    params = tmpl.parameters

    assert "userId" in params
    assert params["userId"].type == ParamType.STRING
    assert params["userId"].default is None

    assert "count" in params
    assert params["count"].type == ParamType.INTEGER
    assert params["count"].default == 5

    assert "active" in params
    assert params["active"].type == ParamType.BOOLEAN
    assert params["active"].default is True

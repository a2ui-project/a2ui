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
    dynamic_template,
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


def test_dynamic_template_decorator_and_callability():
    """Verifies that @dynamic_template decorates a function, infers metadata, and preserves callability."""

    @dynamic_template(
        catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"],
        description="Generates a user badge with custom status.",
    )
    def user_badge(user_name: str, status: str = "Active", score: int = 100):
        """Generates a user badge."""
        return {
            "component": "Card",
            "child": {
                "component": "Text",
                "text": f"{user_name}: {status} ({score})",
            },
        }

    # 1. Verify it acts as a DynamicTemplate instance
    assert isinstance(user_badge, DynamicTemplate)
    assert user_badge.name == "UserBadge"
    assert user_badge.description == "Generates a user badge with custom status."
    assert user_badge.catalogs == [
        "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
    ]
    assert "user_name" in user_badge.parameters
    assert user_badge.parameters["user_name"].type == ParamType.STRING
    assert user_badge.parameters["status"].default == "Active"
    assert user_badge.parameters["score"].type == ParamType.INTEGER
    assert user_badge.parameters["score"].default == 100

    # 2. Verify it remains directly callable as a standard Python function
    rendered = user_badge("Alice", status="Online", score=150)
    assert isinstance(rendered, dict)
    assert rendered["component"] == "Card"
    assert rendered["child"]["text"] == "Alice: Online (150)"


def test_dynamic_template_decorator_no_args():
    """Verifies @dynamic_template works without parenthesis, extracting docstring and PascalCase name."""

    @dynamic_template
    def metric_tile(label: str, value: float = 0.0):
        """KPI metric display tile."""
        return {"component": "Text", "text": f"{label}: {value}"}

    assert isinstance(metric_tile, DynamicTemplate)
    assert metric_tile.name == "MetricTile"
    assert metric_tile.description == "KPI metric display tile."
    assert "label" in metric_tile.parameters
    assert metric_tile.parameters["value"].type == ParamType.NUMBER

    res = metric_tile("CPU", 99.4)
    assert res == {"component": "Text", "text": "CPU: 99.4"}

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

"""Unit tests for A2UI Template Inference Format (format.py) focusing on ADK framework integration."""

from a2ui.inference_formats.experimental.template import (
    StaticTemplate,
    TemplateInferenceFormat,
)


def test_template_inference_format_end_to_end():
    """Verifies that TemplateInferenceFormat wraps ExpressFormat, generates prompts, and unrolls streaming chunks."""
    tmpl = StaticTemplate.from_dict({
        "version": "0.1",
        "name": "UserProfile",
        "catalogs": [
            "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        ],
        "parameters": {
            "userId": {"type": "string"},
            "userName": {"type": "string"},
            "role": {"type": "string"},
        },
        "layout": {
            "component": "Card",
            "child": {"component": "Text", "text": "${userName}"},
        },
    })
    manager = TemplateInferenceFormat(
        templates=[tmpl],
        surface_id="main_surface",
        version="0.9.1",
    )

    # 1. Check prompt generation includes UserProfile signature when include_schema=True
    prompt = manager.prompt_generator.generate(
        role_description="Test Agent", include_schema=True
    )
    assert "UserProfile" in prompt

    # 2. Check parsing and expansion of Express DSL response
    llm_output = """
    Here is your profile card:
    <a2ui>
    root = UserProfile("usr_99", "Sarah Jenkins", "Lead Designer")
    </a2ui>
    """

    parts = manager.parser.parse_response(llm_output)
    assert len(parts) == 1
    assert "Here is your profile card:" in parts[0].text
    assert parts[0].a2ui_json is not None

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

import json
import pytest
from a2ui.formats import InferenceFormat, PromptGenerator
from a2ui.formats.json_inference_format import JsonInferenceFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9


class MockFormat(InferenceFormat):

    @property
    def name(self) -> str:
        return "mock"

    def format_description(self, custom_workflow_description: str = "") -> str:
        return f"mock rules: {custom_workflow_description}"

    def catalog_description(self, include_schema: bool = True) -> str:
        return "mock instructions"

    def parse_response(self, content: str) -> list:
        return []

    def decompile(self, val: dict) -> str:
        return "mock decompiled"

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        return f"wrapped: {blocks}"

    def has_a2ui_parts(self, content: str) -> bool:
        return "mock" in content


@pytest.fixture
def test_catalog():
    return A2uiCatalog(
        version=VERSION_0_9,
        name="test_catalog",
        s2c_schema={},
        common_types_schema={},
        catalog_schema={
            "catalogId": "https://a2ui.org/test_catalog",
            "components": {
                "Text": {
                    "properties": {"text": {"type": "string", "positionalIndex": 0}}
                }
            },
            "functions": {
                "openUrl": {
                    "properties": {"url": {"type": "string", "positionalIndex": 0}}
                }
            },
        },
    )


def test_express_format_strategy(test_catalog):
    from a2ui.experimental.express.format import ExpressInferenceFormat

    fmt = ExpressInferenceFormat(catalog=test_catalog)
    assert fmt.name == "express"
    assert "# A2UI Express Output Contract" in fmt.format_description()
    assert "## Positional Component Signatures" in fmt.catalog_description()


def test_elemental_format_strategy(test_catalog):
    from a2ui.experimental.elemental.format import ElementalInferenceFormat

    fmt = ElementalInferenceFormat(catalog=test_catalog)
    assert fmt.name == "elemental"
    assert "# A2UI Elemental Output Contract" in fmt.format_description()
    assert "## Component Interfaces" in fmt.catalog_description()


def test_express_format_strategy_missing_catalog():
    from a2ui.experimental.express.format import ExpressInferenceFormat

    fmt = ExpressInferenceFormat(catalog=None)
    assert fmt.name == "express"

    with pytest.raises(ValueError, match="Catalog is required"):
        fmt.decompile({"some": "json"})

    with pytest.raises(ValueError, match="Catalog is required"):
        fmt.parse_response("<a2ui>some content</a2ui>")


def test_elemental_format_strategy_missing_catalog():
    from a2ui.experimental.elemental.format import ElementalInferenceFormat

    fmt = ElementalInferenceFormat(catalog=None)
    assert fmt.name == "elemental"

    with pytest.raises(ValueError, match="Catalog is required"):
        fmt.decompile({"some": "json"})

    with pytest.raises(ValueError, match="Catalog is required"):
        fmt.parse_response("<body>some content</body>")


def test_json_inference_format(test_catalog):
    fmt = JsonInferenceFormat(catalog=test_catalog)
    assert fmt.name == "json"

    # Workflow rules
    assert (
        "The response can contain one or more A2UI JSON blocks."
        in fmt.format_description()
    )
    assert "custom rules" in fmt.format_description("custom rules")

    # Instructions
    instructions = fmt.catalog_description()
    assert "### Catalog Schema:" in instructions

    # Parse response
    parsed = fmt.parse_response(
        '<a2ui-json>[{"createSurface": {"surfaceId": "main", "layout": {"component":'
        ' "Text"}}}]</a2ui-json>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None

    # Decompile
    data = {"createSurface": {"surfaceId": "main"}}
    decompiled = fmt.decompile(data)
    assert '"createSurface"' in decompiled


def test_prompt_generator(test_catalog):
    fmt = MockFormat(catalog=test_catalog)
    generator = PromptGenerator(fmt)

    # Test system prompt generation
    prompt = generator.generate_system_prompt(
        role_description="You are a helpful assistant.",
        workflow_description="Please adhere to constraints.",
        include_schema=True,
    )
    assert "You are a helpful assistant." in prompt
    assert "Please adhere to constraints." in prompt
    assert "mock instructions" in prompt

    # Test transforming examples markdown
    raw_md = (
        'Here is an example:\n```json\n{"createSurface": {"surfaceId": "main",'
        ' "layout": {"component": "Text", "text": "Hello"}}}\n```\nEnd of example.'
    )
    transformed = generator.transform_examples(raw_md)
    assert "wrapped:" in transformed
    assert "mock decompiled" in transformed

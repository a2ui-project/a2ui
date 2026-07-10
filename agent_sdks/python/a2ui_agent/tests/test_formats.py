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


def test_express_inference_format(test_catalog):
    # Conditionally test if Express is enabled / imported
    try:
        from a2ui.experimental.express.format import ExpressInferenceFormat
    except ImportError:
        pytest.skip("Express inference format not available")

    fmt = ExpressInferenceFormat(catalog=test_catalog)
    assert fmt.name == "express"

    # Workflow rules
    assert "A2UI Express Output Contract" in fmt.format_description()
    assert "custom workflow" in fmt.format_description("custom workflow")

    # Instructions
    instructions = fmt.catalog_description()
    assert "## Positional Component Signatures" in instructions

    # Transform examples via PromptGenerator
    generator = PromptGenerator(fmt)
    raw_md = (
        'Some text before\n```json\n{\n  "createSurface": {\n    "surfaceId": "main",\n'
        '    "components": [\n      {\n        "id": "root",\n        "component":'
        ' "Text",\n        "properties": {"text": "hello"}\n      }\n    ]\n '
        " }\n}\n```\nSome text after"
    )
    transformed = generator.transform_examples(raw_md)
    assert "```\n<a2ui>\n" in transformed
    assert "Text" in transformed

    # Parse response
    parsed = fmt.parse_response("<a2ui>\nroot = Text()\n</a2ui>")
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None

    # Decompile
    data = {
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Text", "properties": {"text": "hello"}}
            ],
        }
    }
    decompiled = fmt.decompile(data)
    assert "root = Text" in decompiled


def test_elemental_inference_format(test_catalog):
    try:
        from a2ui.experimental.elemental.format import ElementalInferenceFormat
    except ImportError:
        pytest.skip("Elemental inference format not available")

    fmt = ElementalInferenceFormat(catalog=test_catalog)
    assert fmt.name == "elemental"

    # Workflow rules
    assert "A2UI Elemental Output Contract" in fmt.format_description()
    assert "custom rules description" in fmt.format_description(
        "custom rules description"
    )

    # Instructions
    instructions = fmt.catalog_description()
    assert "## Component Interfaces" in instructions
    assert "type DataBinding =" in instructions

    # Transform examples via PromptGenerator
    generator = PromptGenerator(fmt)
    raw_md = (
        'Some text before\n```json\n{\n  "createSurface": {\n    "surfaceId": "main",\n'
        '    "components": [\n      {\n        "id": "root",\n        "component":'
        ' "Text",\n        "properties": {"text": "hello"}\n      }\n    ]\n '
        " }\n}\n```\nSome text after"
    )
    transformed = generator.transform_examples(raw_md)
    assert "```html\n" in transformed
    assert "<ui-text" in transformed

    # Check fallbacks for invalid JSON (default behavior of transform_examples)
    raw_md_invalid = "Some text\n```json\ninvalid json\n```"
    assert generator.transform_examples(raw_md_invalid) == raw_md_invalid

    # Check fallbacks for non-surface action JSON
    raw_md_other = 'Some text\n```json\n{"otherKey": 1}\n```'
    assert generator.transform_examples(raw_md_other) == raw_md_other

    parsed = fmt.parse_response(
        '<a2ui id="main"><link rel="catalog"'
        ' href="https://a2ui.org/test_catalog"><ui-text id="root"'
        ' text="hello"></ui-text></a2ui>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None

    # Decompile
    data = {
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Text", "properties": {"text": "hello"}}
            ],
        }
    }
    decompiled = fmt.decompile(data)
    assert "<ui-text" in decompiled


def test_dynamic_format_switching(test_catalog):
    from a2ui.schema.manager import A2uiSchemaManager
    from a2ui.adk.a2a.part_converter import A2uiPartConverter
    from a2ui.experimental.express.format import ExpressInferenceFormat
    from google.genai import types as genai_types

    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import A2uiCatalogProvider

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog", provider=MemoryCatalogProvider(test_catalog.catalog_schema)
    )

    # 1. Test schema manager with dynamic format strategy parameter
    manager = A2uiSchemaManager(version=VERSION_0_9, catalogs=[config])
    # Default is JSON
    default_prompt = manager.generate_system_prompt(
        role_description="Test role",
        include_schema=True,
        client_ui_capabilities={
            "supportedCatalogIds": ["https://a2ui.org/test_catalog"]
        },
    )
    assert "### Catalog Schema:" in default_prompt

    # Switch dynamically to Express
    express_prompt = manager.generate_system_prompt(
        role_description="Test role",
        include_schema=True,
        client_ui_capabilities={
            "supportedCatalogIds": ["https://a2ui.org/test_catalog"]
        },
        format_strategy=ExpressInferenceFormat(),
    )
    assert "## Positional Component Signatures" in express_prompt

    # 2. Test part converter with dynamic format strategy parameter
    # Test JSON default (with `<a2ui>` tags)
    json_converter = A2uiPartConverter(a2ui_catalog=test_catalog)
    part_json = genai_types.Part(
        text=(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
        )
    )
    parts_json = json_converter.convert(part_json)
    assert len(parts_json) == 1

    # Test Express dynamically
    from a2ui.schema.constants import VERSION_1_0

    test_catalog_v1_0 = A2uiCatalog(
        version=VERSION_1_0,
        name="test_catalog",
        s2c_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/s2c.json",
        },
        common_types_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/common.json",
        },
        catalog_schema=test_catalog.catalog_schema,
    )
    express_converter = A2uiPartConverter(
        a2ui_catalog=test_catalog_v1_0,
        version=VERSION_1_0,
        format_strategy=ExpressInferenceFormat(),
    )
    part_express = genai_types.Part(text="<a2ui>\nroot = Text()\n</a2ui>")
    parts_express = express_converter.convert(part_express)
    assert len(parts_express) == 1

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

import os
os.environ["A2UI_EXPRESS_ENABLED"] = "true"

import pytest
import json
from a2ui.formats import InferenceFormat, InferenceFormatRegistry, JsonInferenceFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9


class MockFormat(InferenceFormat):
    @property
    def name(self) -> str:
        return "mock"

    def generate_workflow_rules(self, custom_workflow_description: str = "") -> str:
        return f"mock rules: {custom_workflow_description}"

    def generate_instructions(self, catalog: A2uiCatalog) -> str:
        return "mock instructions"

    def parse_response(
        self, content: str, catalog: A2uiCatalog, surface_id: str = "main"
    ) -> list:
        return []

    def decompile(self, val: dict, catalog: A2uiCatalog) -> str:
        return "mock decompiled"


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
                    "properties": {
                        "text": {"type": "string", "positionalIndex": 0}
                    }
                }
            },
            "functions": {
                "openUrl": {
                    "properties": {
                        "url": {"type": "string", "positionalIndex": 0}
                    }
                }
            }
        },
    )


def test_registry_operations():
    fmt = MockFormat()
    
    # 1. Test register and available_formats property
    InferenceFormatRegistry.register(fmt)
    assert "mock" in InferenceFormatRegistry.available_formats
    
    # 2. Test get
    retrieved = InferenceFormatRegistry.get("mock")
    assert retrieved == fmt
    
    # 3. Test get unknown format raises ValueError
    with pytest.raises(ValueError, match="Unknown inference format: nonexistent"):
        InferenceFormatRegistry.get("nonexistent")
        
    # 4. Test unregister
    InferenceFormatRegistry.unregister("mock")
    assert "mock" not in InferenceFormatRegistry.available_formats
    
    # 5. Test unregister nonexistent format does not crash
    InferenceFormatRegistry.unregister("nonexistent")


def test_json_inference_format(test_catalog):
    fmt = JsonInferenceFormat()
    assert fmt.name == "json"
    
    # Workflow rules
    assert "The response can contain one or more A2UI JSON blocks." in fmt.generate_workflow_rules()
    assert "custom rules" in fmt.generate_workflow_rules("custom rules")
    
    # Instructions
    instructions = fmt.generate_instructions(test_catalog)
    assert "### Catalog Schema:" in instructions
    
    # Transform examples (default is identity)
    examples = "some markdown"
    assert fmt.transform_examples(examples, test_catalog) == examples
    
    # Parse response
    parsed = fmt.parse_response('<a2ui-json>[{"createSurface": {"surfaceId": "main", "layout": {"component": "Text"}}}]</a2ui-json>', test_catalog)
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None
    
    # Decompile
    data = {"createSurface": {"surfaceId": "main"}}
    decompiled = fmt.decompile(data, test_catalog)
    assert '"createSurface"' in decompiled


def test_express_inference_format(test_catalog):
    # Conditionally test if Express is enabled / imported
    try:
        from a2ui.experimental.express.format import ExpressInferenceFormat
    except ImportError:
        pytest.skip("Express inference format not available")

    fmt = ExpressInferenceFormat()
    assert fmt.name == "express"
    
    # Workflow rules
    assert "A2UI Express Output Contract" in fmt.generate_workflow_rules()
    assert "custom workflow" in fmt.generate_workflow_rules("custom workflow")
    
    # Instructions
    instructions = fmt.generate_instructions(test_catalog)
    assert "## Positional Component Signatures" in instructions
    
    # Transform examples
    raw_md = (
        "Some text before\n"
        "```json\n"
        '{\n  "createSurface": {\n    "surfaceId": "main",\n    "components": [\n      {\n        "id": "root",\n        "component": "Text",\n        "properties": {"text": "hello"}\n      }\n    ]\n  }\n}\n'
        "```\n"
        "Some text after"
    )
    transformed = fmt.transform_examples(raw_md, test_catalog)
    assert "```\n<a2ui>\n" in transformed
    assert "Text" in transformed
    
    # Parse response
    parsed = fmt.parse_response("<a2ui>\nroot = Text()\n</a2ui>", test_catalog)
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None
    
    # Decompile
    data = {
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {
                    "id": "root",
                    "component": "Text",
                    "properties": {"text": "hello"}
                }
            ]
        }
    }
    decompiled = fmt.decompile(data, test_catalog)
    assert "root = Text" in decompiled

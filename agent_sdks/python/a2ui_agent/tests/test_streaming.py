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
import pytest
from typing import Any

from a2ui.a2a.parts import StreamingPartConverter
from a2ui.strategies.schema.parser import A2uiSchemaParser
from a2ui.experimental.express import ExpressParser
from a2ui.experimental.elemental import ElementalParser
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2a.types import TextPart, DataPart


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


def test_json_inference_format_streaming(test_catalog):
    converter = StreamingPartConverter(parser=A2uiSchemaParser(test_catalog))

    # 1. Push leading text
    parts = converter.push_chunk("Here is the search result:\n")
    assert len(parts) == 1
    assert isinstance(parts[0].root, TextPart)
    assert parts[0].root.text == "Here is the search result:\n"

    # 2. Push start of tag and partial JSON array
    parts = converter.push_chunk("<a2ui-json>\n[")
    # At this point, the JSON array is healed to `[]`
    assert len(parts) >= 1

    # 3. Push partial dictionary structure
    parts = converter.push_chunk(
        '{\n  "createSurface": {\n    "surfaceId": "main",\n    "catalogId":'
        ' "https://a2ui.org/test_catalog",\n    "components": ['
    )
    # json-repair heals it to: [{"createSurface": {"surfaceId": "main", "catalogId": "https://a2ui.org/test_catalog", "components": []}}]
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1
    data = a2ui_parts[0].root.data
    assert "createSurface" in data
    assert data["createSurface"]["surfaceId"] == "main"
    assert data["createSurface"]["catalogId"] == "https://a2ui.org/test_catalog"

    # 4. Push components list entry
    parts = converter.push_chunk(
        '\n      {\n        "id": "root",\n        "type": "Text",\n       '
        ' "properties": {"text": "Hello"}'
    )
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1
    data = a2ui_parts[0].root.data
    components = data["createSurface"]["components"]
    assert len(components) == 1
    assert components[0]["id"] == "root"
    assert components[0]["type"] == "Text"

    # 5. Push tag and JSON closures
    parts = converter.push_chunk("\n      }\n    ]\n  }\n}\n]\n</a2ui-json>")
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1
    data = a2ui_parts[0].root.data
    assert "createSurface" in data
    assert data["createSurface"]["surfaceId"] == "main"
    assert data["createSurface"]["catalogId"] == "https://a2ui.org/test_catalog"

    # 6. Push trailing text
    parts = converter.push_chunk("\nHope this helps!")
    assert len(parts) == 3  # Text, A2UI block, trailing Text
    assert isinstance(parts[2].root, TextPart)
    assert parts[2].root.text == "Hope this helps!"


def test_express_inference_format_streaming(test_catalog):
    converter = StreamingPartConverter(
        parser=ExpressParser(test_catalog),
        catalog=test_catalog,
    )

    # 1. Push leading text
    parts = converter.push_chunk("Sure, rendering UI:\n")
    assert len(parts) == 1
    assert parts[0].root.text == "Sure, rendering UI:\n"

    # 2. Start of tag and partial surface statement
    parts = converter.push_chunk("<a2ui>\nroot = ")

    # 3. Add component statement
    parts = converter.push_chunk('Text("Welcome")')
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1
    data = a2ui_parts[0].root.data
    components = data["createSurface"]["components"]
    assert len(components) == 1
    assert components[0]["component"] == "Text"
    assert components[0]["text"] == "Welcome"

    # 4. Finalize block
    parts = converter.finalize()
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1


def test_elemental_inference_format_streaming(test_catalog):
    converter = StreamingPartConverter(
        parser=ElementalParser(test_catalog),
        catalog=test_catalog,
    )

    # 1. Start tag
    parts = converter.push_chunk('<a2ui>\n<ui-text text="Hello"')
    # Elemental compiler heals unclosed tag `<ui-text...>`
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1
    data = a2ui_parts[0].root.data
    components = data["createSurface"]["components"]
    assert len(components) == 1
    assert components[0]["component"] == "Text"
    assert components[0]["text"] == "Hello"

    # 2. Finalize
    parts = converter.finalize()
    a2ui_parts = [p for p in parts if isinstance(p.root, DataPart)]
    assert len(a2ui_parts) == 1

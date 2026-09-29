# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests focusing on the Python A2UI Vertical Format implementation.

Data-driven input/output compilation, decompilation, round-trip equality, and response
parsing are comprehensively covered by the platform-agnostic conformance suites in
`conformance/agent/vertical/*.yaml` (run via `tests/conformance/test_conformance.py`).

These unit tests specifically cover Python language-specific aspects that conformance
suites leave to the SDK implementation:
- Real-time incremental streaming chunk parsing and generator lifecycles
- PromptGenerator child-pruning and modular method decomposition
- Python error handling, catalog validation, and sparse catalog tolerance
- Forward-compatible protocol version handling
- Standalone evaluation catalog integration
"""

import pytest
from typing import Any, Dict
from pathlib import Path

from a2ui.inference_formats.experimental.vertical import (
    VerticalFormat,
    VerticalParser,
    VerticalCompiler,
    VerticalPromptGenerator,
)
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9


class MockCatalog:
    """Mock catalog providing required and optional components for tests."""

    def __init__(self):
        self.id = "https://a2ui.org/test_catalog"
        self.catalog_id = "https://a2ui.org/test_catalog"

    def get_components(self) -> Dict[str, Any]:
        return {
            "Column": {
                "properties": {
                    "children": {"type": "array", "items": {"type": "string"}},
                    "align": {"type": "string"},
                },
                "required": ["component", "children"],
            },
            "Row": {
                "properties": {
                    "children": {"type": "array", "items": {"type": "string"}},
                    "justify": {"type": "string"},
                },
                "required": ["component", "children"],
            },
            "Card": {
                "properties": {
                    "child": {"type": "string"},
                },
                "required": ["component", "child"],
            },
            "Text": {
                "properties": {
                    "text": {"type": "string", "positionalIndex": 0},
                    "variant": {"type": "string", "positionalIndex": 1},
                },
                "required": ["component", "text"],
            },
            "Divider": {
                "properties": {
                    "spacing": {"type": "string"},
                },
                "required": ["component"],
            },
            "Image": {
                "properties": {
                    "url": {"type": "string", "positionalIndex": 0},
                    "alt": {"type": "string"},
                },
                "required": ["component", "url"],
            },
            "Button": {
                "properties": {
                    "text": {"type": "string", "positionalIndex": 0},
                    "action": {"type": "Action"},
                    "variant": {"type": "string"},
                },
                "required": ["component", "text"],
            },
            "TextInput": {
                "properties": {
                    "label": {"type": "string", "positionalIndex": 0},
                    "value": {"type": "string"},
                    "placeholder": {"type": "string"},
                    "disabled": {"type": "boolean"},
                },
                "required": ["component", "label"],
            },
            "Slider": {
                "properties": {
                    "value": {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicNumber"
                        ),
                        "positionalIndex": 0,
                    },
                    "min": {"type": "number"},
                    "max": {"type": "number"},
                    "step": {"type": "integer"},
                    "enabled": {"type": "boolean"},
                },
                "required": ["component", "value"],
            },
        }

    def get_functions(self) -> Dict[str, Any]:
        return {
            "openUrl": {"properties": {"url": {"type": "string", "positionalIndex": 0}}}
        }


@pytest.fixture
def mock_catalog():
    return MockCatalog()


@pytest.fixture
def vertical_compiler(mock_catalog):
    return VerticalCompiler(mock_catalog, surface_id="main", version="v0.9.1")


@pytest.fixture
def vertical_format(mock_catalog):
    return VerticalFormat(catalog=mock_catalog, surface_id="main", version="v0.9.1")


def test_prompt_generator_with_real_catalog():
    import json
    from a2ui.core.catalog import Catalog

    repo_root = Path(__file__).resolve().parents[3]
    catalog_path = (
        repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    )
    if catalog_path.exists():
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        catalog = Catalog.from_json(catalog_dict, protocol_version="0.9.1")
        fmt = VerticalFormat(catalog=catalog, surface_id="main")
        prompt = fmt.prompt_generator.generate_system_prompt()
        assert "A2UI Vertical" in prompt
        # Confirm Column, Row, Card (which require children) are omitted
        assert "Column(" not in prompt
        assert "Card(" not in prompt


# =========================================================================
# 5. Format & Parser Integration Tests
# =========================================================================


def test_format_properties_and_streaming(vertical_format):
    assert vertical_format.supports_streaming is True
    assert vertical_format.parser.supports_streaming is True


def test_format_requires_catalog():
    fmt = VerticalFormat(catalog=None)
    with pytest.raises(ValueError, match="Catalog is required"):
        _ = fmt.parser

    with pytest.raises(ValueError, match="Catalog is required"):
        _ = fmt.prompt_generator


def test_unknown_component_handling(vertical_compiler):
    text = '<a2ui>\nUnknownWidget(title="Demo", count=5)\n</a2ui>'
    msgs = vertical_compiler.compile(text)
    assert len(msgs) == 2
    comp = msgs[1]["updateComponents"]["components"][0]
    assert comp["component"] == "UnknownWidget"
    assert comp["title"] == "Demo"
    assert comp["count"] == 5


def test_forward_compatible_protocol_versions(mock_catalog):
    c_legacy = VerticalCompiler(mock_catalog, surface_id="main", version="v0.9.2")
    msgs_legacy = c_legacy.compile('Text("Legacy")')
    assert len(msgs_legacy) == 2
    assert "createSurface" in msgs_legacy[0]
    assert "updateComponents" in msgs_legacy[1]

    c_future = VerticalCompiler(mock_catalog, surface_id="main", version="v1.1")
    msgs_future = c_future.compile('Text("Future")')
    assert len(msgs_future) == 1
    assert "createSurface" in msgs_future[0]
    assert "components" in msgs_future[0]["createSurface"]

    parser_legacy = VerticalFormat(
        catalog=mock_catalog, surface_id="main", version="v0.9.2"
    ).parser
    parts_legacy = parser_legacy.process_chunk(
        '<a2ui>\nText("Streaming Legacy")\n</a2ui>'
    )
    a2ui_legacy = [p for p in parts_legacy if p.a2ui_json]
    assert len(a2ui_legacy) == 1
    assert len(a2ui_legacy[0].a2ui_json) == 2
    assert "createSurface" in a2ui_legacy[0].a2ui_json[0]
    assert "updateComponents" in a2ui_legacy[0].a2ui_json[1]

    parser_future = VerticalFormat(
        catalog=mock_catalog, surface_id="main", version="v1.1"
    ).parser
    parts_future = parser_future.process_chunk(
        '<a2ui>\nText("Streaming Future")\n</a2ui>'
    )
    a2ui_future = [p for p in parts_future if p.a2ui_json]
    assert len(a2ui_future) == 1
    assert len(a2ui_future[0].a2ui_json) == 1
    assert "createSurface" in a2ui_future[0].a2ui_json[0]
    assert "components" in a2ui_future[0].a2ui_json[0]["createSurface"]


def test_sparse_catalog_safety():
    class SparseCatalog:

        def __init__(self):
            self.id = "https://a2ui.org/sparse"
            self.catalog_id = "https://a2ui.org/sparse"

        def get_components(self):
            return {
                "SparseWidget": {},
            }

        def get_functions(self):
            return {
                "sparseFunc": {},
            }

    fmt = VerticalFormat(catalog=SparseCatalog(), surface_id="main")
    prompt = fmt.prompt_generator.generate_system_prompt()
    assert "SparseWidget" in prompt
    assert fmt.prompt_generator.component_requires_children("SparseWidget") is False


def test_prompt_generator_modular_methods(vertical_format):
    pg = vertical_format.prompt_generator
    rules = pg.generate_base_rules()
    assert "# A2UI Vertical Output Contract" in rules
    instructions = pg.generate_catalog_instructions()
    assert "## Component Signatures" in instructions


def test_coercion_with_standalone_catalog():
    repo_root = Path(__file__).resolve().parents[3]
    catalog_path = (
        repo_root / "eval" / "catalogs" / "standalone_components" / "catalog.json"
    )
    if not catalog_path.exists():
        pytest.skip(f"Standalone catalog not found at {catalog_path}")

    with open(catalog_path, "r", encoding="utf-8") as f:
        import json
        from a2ui.schema.catalog import Catalog

        cat_data = json.load(f)
    catalog = Catalog.from_json(cat_data, protocol_version="0.9.1")
    fmt = VerticalFormat(catalog=catalog, surface_id="main", version="v0.9.1")

    raw = """<a2ui>
WeatherWidget(city="Seattle", temperature="58", condition="rainy", high="62", low="50", humidity="82", unit="fahrenheit")
</a2ui>"""
    msgs = fmt.parser.compile(raw, is_final=True)
    w_comp = msgs[1]["updateComponents"]["components"][0]
    assert w_comp["temperature"] == 58
    assert isinstance(w_comp["temperature"], int)
    assert w_comp["high"] == 62
    assert w_comp["low"] == 50
    assert w_comp["humidity"] == 82

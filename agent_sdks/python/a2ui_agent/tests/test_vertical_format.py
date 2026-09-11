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

"""Comprehensive unit tests for the A2UI Vertical inference format."""

import pytest
from typing import Any, Dict
from pathlib import Path

from a2ui.inference_formats.experimental.vertical import (
    VerticalFormat,
    VerticalParser,
    VerticalCompiler,
    VerticalDecompiler,
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
def vertical_decompiler(mock_catalog):
    return VerticalDecompiler(mock_catalog)


@pytest.fixture
def vertical_format(mock_catalog):
    return VerticalFormat(catalog=mock_catalog, surface_id="main", version="v0.9.1")


# =========================================================================
# 1. Compiler Tests
# =========================================================================


def test_compile_single_component(vertical_compiler):
    text = 'Text("Hello world!")'
    messages = vertical_compiler.compile(text)
    assert len(messages) == 2
    update_msg = messages[1]
    assert "updateComponents" in update_msg
    comps = update_msg["updateComponents"]["components"]
    assert len(comps) == 1
    assert comps[0]["id"] == "root"
    assert comps[0]["component"] == "Text"
    assert comps[0]["text"] == "Hello world!"


def test_compile_single_component_v1_0(mock_catalog):
    compiler = VerticalCompiler(mock_catalog, surface_id="main", version="v1.0")
    messages = compiler.compile('Text("V1 Component")')
    assert len(messages) == 1
    create_msg = messages[0]
    assert "createSurface" in create_msg
    comps = create_msg["createSurface"]["components"]
    assert len(comps) == 1
    assert comps[0]["id"] == "root"
    assert comps[0]["text"] == "V1 Component"


def test_compile_multi_component_surface_per_component(vertical_compiler):
    text = """
    Text("Header", variant="h1")
    Divider()
    Text("Subtext", variant="body")
    """
    messages = vertical_compiler.compile(text)
    # 3 components -> 3 surfaces (6 messages in v0.9.1)
    assert len(messages) == 6
    assert messages[0]["createSurface"]["surfaceId"] == "main"
    assert messages[1]["updateComponents"]["surfaceId"] == "main"
    assert messages[1]["updateComponents"]["components"][0]["component"] == "Text"
    assert messages[1]["updateComponents"]["components"][0]["id"] == "root"

    assert messages[2]["createSurface"]["surfaceId"] == "main_1"
    assert messages[3]["updateComponents"]["surfaceId"] == "main_1"
    assert messages[3]["updateComponents"]["components"][0]["component"] == "Divider"
    assert messages[3]["updateComponents"]["components"][0]["id"] == "root"

    assert messages[4]["createSurface"]["surfaceId"] == "main_2"
    assert messages[5]["updateComponents"]["surfaceId"] == "main_2"
    assert messages[5]["updateComponents"]["components"][0]["component"] == "Text"
    assert messages[5]["updateComponents"]["components"][0]["id"] == "root"


def test_compile_multi_component_v1_0(mock_catalog):
    compiler = VerticalCompiler(mock_catalog, surface_id="main", version="v1.0")
    text = """
    Text("Header")
    Button("Click")
    """
    messages = compiler.compile(text)
    assert len(messages) == 2
    assert messages[0]["createSurface"]["surfaceId"] == "main"
    assert messages[0]["createSurface"]["components"][0]["component"] == "Text"
    assert messages[0]["createSurface"]["components"][0]["id"] == "root"
    assert messages[1]["createSurface"]["surfaceId"] == "main_1"
    assert messages[1]["createSurface"]["components"][0]["component"] == "Button"
    assert messages[1]["createSurface"]["components"][0]["id"] == "root"


def test_compile_positional_arguments(vertical_compiler):
    text = 'Text("Positional text", "caption")'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Positional text"
    assert comp["variant"] == "caption"


def test_compile_colon_syntax(vertical_compiler):
    text = 'TextInput(label: "Email", value: "test@example.com", disabled: false)'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["component"] == "TextInput"
    assert comp["label"] == "Email"
    assert comp["value"] == "test@example.com"
    assert comp["disabled"] is False


def test_compile_data_binding(vertical_compiler):
    text = "Text($/user/displayName)"
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == {"path": "/user/displayName"}


def test_compile_action_string_and_event(vertical_compiler):
    # String action
    text1 = 'Button("Submit", action="do_submit")'
    msgs1 = vertical_compiler.compile(text1)
    comp1 = msgs1[1]["updateComponents"]["components"][0]
    assert comp1["action"] == {"event": {"name": "do_submit"}}

    # Event constructor
    text2 = 'Button("Submit", action=Event("do_submit", payload="abc"))'
    msgs2 = vertical_compiler.compile(text2)
    comp2 = msgs2[1]["updateComponents"]["components"][0]
    assert comp2["action"] == {
        "event": {"name": "do_submit", "context": {"payload": "abc"}}
    }


def test_compile_multiline_component(vertical_compiler):
    text = """
    TextInput(
        label="Username",
        placeholder="Enter username here",
        disabled=false
    )
    """
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["component"] == "TextInput"
    assert comp["label"] == "Username"
    assert comp["placeholder"] == "Enter username here"
    assert comp["disabled"] is False


# =========================================================================
# 2. Syntax Healing & Permissive Parsing Tests
# =========================================================================


def test_heal_missing_closing_paren(vertical_compiler):
    # Model forgets closing paren at end of line
    text = 'Text("Unclosed paren"'
    messages = vertical_compiler.compile(text)
    assert len(messages) == 2
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Unclosed paren"


def test_heal_missing_closing_quote(vertical_compiler):
    # Model forgets closing quote
    text = 'Text("Unclosed quote)'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Unclosed quote"


def test_heal_trailing_comma(vertical_compiler):
    text = 'Text("Hello", variant="h1",)'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Hello"
    assert comp["variant"] == "h1"


def test_heal_variable_assignment(vertical_compiler):
    # Model writes root = Text(...) like Express or Python
    text = 'root = Text("Assigned component")'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Assigned component"


def test_heal_json_fallback(vertical_compiler):
    # Model accidentally outputs raw JSON
    text = '{"component": "Text", "text": "JSON Fallback"}'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["component"] == "Text"
    assert comp["text"] == "JSON Fallback"


def test_heal_jsx_fallback(vertical_compiler):
    # Model accidentally outputs JSX/HTML-like tag
    text = '<Text text="JSX Fallback" variant="caption" />'
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["component"] == "Text"
    assert comp["text"] == "JSX Fallback"
    assert comp["variant"] == "caption"


def test_strip_comments_and_markdown_blocks(vertical_compiler):
    text = """
    ```a2ui
    # Top level comment
    Text("Clean text") // trailing line comment
    ; Semicolon comment
    ```
    """
    messages = vertical_compiler.compile(text)
    comp = messages[1]["updateComponents"]["components"][0]
    assert comp["text"] == "Clean text"


# =========================================================================
# 3. Decompiler Tests
# =========================================================================


def test_decompile_single_component(vertical_decompiler):
    payload = {
        "version": "v0.9.1",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{"id": "root", "component": "Text", "text": "Hello"}],
        },
    }
    result = vertical_decompiler.decompile(payload)
    assert result == 'Text(text="Hello")'


def test_decompile_vertical_container(vertical_decompiler):
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Column", "children": ["c1", "c2"]},
                {"id": "c1", "component": "Text", "text": "First"},
                {"id": "c2", "component": "Divider"},
            ],
        },
    }
    result = vertical_decompiler.decompile(payload)
    lines = result.splitlines()
    assert len(lines) == 2
    assert lines[0] == 'Text(text="First")'
    assert lines[1] == "Divider()"


def test_decompile_data_binding_and_event(vertical_decompiler):
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "Button",
                "text": {"path": "/btn/label"},
                "action": {"event": {"name": "click", "context": {"id": 123}}},
            }],
        },
    }
    result = vertical_decompiler.decompile(payload)
    assert "text=$/btn/label" in result
    assert 'action=Event("click", id=123)' in result


def test_wrap_decompiled_blocks(vertical_decompiler):
    wrapped = vertical_decompiler.wrap_decompiled_blocks(['Text("A")', 'Text("B")'])
    assert wrapped.startswith("<a2ui>")
    assert wrapped.endswith("</a2ui>")
    assert 'Text("A")' in wrapped
    assert 'Text("B")' in wrapped


# =========================================================================
# 4. Prompt Generator & Catalog Filtering Tests
# =========================================================================


def test_prompt_generator_filters_children_components(vertical_format):
    prompt = vertical_format.prompt_generator.generate_system_prompt()
    # Leaf components must be present
    assert "Text(" in prompt
    assert "Divider(" in prompt
    assert "TextInput(" in prompt
    assert "Button(" in prompt

    # Structural container components that require children MUST NOT be present as instantiable signatures
    assert "Column(" not in prompt
    assert "Row(" not in prompt
    assert "Card(" not in prompt


def test_prompt_generator_with_real_catalog():
    import json
    from a2ui.core.catalog import Catalog

    repo_root = Path(__file__).resolve().parents[4]
    catalog_path = (
        repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    )
    if catalog_path.exists():
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")
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


def test_vertical_streaming(vertical_format):
    chunks = [
        "Here is the UI:\n<a2ui>\nText(",
        '"First")\nButton(',
        '"Second")\n</a2ui>\nDone!',
    ]
    all_parts = []
    for ch in chunks:
        parts = vertical_format.parser.process_chunk(ch)
        all_parts.extend(parts)

    text_parts = [p.text for p in all_parts if p.text]
    assert any("Here is the UI:" in t for t in text_parts)
    assert any("Done!" in t for t in text_parts)

    a2ui_parts = [p for p in all_parts if p.a2ui_json]
    assert len(a2ui_parts) == 2
    # First surface
    assert a2ui_parts[0].a2ui_json[0]["createSurface"]["surfaceId"] == "main"
    assert (
        a2ui_parts[0].a2ui_json[1]["updateComponents"]["components"][0]["text"]
        == "First"
    )
    # Second surface
    assert a2ui_parts[1].a2ui_json[0]["createSurface"]["surfaceId"] == "main_1"
    assert (
        a2ui_parts[1].a2ui_json[1]["updateComponents"]["components"][0]["text"]
        == "Second"
    )


def test_format_requires_catalog():
    fmt = VerticalFormat(catalog=None)
    with pytest.raises(ValueError, match="Catalog is required"):
        _ = fmt.parser

    with pytest.raises(ValueError, match="Catalog is required"):
        _ = fmt.prompt_generator


def test_parser_unwrap_and_has_format_content(vertical_format):
    text = """
    Here is the UI:
    <a2ui>
    Text("Embedded component")
    </a2ui>
    Done!
    """
    assert vertical_format.parser.has_format_content(text) is True
    parts = vertical_format.parser.unwrap(text)
    assert len(parts) == 2
    assert "Here is the UI:" in parts[0].text
    assert 'Text("Embedded component")' in parts[0].a2ui_raw
    assert "Done!" in parts[1].text
    assert parts[1].a2ui_raw is None


def test_parser_parse_response(vertical_format):
    response = """
    Here is your component:
    <a2ui>
    Text("Parsed successfully")
    </a2ui>
    Let me know if you need anything else!
    """
    parsed = vertical_format.parser.parse_response(response)
    assert len(parsed) == 2
    assert "Here is your component:" in parsed[0].text
    assert parsed[0].a2ui_json is not None
    assert parsed[0].a2ui_json[1]["updateComponents"]["components"][0]["text"] == (
        "Parsed successfully"
    )
    assert "Let me know if you need anything else!" in parsed[1].text


def test_parse_arg_chunk_leading_colon(vertical_compiler):
    msgs = vertical_compiler.compile('TextInput(:label "Your Name")')
    assert len(msgs) == 2
    comp = msgs[1]["updateComponents"]["components"][0]
    assert comp["component"] == "TextInput"
    assert comp["label"] == "Your Name"

    msgs2 = vertical_compiler.compile('TextInput(:label: "Your Name")')
    assert len(msgs2) == 2
    comp2 = msgs2[1]["updateComponents"]["components"][0]
    assert comp2["label"] == "Your Name"


def test_unclosed_quotes_healing_across_lines(vertical_compiler):
    text = '<a2ui>\nText("Hello\nButton("Click")\n</a2ui>'
    msgs = vertical_compiler.compile(text)
    assert len(msgs) == 4
    assert msgs[1]["updateComponents"]["components"][0]["component"] == "Text"
    assert msgs[3]["updateComponents"]["components"][0]["component"] == "Button"


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


def test_quoted_numbers_and_booleans_coercion(mock_catalog):
    fmt = VerticalFormat(catalog=mock_catalog, surface_id="main", version="v0.9.1")
    raw = """<a2ui>
Slider(value="42.5", min="0", max="100.0", step="5", enabled="true")
</a2ui>"""
    msgs = fmt.parser.compile(raw, is_final=True)
    # In v0.9.1, emits createSurface + updateComponents
    assert len(msgs) == 2
    assert "createSurface" in msgs[0]
    assert "updateComponents" in msgs[1]

    comp = msgs[1]["updateComponents"]["components"][0]
    assert comp["value"] == 42.5
    assert isinstance(comp["value"], float)
    assert comp["min"] == 0
    assert comp["max"] == 100.0
    assert comp["step"] == 5
    assert isinstance(comp["step"], int)
    assert comp["enabled"] is True
    assert isinstance(comp["enabled"], bool)


def test_coercion_preserves_data_bindings_and_positionals(mock_catalog):
    fmt = VerticalFormat(catalog=mock_catalog, surface_id="main", version="v0.9.1")
    raw = """<a2ui>
Slider("$/state/volume", min="0", max="10", step="1", enabled="false")
</a2ui>"""
    msgs = fmt.parser.compile(raw, is_final=True)
    comp = msgs[1]["updateComponents"]["components"][0]
    assert comp["value"] == "$/state/volume"
    assert comp["min"] == 0
    assert comp["max"] == 10
    assert comp["step"] == 1
    assert comp["enabled"] is False


def test_coercion_with_standalone_catalog():
    repo_root = Path(__file__).resolve().parents[4]
    catalog_path = (
        repo_root / "eval" / "catalogs" / "standalone_components" / "catalog.json"
    )
    if not catalog_path.exists():
        pytest.skip(f"Standalone catalog not found at {catalog_path}")

    with open(catalog_path, "r", encoding="utf-8") as f:
        import json
        from a2ui.schema.catalog import Catalog

        cat_data = json.load(f)
    catalog = Catalog.from_json(cat_data, spec_version="0.9.1")
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


def test_coercion_percentage_and_signs():
    repo_root = Path(__file__).resolve().parents[4]
    catalog_path = (
        repo_root / "eval" / "catalogs" / "standalone_components" / "catalog.json"
    )
    if not catalog_path.exists():
        pytest.skip(f"Standalone catalog not found at {catalog_path}")

    with open(catalog_path, "r", encoding="utf-8") as f:
        import json
        from a2ui.schema.catalog import Catalog

        cat_data = json.load(f)
    catalog = Catalog.from_json(cat_data, spec_version="0.9.1")
    fmt = VerticalFormat(catalog=catalog, surface_id="main", version="v0.9.1")

    raw = """<a2ui>
MetricsTile(label="MRR", value="$1.42M", changePercent="+10.9%", trend="up", period="vs prior month")
</a2ui>"""
    msgs = fmt.parser.compile(raw, is_final=True)
    m_comp = msgs[1]["updateComponents"]["components"][0]
    assert m_comp["changePercent"] == 10.9
    assert isinstance(m_comp["changePercent"], float)

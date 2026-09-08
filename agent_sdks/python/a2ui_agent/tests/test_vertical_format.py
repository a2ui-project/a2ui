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


def test_compile_multi_component_automatic_column_wrapping(vertical_compiler):
    text = """
    Text("Header", variant="h1")
    Divider()
    Text("Subtext", variant="body")
    """
    messages = vertical_compiler.compile(text)
    comps = messages[1]["updateComponents"]["components"]
    # Root Column wrapping 3 children
    assert len(comps) == 4
    root = comps[0]
    assert root["id"] == "root"
    assert root["component"] == "Column"
    assert root["children"] == ["comp_0", "comp_1", "comp_2"]

    assert comps[1]["id"] == "comp_0"
    assert comps[1]["component"] == "Text"
    assert comps[1]["text"] == "Header"
    assert comps[1]["variant"] == "h1"

    assert comps[2]["id"] == "comp_1"
    assert comps[2]["component"] == "Divider"

    assert comps[3]["id"] == "comp_2"
    assert comps[3]["component"] == "Text"
    assert comps[3]["text"] == "Subtext"


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
    assert vertical_format.supports_streaming is False
    assert vertical_format.parser.supports_streaming is False

    with pytest.raises(NotImplementedError):
        vertical_format.parser.process_chunk("chunk")


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

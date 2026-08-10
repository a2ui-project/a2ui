# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Quick-compiler and decompiler CLI utility tools for testing inference formats."""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

current = Path(__file__).resolve()
REPO_ROOT = current.parents[5]
for p in [current] + list(current.parents):
    if (p / "specification").exists() and (p / "agent_sdks").exists():
        REPO_ROOT = p
        break

SDK_SRC = str(REPO_ROOT / "agent_sdks/python/a2ui_agent/src")
SDK_CORE_SRC = str(REPO_ROOT / "agent_sdks/python/a2ui_core/src")
if SDK_SRC not in sys.path:
    sys.path.insert(0, SDK_SRC)
if SDK_CORE_SRC not in sys.path:
    sys.path.insert(0, SDK_CORE_SRC)

from a2ui.schema.catalog import CatalogConfig
from a2ui.inference_formats.direct_json import DirectJsonFormat


def _load_basic_catalog() -> Any:
    """Loads and resolves the basic component catalog instance.

    Returns:
        The loaded catalog instance for basic components.
    """
    cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
    cat_cfg = CatalogConfig.from_path("basic", cat_path)
    direct_json_format = DirectJsonFormat(
        version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
    )
    return direct_json_format.get_selected_catalog()


def test_compile_snippet(format_name: str, snippet: str) -> str:
    """Compiles an inference format snippet into an A2UI v1.0 JSON payload string.

    Args:
        format_name: The target format strategy name (e.g., "atom", "express").
        snippet: The raw code snippet string to compile.

    Returns:
        A formatted JSON string representing the compiled surface update.

    Raises:
        ValueError: If the format strategy name is unsupported.
    """
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()

    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom import AtomCompiler

        compiler = AtomCompiler(catalog=cat)
        res = compiler.compile(snippet)
    elif fmt_lower in ("direct_json", "transport", "direct"):
        res = json.loads(snippet) if isinstance(snippet, str) else snippet
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express.parser import ExpressParser

        parser = ExpressParser(catalog=cat)
        res = parser.compile(snippet)
    elif fmt_lower == "elemental":
        from a2ui.inference_formats.experimental.elemental.parser import ElementalParser

        parser = ElementalParser(catalog=cat)
        res = parser.compile(snippet)
    else:
        raise ValueError(
            f"Unsupported format strategy for compilation: '{format_name}'"
        )

    return json.dumps(res, indent=2)


def test_decompile_payload(format_name: str, json_str_or_dict: Any) -> str:
    """Decompiles an A2UI v1.0 JSON surface payload into a target format string.

    Args:
        format_name: The target format strategy name (e.g., "atom", "express").
        json_str_or_dict: A JSON file path, JSON string, or payload dictionary.

    Returns:
        The decompiled target format string representation.

    Raises:
        ValueError: If the format strategy name is unsupported.
    """
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()

    payload: Dict[str, Any]
    if isinstance(json_str_or_dict, str):
        if os.path.isfile(json_str_or_dict):
            with open(json_str_or_dict, "r", encoding="utf-8") as f:
                payload = json.load(f)
        else:
            payload = json.loads(json_str_or_dict)
    else:
        payload = json_str_or_dict

    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom import AtomDecompiler

        decompiler = AtomDecompiler(catalog=cat)
        return decompiler.decompile(payload)
    elif fmt_lower in ("direct_json", "transport", "direct"):
        return json.dumps(payload, indent=2)
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express.parser import ExpressParser

        parser = ExpressParser(catalog=cat)
        return parser.decompile(payload)
    elif fmt_lower == "elemental":
        from a2ui.inference_formats.experimental.elemental.parser import ElementalParser

        parser = ElementalParser(catalog=cat)
        return parser.decompile(payload)
    else:
        raise ValueError(
            f"Unsupported format strategy for decompilation: '{format_name}'"
        )


def test_parse_ast(format_name: str, snippet: str) -> str:
    """Parses an inference format snippet into its abstract syntax tree representation.

    Args:
        format_name: The target format strategy name (e.g., "atom", "express").
        snippet: The raw code snippet string to parse.

    Returns:
        A formatted string representation of the parsed AST nodes.

    Raises:
        ValueError: If the format strategy name is unsupported.
    """
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()
    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom.compiler import SExprParser

        parser = SExprParser(snippet)
        ast = parser.parse()
        return json.dumps(ast, indent=2)
    elif fmt_lower in ("direct_json", "transport", "direct"):
        return json.dumps(json.loads(snippet), indent=2)
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express.parser import ExpressParser

        parser = ExpressParser(catalog=cat)
        parts = parser.unwrap(snippet)
        return str([str(p) for p in parts])
    elif fmt_lower == "elemental":
        from a2ui.inference_formats.experimental.elemental.parser import ElementalParser

        parser = ElementalParser(catalog=cat)
        parts = parser.unwrap(snippet)
        return str([str(p) for p in parts])
    else:
        raise ValueError(
            f"Unsupported format strategy for AST parsing: '{format_name}'"
        )

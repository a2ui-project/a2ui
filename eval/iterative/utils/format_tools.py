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
from pathlib import Path
from typing import Any, Dict

from a2ui.schema.catalog import CatalogConfig
from a2ui.inference_formats.transport import TransportFormat


def _load_basic_catalog() -> Any:
    script_dir = Path(__file__).resolve().parent
    eval_root = script_dir.parent.parent
    workspace_root = eval_root.parent

    cat_path = str(workspace_root / "specification/v1_0/catalogs/basic/catalog.json")
    cat_cfg = CatalogConfig.from_path("basic", cat_path)
    transport_format = TransportFormat(
        version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
    )
    return transport_format.get_selected_catalog()


def test_compile_snippet(format_name: str, snippet: str) -> str:
    """Compiles an inference format payload snippet into A2UI v1.0 JSON payload."""
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()

    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom import AtomCompiler

        compiler = AtomCompiler(catalog=cat)
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express import ExpressCompiler

        compiler = ExpressCompiler(catalog=cat)  # type: ignore[assignment]
    elif fmt_lower == "elemental":
        from a2ui.inference_formats.experimental.elemental import ElementalCompiler

        compiler = ElementalCompiler(catalog=cat)  # type: ignore[assignment]
    else:
        raise ValueError(
            f"Unsupported format strategy for compilation: '{format_name}'"
        )

    res = compiler.compile(snippet)
    return json.dumps(res, indent=2)


def test_decompile_payload(format_name: str, json_str_or_dict: Any) -> str:
    """Decompiles an A2UI v1.0 JSON payload into format target string."""
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()

    payload: Dict[str, Any]
    if isinstance(json_str_or_dict, str):
        payload = json.loads(json_str_or_dict)
    else:
        payload = json_str_or_dict

    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom import AtomDecompiler

        decompiler = AtomDecompiler(catalog=cat)
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express import ExpressDecompiler

        decompiler = ExpressDecompiler(catalog=cat)  # type: ignore[assignment]
    else:
        raise ValueError(
            f"Unsupported format strategy for decompilation: '{format_name}'"
        )

    return decompiler.decompile(payload)


def test_parse_ast(format_name: str, snippet: str) -> str:
    """Parses an inference format payload snippet into raw AST node structure representation."""
    cat = _load_basic_catalog()
    fmt_lower = format_name.lower()
    if fmt_lower == "atom":
        from a2ui.inference_formats.experimental.atom.compiler import SExprParser

        parser = SExprParser(snippet)
        ast = parser.parse()
        return json.dumps(ast, indent=2)
    elif fmt_lower == "express":
        from a2ui.inference_formats.experimental.express.parser import ExpressParser

        parser = ExpressParser(catalog=cat)
        parts = parser.unwrap(snippet)
        return str([p.content for p in parts])
    elif fmt_lower == "elemental":
        from a2ui.inference_formats.experimental.elemental.parser import ElementalParser

        parser = ElementalParser(catalog=cat)
        parts = parser.unwrap(snippet)
        return str([p.content for p in parts])
    else:
        raise ValueError(
            f"Unsupported format strategy for AST parsing: '{format_name}'"
        )

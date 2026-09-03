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

"""Shared utilities for A2UI Pydantic model generation."""

import ast
import re
from typing import Any

FILE_HEADER = """# Copyright 2024 Google LLC
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

# Auto-generated. Do not edit manually.
from __future__ import annotations"""


def ensure_v_prefix(version: str) -> str:
    """Ensures a version string has a 'v' or 'V' prefix (e.g. '0.9' -> 'v0.9')."""
    if not version:
        raise ValueError("version is required")
    v = version.strip()
    return v if v.startswith("v") or v.startswith("V") else f"v{v}"


def version_to_underscore(version: str) -> str:
    """Converts a dotted version string (e.g. 'v0.9', '0.8') to underscore format (e.g. 'v0_9', 'v0_8')."""
    v = ensure_v_prefix(version)
    return v.lower().replace(".", "_")


def is_modern_terminology(version: str, a2r_name: str = "") -> bool:
    """Returns True if modern A2UI terminology (agent_to_renderer / renderer_to_agent) is used."""
    if "agent_to_renderer" in a2r_name:
        return True
    if "server_to_client" in a2r_name:
        return False

    import os

    dir_name = version_to_underscore(version)
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
    spec_path = os.path.join(repo_root, "specification", dir_name)
    if os.path.exists(
        os.path.join(spec_path, "json", "agent_to_renderer.json")
    ) or os.path.exists(os.path.join(spec_path, "agent_to_renderer.json")):
        return True
    if os.path.exists(
        os.path.join(spec_path, "json", "server_to_client.json")
    ) or os.path.exists(os.path.join(spec_path, "server_to_client.json")):
        return False

    return dir_name not in ("v0_8", "v0_9", "v0_9_1")


def to_snake_case(name: str) -> str:
    """Converts a camelCase or PascalCase identifier to snake_case."""
    if name == "$schema":
        return "schema_uri"
    if name == "$id":
        return "schema_id"
    if name == "$defs":
        return "defs"
    if name.startswith("$"):
        name = name[1:]
    if re.match(r"^v\d+(?:_\d+)*$", name):
        return name
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def to_pascal_case(name: str) -> str:
    """Converts a camelCase or snake_case string to PascalCase preserving camelCase segments."""
    if not name:
        return name
    if "_" not in name and "-" not in name and " " not in name:
        return name[0].upper() + name[1:]
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    parts = clean.split("_")
    return "".join(p[0].upper() + p[1:] for p in parts if p)


def extract_exported_symbols(code: str) -> list[str]:
    """Extracts top-level public class names, function names, and variable/alias assignments from Python code."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    symbols: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if not node.name.startswith("_"):
                symbols.append(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and not target.id.startswith("_"):
                    symbols.append(target.id)
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and not node.target.id.startswith("_"):
                symbols.append(node.target.id)
    return list(dict.fromkeys(symbols))


def get_base_common_symbols(common_types_path: str | None = None) -> list[str]:
    """Extracts public symbols defined in schema/common_types.py dynamically via AST."""
    import os

    if not common_types_path:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.abspath(os.path.join(script_dir, "../../../.."))
        common_types_path = os.path.join(
            repo_root, "python/a2ui_core/src/a2ui/core/schema/common_types.py"
        )
    if os.path.exists(common_types_path):
        with open(common_types_path, "r", encoding="utf-8") as f:
            symbols = extract_exported_symbols(f.read())
            if symbols:
                return symbols
    return []


def get_schema_dependencies(node: Any, deps: set[str] | None = None) -> set[str]:
    """Recursively extracts all local #/$defs/ references from a schema node."""
    if deps is None:
        deps = set()
    if not node or not isinstance(node, (dict, list)):
        return deps
    if isinstance(node, list):
        for item in node:
            get_schema_dependencies(item, deps)
        return deps
    if isinstance(node, dict):
        if "$ref" in node and isinstance(node["$ref"], str):
            ref = node["$ref"]
            if "#/$defs/" in ref:
                deps.add(ref.split("#/$defs/")[-1])
            elif ref.startswith("#/definitions/"):
                deps.add(ref.split("#/definitions/")[-1])
        for v in node.values():
            get_schema_dependencies(v, deps)
    return deps


def topological_sort_defs(defs: dict[str, Any]) -> list[str]:
    """Topologically sorts schema definitions by their internal $defs dependencies."""
    graph: dict[str, set[str]] = {}
    for name, def_spec in defs.items():
        deps = get_schema_dependencies(def_spec)
        # Break cycles between dynamic values and function calls:
        # In Python, DynamicValue/Dynamic* are type aliases (... | FunctionCall)
        # evaluated at import time, so FunctionCall must precede DynamicValue.
        # The reference from FunctionCall.args to DynamicValue is an annotation
        # resolved via `from __future__ import annotations`.
        if name == "FunctionCall":
            deps.discard("IndexSystemFunction")
            deps.discard("DynamicValue")
        graph[name] = {d for d in deps if d in defs and d != name}

    visited: set[str] = set()
    order: list[str] = []

    def visit(name: str) -> None:
        if name in visited:
            return
        visited.add(name)
        for dep in graph.get(name, set()):
            if dep in graph:
                visit(dep)
        order.append(name)

    # Prioritize foundational core types first
    core_prio = ["DataBinding", "FunctionCall"]
    for key in core_prio:
        if key in graph:
            visit(key)

    for name in list(defs.keys()):
        visit(name)

    return order


def find_common_refs(
    node: Any,
    common_def_names: set[str],
    common_defs: dict[str, Any] | None = None,
) -> set[str]:
    """Recursively extracts all referenced common_types schema names, following common def dependencies."""
    refs: set[str] = set()

    def _scan(curr: Any) -> None:
        if not curr or not isinstance(curr, (dict, list)):
            return
        if isinstance(curr, list):
            for item in curr:
                _scan(item)
            return
        if isinstance(curr, dict):
            if "$ref" in curr and isinstance(curr["$ref"], str):
                ref = curr["$ref"]
                if "#/$defs/" in ref:
                    target = ref.split("#/$defs/")[-1]
                    if target in common_def_names:
                        refs.add(target)
                elif ref.startswith("common_types.json#/$defs/"):
                    target = ref.split("#/$defs/")[-1]
                    if target in common_def_names:
                        refs.add(target)
            for v in curr.values():
                _scan(v)

    _scan(node)

    if common_defs:
        added = True
        while added:
            added = False
            for r in list(refs):
                if r in common_defs:
                    sub_deps = get_schema_dependencies(common_defs[r])
                    for sd in sub_deps:
                        if sd in common_def_names and sd not in refs:
                            refs.add(sd)
                            added = True

    return refs

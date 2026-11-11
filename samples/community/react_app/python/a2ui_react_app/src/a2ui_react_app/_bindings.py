# Copyright 2026 Google LLC
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

"""Typed bindings: the `a2ui:bindings` module generated from the catalogs' functions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
import re
from typing import Any

from a2ui.core import CatalogApi

from ._catalog import read_asset
from ._schema_ts import RETURN_TYPES, args_schema, select_functions, ts_object

__all__ = ["BINDINGS_MODULE", "ReactAppBindings", "react_app_bindings"]

BINDINGS_MODULE = "a2ui:bindings"
"""The module name an app imports its typed functions from."""

_IDENTIFIER_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*", re.ASCII)
# Shared with the frame runtime, which builds the module from the same rules.
_RESERVED = frozenset(json.loads(read_asset("reserved_words.json"))["words"])


def is_binding_name(name: str) -> bool:
    """Whether a function name can be bound: an ASCII identifier, not reserved."""
    return _IDENTIFIER_RE.fullmatch(name) is not None and name not in _RESERVED


@dataclass(frozen=True)
class ReactAppBindings:
    """The `a2ui:bindings` module of a set of catalogs.

    Attributes:
        names: The function names the module exports, sorted. Empty when no
            function can be bound.
        declarations: The module's TypeScript declarations, for the prompt.
    """

    names: tuple[str, ...]
    declarations: str


def _jsdoc(definition: Mapping[str, Any]) -> list[str]:
    lines: list[str] = []
    description = definition.get("description")
    if isinstance(description, str) and description.strip():
        lines += description.strip().splitlines()
    args = args_schema(definition) or {}
    for arg_name, schema in (args.get("properties") or {}).items():
        text = schema.get("description") if isinstance(schema, Mapping) else None
        if isinstance(text, str) and text.strip():
            lines.append(f"@param args.{arg_name} {text.strip().splitlines()[0]}")
    if not lines:
        return []
    return ["  /**", *(f"   * {line}".rstrip() for line in lines), "   */"]


def react_app_bindings(
    catalogs: Sequence[CatalogApi],
    functions: Sequence[str] | None = None,
) -> ReactAppBindings:
    """Generates the `a2ui:bindings` declarations for the catalogs' functions.

    Each function becomes a typed async wrapper over `callFunction`, which takes
    the function's named arguments as one object and resolves to its result:

    ```ts
    import { estimateTravelTime } from "a2ui:bindings";
    const minutes = await estimateTravelTime({ stops });
    ```

    The frame runtime builds the module's implementation from the names the app
    imports, so only the declarations travel, in the prompt. Names that aren't
    ASCII identifiers, and reserved words such as `delete` or `package`, can't
    be imported and are left out.

    Args:
        catalogs: The catalogs whose functions to bind, agent functions included.
        functions: The names to bind. None binds every function an app can
            call (see `react_app_prompt`).

    Returns:
        The bindings. `names` is empty when no function can be bound.

    Raises:
        A2uiCatalogError: If `functions` names a function no catalog declares.
    """
    definitions, selected = select_functions(catalogs, functions)
    names = [n for n in selected if is_binding_name(n)]
    body: list[str] = [
        f"declare module '{BINDINGS_MODULE}' {{",
        "  import type { CallFunctionOptions, JsonValue } from 'a2ui';",
    ]
    for name in names:
        definition = definitions[name]
        args = args_schema(definition)
        args_type = ts_object(args) if args and args.get("properties") else "{}"
        optional = "" if args and args.get("required") else "?"
        return_type = RETURN_TYPES.get(str(definition.get("returnType")), "JsonValue")
        body += [
            "",
            *_jsdoc(definition),
            (
                f"  export function {name}(args{optional}: {args_type}, options?:"
                f" CallFunctionOptions): Promise<{return_type}>;"
            ),
        ]
    body.append("}")
    return ReactAppBindings(names=tuple(names), declarations="\n".join(body) + "\n")

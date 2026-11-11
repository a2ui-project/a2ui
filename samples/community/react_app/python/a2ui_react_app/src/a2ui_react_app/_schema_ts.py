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

"""Catalog function schemas written as TypeScript, for the prompt and the bindings."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
import json
from typing import Any

from a2ui.core import A2uiCatalogError, CatalogApi

_DYNAMIC_TYPES = {
    "DynamicString": "string",
    "DynamicNumber": "number",
    "DynamicBoolean": "boolean",
    "DynamicStringList": "string[]",
    "DynamicValue": "JsonValue",
}
RETURN_TYPES = {
    "string": "string",
    "number": "number",
    "boolean": "boolean",
    "array": "JsonValue[]",
    "object": "{ [key: string]: JsonValue }",
    "void": "void",
}


def ts_type(schema: Any) -> str:
    """Writes a JSON schema as a TypeScript type, for a function signature."""
    if not isinstance(schema, Mapping):
        return "JsonValue"
    ref = schema.get("$ref")
    if isinstance(ref, str):
        return _DYNAMIC_TYPES.get(ref.rsplit("/", 1)[-1], "JsonValue")
    if "const" in schema:
        return json.dumps(schema["const"])
    if isinstance(schema.get("enum"), list):
        return " | ".join(json.dumps(v) for v in schema["enum"])
    for key in ("oneOf", "anyOf"):
        if isinstance(schema.get(key), list):
            return " | ".join(dict.fromkeys(ts_type(s) for s in schema[key]))
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return " | ".join(ts_type({**schema, "type": t}) for t in schema_type)
    if schema_type == "string":
        return "string"
    if schema_type in ("number", "integer"):
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        item = ts_type(schema.get("items"))
        return f"({item})[]" if " " in item else f"{item}[]"
    if schema_type == "object" and isinstance(schema.get("properties"), Mapping):
        return ts_object(schema)
    if schema_type == "object":
        return "{ [key: string]: JsonValue }"
    return "JsonValue"


def ts_object(schema: Mapping[str, Any]) -> str:
    """Writes an object schema with `properties` as a TypeScript object type."""
    properties: Mapping[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    fields = [
        f"{name}{'' if name in required else '?'}: {ts_type(prop)}"
        for name, prop in properties.items()
    ]
    return "{ " + "; ".join(fields) + " }" if fields else "{}"


def args_schema(definition: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Returns the `args` schema of a catalog function definition, if it has one."""
    candidates = [definition]
    if isinstance(definition.get("allOf"), list):
        candidates += [s for s in definition["allOf"] if isinstance(s, Mapping)]
    for candidate in candidates:
        props = candidate.get("properties")
        if isinstance(props, Mapping) and isinstance(props.get("args"), Mapping):
            args: Mapping[str, Any] = props["args"]
            return args
    return None


def function_definitions(
    catalogs: Sequence[CatalogApi],
) -> Iterator[tuple[str, Mapping[str, Any]]]:
    """Yields every function the catalogs declare, with its catalog definition.

    The definitions come from each catalog's document (`to_json`), which writes
    agent functions in the same shape as the others.
    """
    for catalog in catalogs:
        functions = catalog.to_json().get("functions") or {}
        if isinstance(functions, Mapping):
            entries = list(functions.items())
        else:
            entries = [(f.get("name"), f) for f in functions if isinstance(f, Mapping)]
        for name, definition in entries:
            if isinstance(name, str) and isinstance(definition, Mapping):
                yield name, definition


def callable_by_default(definition: Mapping[str, Any]) -> bool:
    """Whether an app can usefully call a function it wasn't told about.

    This leaves out functions the renderer refuses to run for components
    (`agentOnly`), functions that need a user gesture, which a call from the
    frame doesn't carry, and validation checks, which belong in `checks`.
    """
    return (
        definition.get("allowedCallers") != "agentOnly"
        and not definition.get("requiresUserActivation")
        and definition.get("returnType") != "validationResult"
    )


def select_functions(
    catalogs: Sequence[CatalogApi], functions: Sequence[str] | None
) -> tuple[dict[str, Mapping[str, Any]], list[str]]:
    """Picks the functions to show an app, with their definitions.

    Args:
        catalogs: The catalogs whose functions to read, agent functions included.
        functions: The names to pick. None picks every function an app can
            call (`callable_by_default`).

    Returns:
        Every declared function's definition, by name (the first catalog that
        declares a name wins), and the picked names, sorted and unique.

    Raises:
        A2uiCatalogError: If `functions` names a function no catalog declares.
    """
    definitions: dict[str, Mapping[str, Any]] = {}
    for name, definition in function_definitions(catalogs):
        definitions.setdefault(name, definition)
    if functions is None:
        names = [n for n, d in definitions.items() if callable_by_default(d)]
    else:
        unknown = [n for n in functions if n not in definitions]
        if unknown:
            raise A2uiCatalogError(
                f"No catalog declares the functions {unknown}. Declared functions:"
                f" {sorted(definitions)}."
            )
        names = list(functions)
    return definitions, sorted(set(names))

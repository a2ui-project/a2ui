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

"""The prompt fragment that teaches a model to write `ReactApp` components."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
import json
import re
from typing import Any

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.express import ExpressDecompiler

from ._catalog import (
    REACT_APP_CATALOG_ID,
    example_documents,
    react_app_catalog,
    read_typings,
)

_PROMPT_EXAMPLE = "Loan amortization explorer"

_RULES = '''## ReactApp: custom interactive apps

`ReactApp` runs a small React app that you write as one TSX file. It renders in an isolated frame inside the surface, next to the native components, and reaches the surface only through the `a2ui` module.

### When to use it

- Use `ReactApp` only for interactive UI that the native components can't express: custom charts with interactions, drag and drop, brushing, canvases, timers and games.
- Build everything else from native components: headings, labels, sliders, text fields, buttons and lists. Don't rebuild them inside the app.
- Connect the app and the native components through shared data model paths. A native component bound to `$/loan/rate` and an app that calls `useData('/loan/rate', 5)` read and write the same value. Give those paths initial values in the data model.
- Put data you already have, such as tool results, lists and chart series, in the data model (for example `$/sales/points = [...]`) and read it in the app with `useData`. Don't copy data into the source.
- List the paths the app reads and writes in `dataPaths`, and the functions it calls in `functions`. Never set `compiled`.

### Writing the source

- `source` is one TSX file that default-exports a component named `App`, which takes no props: `export default function App() { ... }`.
- Import only from `react` and `a2ui`. The app has no network access, no other packages and no access to the host page.
- Write `ReactApp` with keyword arguments only: `ReactApp(source=r"""...""", title="...", height=360, dataPaths=[...], functions=[...])`.
- Write `source` inline in the `ReactApp(...)` call as a raw triple-quoted string: `source=r"""` directly followed by the code, then `"""` to close it. Nothing inside a raw string is escaped, so write the code exactly as it should run.
- Never put three double quotes in a row inside the code, and don't end the code with a double quote. Use single quotes or template literals for strings in the code instead.
- Keep values that the surface or the agent needs in the data model with `useData`. Keep purely visual state, such as hover or drag state, in React state.

### Modules

- `react`: React 19, with hooks such as `useState`, `useEffect`, `useMemo` and `useRef`.
- `a2ui`: data model access, function calls, actions, the theme, `VegaChart` charts and styled primitives. Its full typings follow.

### The `a2ui` module

```ts
{typings}
```

### Styling

- Use the `a2ui` primitives (`Card`, `Button`, `Text`, `Slider`, `Stack`) and `theme`, so the app looks like the native components.
- For custom CSS, use the theme variables, `var(--a2ui-*)`. Never hard-code colors or fonts: no `'#ccc'`, `'rgb(...)'` or font names in the code. Use `var(--a2ui-color-border)` for borders, `<Text tone="muted">` for secondary text and `var(--a2ui-color-primary)` for highlights.
- Leave colors and fonts out of `VegaChart` specs, including `scale.range`: the chart takes them, and a palette for series, from the theme. Where a spec needs a literal color, use `theme.colors.primary` or `theme.colors.secondary`.

### Functions the app can call

{functions}'''

_FUNCTIONS_INTRO = (
    "Call these with `callFunction(name, args)` or `useFunction(name, args)`,"
    " passing plain JSON values as `args`. Agent functions run on the"
    " server and can take a few seconds, so show a loading state while they"
    " run."
)
_NO_FUNCTIONS = "The catalogs declare no functions that the app can call."

_DYNAMIC_TYPES = {
    "DynamicString": "string",
    "DynamicNumber": "number",
    "DynamicBoolean": "boolean",
    "DynamicStringList": "string[]",
    "DynamicValue": "JsonValue",
}
_RETURN_TYPES = {
    "string": "string",
    "number": "number",
    "boolean": "boolean",
    "array": "JsonValue[]",
    "object": "{ [key: string]: JsonValue }",
    "void": "void",
}
_LICENSE_HEADER_RE = re.compile(r"\A\s*/\*.*?Copyright.*?\*/\s*", re.DOTALL)


def _typings_for_prompt() -> str:
    """Returns `a2ui.d.ts` without its license header, which only costs tokens."""
    return _LICENSE_HEADER_RE.sub("", read_typings(), count=1).rstrip()


def _ts_type(schema: Any) -> str:
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
            return " | ".join(dict.fromkeys(_ts_type(s) for s in schema[key]))
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return " | ".join(_ts_type({**schema, "type": t}) for t in schema_type)
    if schema_type == "string":
        return "string"
    if schema_type in ("number", "integer"):
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        item = _ts_type(schema.get("items"))
        return f"({item})[]" if " " in item else f"{item}[]"
    if schema_type == "object" and isinstance(schema.get("properties"), Mapping):
        return _ts_object(schema)
    if schema_type == "object":
        return "{ [key: string]: JsonValue }"
    return "JsonValue"


def _ts_object(schema: Mapping[str, Any]) -> str:
    """Writes an object schema with `properties` as a TypeScript object type."""
    properties: Mapping[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    fields = [
        f"{name}{'' if name in required else '?'}: {_ts_type(prop)}"
        for name, prop in properties.items()
    ]
    return "{ " + "; ".join(fields) + " }" if fields else "{}"


def _args_schema(definition: Mapping[str, Any]) -> Mapping[str, Any] | None:
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


def _function_definitions(
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


def _callable_by_default(definition: Mapping[str, Any]) -> bool:
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


def _indent(text: str, width: int = 2) -> str:
    """Indents every line of a description, so it stays inside its list item."""
    prefix = " " * width
    return "\n".join(
        prefix + line if line.strip() else "" for line in text.strip().splitlines()
    )


def _describe_function(name: str, definition: Mapping[str, Any]) -> str:
    """Writes a function's signature, description and argument descriptions."""
    args = _args_schema(definition)
    args_type = _ts_object(args) if args and args.get("properties") else "{}"
    return_type = _RETURN_TYPES.get(str(definition.get("returnType")), "JsonValue")
    lines = [f"- `{name}(args: {args_type}): {return_type}`"]
    description = definition.get("description")
    if isinstance(description, str) and description:
        lines.append(_indent(description))
    properties = (args or {}).get("properties") or {}
    for arg_name, arg_schema in properties.items():
        arg_description = (
            arg_schema.get("description") if isinstance(arg_schema, Mapping) else None
        )
        if isinstance(arg_description, str) and arg_description:
            lines.append(f"  - `{arg_name}`: " + _indent(arg_description, 4).lstrip())
    return "\n".join(lines)


def _functions_section(
    catalogs: Sequence[CatalogApi], functions: Sequence[str] | None
) -> str:
    definitions: dict[str, Mapping[str, Any]] = {}
    for name, definition in _function_definitions(catalogs):
        definitions.setdefault(name, definition)
    if functions is None:
        names = [n for n, d in definitions.items() if _callable_by_default(d)]
    else:
        unknown = [n for n in functions if n not in definitions]
        if unknown:
            raise A2uiCatalogError(
                f"No catalog declares the functions {unknown}. Declared functions:"
                f" {sorted(definitions)}."
            )
        names = list(dict.fromkeys(functions))
    if not names:
        return _NO_FUNCTIONS
    entries = [_describe_function(n, definitions[n]) for n in sorted(names)]
    return _FUNCTIONS_INTRO + "\n\n" + "\n".join(entries)


def _catalog_ids(messages: Sequence[Mapping[str, Any]]) -> set[str]:
    """Returns every catalog ID that wire-format messages name."""
    ids: set[str] = set()
    for message in messages:
        created = message.get("createSurface") or {}
        if isinstance(created.get("catalogId"), str):
            ids.add(created["catalogId"])
        for envelope in ("createSurface", "updateComponents"):
            for component in (message.get(envelope) or {}).get("components") or []:
                if isinstance(component.get("catalogId"), str):
                    ids.add(component["catalogId"])
    return ids


def _example_section(catalogs: Sequence[CatalogApi]) -> str | None:
    """Writes the worked example in Express, or None if the catalogs can't."""
    document = next(d for d in example_documents() if d["name"] == _PROMPT_EXAMPLE)
    messages: list[Mapping[str, Any]] = document["messages"]
    if not _catalog_ids(messages) <= {c.catalog_id for c in catalogs}:
        return None
    decompiler = ExpressDecompiler([*catalogs])
    dsl = decompiler.decompile(to_message_models(messages), use_keyword_args=True)
    return (
        f"### Example: {document['name']}\n\n{document['description']}\n\n"
        + decompiler.wrap_decompiled_blocks([dsl])
    )


def react_app_prompt(
    catalogs: Sequence[CatalogApi],
    functions: Sequence[str] | None = None,
) -> str:
    """Returns the prompt fragment that teaches a model to write `ReactApp` apps.

    Add it to the system prompt next to the inference format's own prompt.
    It holds the rules for when and how to write a `ReactApp`, the modules the
    app can import, the full `a2ui` module typings, the styling rules, the
    functions the app can call and, when the catalogs can express it, a worked
    example in Express.

    Args:
        catalogs: The inference catalogs, as `ReactAppTransformer.transform_catalogs`
            returns them. The functions they declare, agent functions
            included, are listed for the app. The ReactApp catalog is added
            if it is missing. The worked example uses the v1.0 basic
            catalog, and is left out unless `catalogs` has it.
        functions: The names of the functions to list. None lists every
            declared function that an app can call: not `agentOnly`, not
            needing a user gesture, and not a validation check.

    Returns:
        The prompt fragment, in Markdown.

    Raises:
        A2uiCatalogError: If `functions` names a function that no catalog
            declares.
    """
    if not any(c.catalog_id == REACT_APP_CATALOG_ID for c in catalogs):
        catalogs = [*catalogs, react_app_catalog()]
    # The typings go in last, so that nothing inside them is substituted.
    rules = _RULES.replace(
        "{functions}", _functions_section(catalogs, functions)
    ).replace("{typings}", _typings_for_prompt())
    sections = [rules]
    example = _example_section(catalogs)
    if example is not None:
        sections.append(example)
    return "\n\n".join(sections)

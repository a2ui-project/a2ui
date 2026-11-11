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

from collections.abc import Mapping, Sequence
import re
from typing import TYPE_CHECKING, Any

from a2ui.core import CatalogApi
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.express import ExpressDecompiler

from ._catalog import (
    REACT_APP_CATALOG_ID,
    example_documents,
    react_app_catalog,
    read_typings,
)
from ._schema_ts import RETURN_TYPES, args_schema, select_functions, ts_object

if TYPE_CHECKING:
    from ._bindings import ReactAppBindings

_PROMPT_EXAMPLE = "Loan amortization explorer"

_RULES = '''## ReactApp: custom interactive apps

`ReactApp` runs a small React app that you write as one TSX file. It renders in an isolated frame inside the surface, next to the native components, and reaches the surface only through the `a2ui` module.

### When to use it

- Use `ReactApp` only for interactive UI that the native components can't express: custom charts with interactions, drag and drop, brushing, canvases, timers and games.
- Build everything else from native components: headings, labels, sliders, text fields, buttons and lists. Don't rebuild them inside the app.
- Connect the app and the native components through shared data model paths. A native component bound to `$/loan/rate` and an app that calls `useData('/loan/rate', 5)` read and write the same value. Give those paths initial values in the data model.
- Put data you already have, such as tool results, lists and chart series, in the data model (for example `$/sales/points = [...]`) and read it in the app with `useData`. Don't copy data into the source.
- List the paths the app reads and writes in `dataPaths`, the functions it calls in `functions`, and the actions it dispatches in `actions`. Never set `compiled`.

### Writing the source

- `source` is one TSX file that default-exports a component named `App`, which takes no props: `export default function App() { ... }`.
- Import only from `react` and `a2ui`. The app has no network access, no other packages and no access to the host page.
- Never call `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`, and never navigate the frame: the browser blocks them. Get outside data through an agent function or put it in the data model. If the user asks for live or external data, or a library, that you can't provide, say so in your text; never simulate it with made-up or random values.
- Write `ReactApp` with keyword arguments only: `ReactApp(source=r"""...""", title="...", height=360, dataPaths=[...], functions=[...])`.
- Write `source` inline in the `ReactApp(...)` call as a raw triple-quoted string: `source=r"""` directly followed by the code, then `"""` to close it. Nothing inside a raw string is escaped, so write the code exactly as it should run.
- Never put three double quotes in a row inside the code, and don't end the code with a double quote. Use single quotes or template literals for strings in the code instead.
- Keep values that the surface or the agent needs in the data model with `useData`. Keep purely visual state, such as hover or drag state, in React state.
- Call hooks (`useData`, `useFunction`, `useState`, `useEffect` and the others) only at the top level of a component, never inside effects, event handlers, loops or conditions. To write a value from an effect or a handler, call the setter of a top-level `useData`.
- Each value the app writes with `setData`, and the `args` of each function call, must stay under 64 KB. Keep big data in the data model and write ids or small changes.

### Changing a surface in a later turn

Surfaces from earlier turns are still on screen, and creating one again fails. To change one, write `surface("<id>", update=true)` and then only what changes: components under their existing ids (each replaces the component with that id), and `$/path = value` lines for data. Write `root = ...` only when the root itself changes. To change an app, write its `ReactApp` again under the same id with the whole new source; the frame reloads with it. Use a new surface id for a new, unrelated UI.

```
surface("loan", update=true)
chart = ReactApp(source=r"""...the whole new source...""", title="Loan balance", height=360, dataPaths=["/loan/rate", "/loan/years"])
$/loan/years = 15
```

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
- Avoid nested vertical scrollbars inside the app: never put fixed heights with `overflow-y: scroll` or `auto` inside cards or panels. Let the app flow naturally so the frame resizes to fit, wrap items (`wrap`), or paginate. For horizontal collections, use modern hidden-scrollbar carousels with `className="a2ui-carousel"` or `className="a2ui-scroll-x a2ui-scroll-hidden"`.
- Native `ChoicePicker` in the data model stores values as string arrays (e.g. `["All"]` or `["EMEA"]`). Normalize array values before passing to functions or logic: `const [val] = useData<any>('/path', 'All'); const picked = Array.isArray(val) ? (val[0] || 'All') : val;`.

### Functions the app can call

{functions}'''

_BINDINGS_SECTION = """### Typed functions: `a2ui:bindings`

Import the functions the app calls from `a2ui:bindings` instead of naming them in `callFunction`. Each one takes the function's arguments as one object and returns a promise of its result, and a wrong name or argument fails the server's type check before the app ships. For results that follow app state, keep using `useFunction`.

```ts
import { formatCurrency } from "a2ui:bindings";
const label = await formatCurrency({ value: 1200, currency: "USD" });
```

```ts
{declarations}
```"""

_FUNCTIONS_INTRO = (
    "Call these with `callFunction(name, args)` or `useFunction(name, args)`,"
    " passing plain JSON values as `args`. Only the names below are functions:"
    " `setData`, `getData` and the rest of the `a2ui` module are imported and"
    " called directly, never through `callFunction`, and never listed in"
    " `functions`. Agent functions run on the"
    " server and can take a few seconds, so show a loading state while they"
    " run."
)
_NO_FUNCTIONS = "The catalogs declare no functions that the app can call."

_LICENSE_HEADER_RE = re.compile(r"\A\s*/\*.*?Copyright.*?\*/\s*", re.DOTALL)


def _typings_for_prompt() -> str:
    """Returns `a2ui.d.ts` without its license header, which only costs tokens."""
    return _LICENSE_HEADER_RE.sub("", read_typings(), count=1).rstrip()


def _indent(text: str, width: int = 2) -> str:
    """Indents every line of a description, so it stays inside its list item."""
    prefix = " " * width
    return "\n".join(
        prefix + line if line.strip() else "" for line in text.strip().splitlines()
    )


def _describe_function(name: str, definition: Mapping[str, Any]) -> str:
    """Writes a function's signature, description and argument descriptions."""
    args = args_schema(definition)
    args_type = ts_object(args) if args and args.get("properties") else "{}"
    return_type = RETURN_TYPES.get(str(definition.get("returnType")), "JsonValue")
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
    definitions, names = select_functions(catalogs, functions)
    if not names:
        return _NO_FUNCTIONS
    entries = [_describe_function(n, definitions[n]) for n in names]
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
    *,
    bindings: ReactAppBindings | None = None,
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
        bindings: The `a2ui:bindings` declarations (`react_app_bindings`).
            When they bind at least one function, the prompt includes them
            and asks the app to import its functions from `a2ui:bindings`.

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
    if bindings is not None and bindings.names:
        sections.append(
            _BINDINGS_SECTION.replace("{declarations}", bindings.declarations.rstrip())
        )
    example = _example_section(catalogs)
    if example is not None:
        sections.append(example)
    return "\n\n".join(sections)

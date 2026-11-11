# a2ui-react-app (labs)

Agent-side support for `ReactApp`, an A2UI component whose content is a small React app that the model writes inline in its response. The app renders in a sandboxed frame next to the native components, and talks to the surface data model and to catalog and agent functions through the `a2ui` module. [`docs/bridge_protocol.md`](../../docs/bridge_protocol.md) specifies that bridge.

The package gives an agent:

- `react_app_catalog()` and `REACT_APP_CATALOG_ID`: the catalog that defines `ReactApp` (A2UI v1.0).
- `react_app_examples()`: example turns that pair a `ReactApp` with native basic-catalog components.
- `react_app_prompt(catalogs, functions=None)`: the prompt fragment. It has the rules for when and how to write a `ReactApp`, the modules an app can import, the full `a2ui.d.ts`, the styling rules, the functions the app can call (read from the catalogs, agent functions included) and a worked example in Express.
- `ReactAppTransformer`: a catalog and message transformer with the same shape as `MacroExpander`. It adds the ReactApp catalog to the inference catalogs, and checks every outbound `ReactApp` before it reaches the renderer.
- `check_react_app(component)`, `ReactAppDiagnostic` and `ReactAppValidationError`: the same checks as structured data, for a repair loop.
- `react_app_bindings(catalogs)`: the declarations of the `a2ui:bindings` module, one typed async function per catalog function, agent functions included. Pass them to `react_app_prompt(..., bindings=...)`, and the app imports its functions instead of naming them in `callFunction`. Names that aren't ASCII identifiers, and reserved words such as `delete`, are left out.

## Usage

```python
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart
from a2ui_react_app import ReactAppTransformer, react_app_prompt

transformer = ReactAppTransformer(on_error="raise")
catalogs = transformer.transform_catalogs([BasicCatalog("1.0")])

fmt = ExpressFormat(catalogs, surface_id="main")
system_prompt = "\n\n".join([
    fmt.prompt_generator.generate(),
    react_app_prompt(catalogs),
])

# ... call the model with system_prompt, then:
parts = fmt.create_parser().parse_response(llm_output)
transport_messages = [
    message
    for part in parts
    if isinstance(part, A2uiPart)
    for message in transformer.transform_to_transport(part.a2ui)
]
```

To let the app call agent functions, add them to the catalog with `Catalog.copy_with(agent_functions=[...])` before you call `transform_catalogs`. `react_app_prompt` lists them with the catalog functions. Pass `functions=[...]` to list only some functions.

## Checks

`transform_to_transport` checks each `ReactApp` whose `catalogId` is `REACT_APP_CATALOG_ID` (or that has no `catalogId` on a surface whose default catalog is the ReactApp catalog, has none, or isn't known):

- `source` is a non-empty string with a default export.
- `source` imports only `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `a2ui` and `a2ui:bindings`, with static imports.
- `source` has no three double quotes in a row, which would end the raw Express string early.
- `dataPaths` holds JSON pointers and `functions` holds names.
- `height` is a positive number.
- `compiled` is absent: only the agent server sets it.

These checks need no TypeScript toolchain, and they don't type-check the code. With `on_error="raise"`, a failure raises `ReactAppValidationError`, an `A2uiValidationError` whose message lists every problem, so a retry loop can send it back to the model. With `on_error="passthrough"` (the default), the transformer logs a warning and sends the message, and the renderer shows its error card. `transformer.check(messages)` returns the problems as `ReactAppDiagnostic` values without raising.

## Development

The package sits inside the repository's root uv workspace, but it isn't a member of it. Its `pyproject.toml` declares an empty `[tool.uv.workspace]`, which makes this directory a workspace of its own, with its own `uv.lock`, so `uv` never edits the root workspace. `a2ui-agent-sdk` and `a2ui-core` are editable path dependencies on `python/a2ui_agent` and `python/a2ui_core`, so the package always runs against the SDK source in the same checkout. When the package moves to `a2ui/labs`, they switch to published versions.

Run the commands from this directory:

```sh
uv sync
uv run pytest
uv run pyink --check .
uv run mypy
```

The wheel ships copies of `catalog/v1/catalog.json`, `catalog/v1/examples/*.json` and `typescript/react_app_runtime/src/a2ui.d.ts` under `src/a2ui_react_app/assets/`. After you change any of them, refresh the copies:

```sh
uv run python scripts/sync_assets.py
```

`tests/test_assets.py` fails while a copy differs from its source.

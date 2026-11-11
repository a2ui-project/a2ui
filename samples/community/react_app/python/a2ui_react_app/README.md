# a2ui-react-app (labs)

Agent-side support for `ReactApp`, an A2UI component whose content is a small React app that the model writes inline in its response. The app renders in a sandboxed frame next to the native components, and talks to the surface data model and to catalog and agent functions through the `a2ui` module. [`docs/bridge_protocol.md`](../../docs/bridge_protocol.md) specifies that bridge.

The package gives an agent:

- `react_app_catalog()` and `REACT_APP_CATALOG_ID`: the catalog that defines `ReactApp` (A2UI v1.0).
- `react_app_examples()`: example turns that pair a `ReactApp` with native basic-catalog components.
- `react_app_prompt(catalogs, functions=None)`: the prompt fragment. It has the rules for when and how to write a `ReactApp`, the modules an app can import, the full `a2ui.d.ts`, the styling rules, the functions the app can call (read from the catalogs, agent functions included) and a worked example in Express.
- `ReactAppTransformer`: a catalog and message transformer with the same shape as `MacroExpander`. It adds the ReactApp catalog to the inference catalogs, and checks every outbound `ReactApp` before it reaches the renderer.
- `check_react_app(component, functions=...)`, `ReactAppDiagnostic` and `ReactAppValidationError`: the same checks as structured data, for a repair loop.
- `react_app_source_facts(source)`: what a source reads, writes, calls, dispatches and imports, read with regular expressions. The checks, the transformer and the evals all use it.
- `ReactAppCompiler`: a client of the compile worker of `@a2ui-labs/react-app-compiler`, which transpiles with Sucrase and type-checks with a warm TypeScript language service. Given to `ReactAppTransformer(compiler=...)`, it fills in each app's `compiled`, so the frame skips its own transpile.
- `react_app_bindings(catalogs)`: the declarations of the `a2ui:bindings` module, one typed async function per catalog function, agent functions included. Pass them to `react_app_prompt(..., bindings=...)` and to the transformer, and a wrong call fails the type check. Names that aren't ASCII identifiers, and reserved words such as `delete`, are left out.
- `repair_react_app(...)`, `compile_and_repair(...)` and `repair_system_instruction(...)`: send a failing source and its diagnostics back to the model (with rules and declarations in the system instruction and dynamic backtick fences), re-check both structural rules and types, and swap in the candidate only when it improves on the original. `gemini_generate()` is a ready model call (install the `gemini` extra).

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

### Server compile and typed bindings

```python
import asyncio
from a2ui_react_app import (
    ReactAppCompiler, ReactAppTransformer, react_app_bindings, react_app_prompt,
)

compiler = ReactAppCompiler()
compiler.start()  # warm the Node worker at startup (~2 s) so the first request is fast
catalogs = ReactAppTransformer().transform_catalogs([BasicCatalog("1.0"), app_catalog])
bindings = react_app_bindings(catalogs)
transformer = ReactAppTransformer(
    on_error="raise", compiler=compiler, bindings=bindings
)
system_prompt = "\n\n".join([
    ExpressFormat(catalogs).prompt_generator.generate(),
    react_app_prompt(catalogs, bindings=bindings),
])

# ... in an async handler, run the synchronous compile in a worker thread:
transport_messages = await asyncio.to_thread(
    transformer.transform_to_transport, messages
)
```

The worker is `dist/worker.js` of `typescript/react_app_compiler`; build it with `yarn build` in `samples/community/react_app`, or point `A2UI_REACT_APP_COMPILER` (or `ReactAppCompiler(worker_path=...)`) at it. Call `compiler.start()` at agent startup and wrap `transform_to_transport` in `asyncio.to_thread` so the event loop never blocks on the synchronous stdio round-trip (~100 ms warm). `ReactAppTransformer(type_errors="warning")` logs type errors instead of failing on them, and still sends `compiled`. If the worker is unavailable or crashes on a component, the transformer logs a warning, records a `compile_unavailable` diagnostic, and sends the component without `compiled` so the frame transpiles it.

## Checks

`transform_to_transport` checks each `ReactApp` whose `catalogId` is `REACT_APP_CATALOG_ID` (or that has no `catalogId` on a surface whose default catalog is the ReactApp catalog, has none, or isn't known). First it fills in `dataPaths`, `functions` and `actions` when a ReactApp leaves them out and its source names everything it uses with string literals, because the surface refuses whatever a ReactApp doesn't list. Then it checks:

- `source` is a non-empty string with a default export.
- `source` imports only `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `a2ui` and `a2ui:bindings`, with static imports.
- `source` has no three double quotes in a row, which would end the raw Express string early.
- `source` uses no browser API the frame blocks (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, navigation, `window.open`).
- `source` calls no hook inside an effect or memo callback, an event handler or a loop callback, which React rejects with error #321.
- Every function the source calls (`callFunction`, `useFunction`, `a2ui:bindings`) or `functions` lists is a catalog function, not an `a2ui` module function such as `setData`. After `transform_catalogs`, it must also be one the catalogs declare and an app can call.
- `dataPaths` holds JSON pointers (absolute, or relative to the component's data context), and `functions` and `actions` hold names. Each list is present when the source needs it and covers every literal path and name the source uses.
- `height` is a positive number.
- `compiled` is stripped by `ReactAppTransformer.process()` before the checks (`check_react_app` flags `compiled_set` if called directly on a component with `compiled`). Only the agent server sets `compiled`, and `compiled` carries the same trust as `source`: the double-iframe sandbox, CSP and bridge allowlists are the security boundary.

These checks need no TypeScript toolchain. With a `compiler`, the transformer then compiles and type-checks each app that passed them; transpile errors are `compile_error` diagnostics and type errors `type_error` ones. With `on_error="raise"`, a failure raises `ReactAppValidationError`, an `A2uiValidationError` whose message lists every problem, so a retry loop can send it back to the model. With `on_error="passthrough"` (the default), the transformer logs a warning and sends the message, and the renderer shows its error card. `transformer.check(messages)` returns the problems as `ReactAppDiagnostic` values without raising.

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

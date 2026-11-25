---
codebase_path: python/a2ui_core
associated_module: a2ui_core
module_blueprint_commit: 7fae1b763868a90078280f779b4f59e012a0ffb7
implemented_features:
  agent_functions: 87b945802660c507bc84f7f47a25199b4939efbe
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Python implementation of the A2UI Core State Layer (`a2ui_core`).

- **Validation**: Leverages `pydantic` (v2) for strongly-typed input validation, `jsonschema` for validating message boundaries, and `SurfaceComponentsModel.validate_topology` / `validate_references` for structural graph validation.
- **Reactivity**: Uses a lightweight custom synchronous `Signal`, `EventSource`, and `Subscription` tracker inside `a2ui.core.common` alongside `DataContext`, `GenericBinder`, `ComponentContext`, `ResolvedBinding`, `NodeResolver`, and `ComponentNode` in `a2ui.core.resolution`.

## **Local Technical Decisions & Overrides**

- **Explicit Synchronous Parsing**: Optimized for headless execution contexts. Message boundaries are strictly synchronized, raising custom `A2uiValidationError` on failures.
- **Auto-vivification Rules**: The JSON pointer implementation dynamically converts missing paths into dicts or list elements on setting nested undefined values.
- **Derived catalogs**: `Catalog.derive` and `Catalog.copy_with` share one builder. `copy_with` keeps the source's id and descriptive fields and is typed as a schema-only `CatalogApi`; `derive` takes a new id, drops `$id`, title, description and instructions, and keeps the source's entry types.
- **Nested resolution**: `GenericBinder` walks list and object properties at runtime, binding actions and bindings inside them as at the top level. Bound props are plain dictionaries, so there is no typed property set to update.
- **Event-driven node resolution and metadata**: `NodeResolver` exposes `root` (`ComponentNode | None`) and `on_root_replaced` (`EventSource`). `ComponentNode` exposes snapshot `props` and defensive-copy `metadata` properties paired with `on_updated`, `on_metadata_changed`, and `on_destroyed` (`EventSource`s), keeping `is_valid`, `validation_errors`, and `validation_results` as attributes on `ComponentNode` rather than inside `node.props` while emitting `on_updated` whenever either `props` or those validation attributes change. `SurfaceModel` emits metadata updates via `on_metadata_changed` without a separate `metadata_signal`.
- **Agent functions on the catalog**: `Catalog.agent_functions` and `Catalog.renderer_functions` are computed from `functions` (whether an entry is an `AgentFunction`) rather than stored, so `copy_with`, `derive` and the agent SDK's function pruning keep them consistent without extra code. `renderer_functions` returns a new `dict[str, TFunction]` on each read, so changing it leaves the catalog as it is. An `AgentFunction` handler may take `(args)` or `(args, context)`; its signature is inspected once, at construction, with `inspect.signature`. `handler` is a read-only property and `with_handler` returns a copy, and `AgentFunctionContext` is a frozen keyword-only dataclass.
- **Agent function fallback routing and caching**: `MessageProcessorOptions` configures `default_timeout_ms` (`30000.0`) and `max_agent_call_cache_entries` (`256`). `SurfaceModel` deduplicates in-flight `call_agent_function` futures and bounds settled reactive call answers in a FIFO `OrderedDict`.

## **Validation & Execution Recipes**

- **Test execution**: Run `uv run pytest` to execute unit tests.
- **Code verification**: Run linting audits using `uv run pyink --check .`.
- **Formatting**: Auto-format styling with `uv run pyink .`.

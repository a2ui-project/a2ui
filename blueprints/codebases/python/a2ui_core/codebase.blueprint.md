---
codebase_path: python/a2ui_core
associated_module: a2ui_core
module_blueprint_commit: ab3954fdef84d1bea723128ceac41cf88a5979cb
implemented_features: {}
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Python implementation of the A2UI Core State Layer (`a2ui_core`).

- **Validation**: Leverages `pydantic` (v2) for strongly-typed input validation, `jsonschema` for validating message boundaries, and `SurfaceComponentsModel.validate_topology` / `validate_references` for structural graph validation.
- **Reactivity**: Uses a lightweight custom synchronous `Signal` and subscription tracker inside `a2ui.core.common` alongside `DataContext`, `GenericBinder`, `ComponentContext`, and `ResolvedBinding` in `a2ui.core.resolution` (`NodeResolver` and `ComponentNode` are omitted as renderer-only constructs).

## **Local Technical Decisions & Overrides**

- **Explicit Synchronous Parsing**: Optimized for headless execution contexts. Message boundaries are strictly synchronized, raising custom `A2uiValidationError` on failures.
- **Auto-vivification Rules**: The JSON pointer implementation dynamically converts missing paths into dicts or list elements on setting nested undefined values.
- **Derived catalogs**: `Catalog.derive` and `Catalog.copy_with` share one builder. `copy_with` keeps the source's id and descriptive fields and is typed as a schema-only `CatalogApi`; `derive` takes a new id, drops `$id`, title, description and instructions, and keeps the source's entry types.
- **Nested resolution**: `GenericBinder` walks list and object properties at runtime, binding actions and bindings inside them as at the top level. Bound props are plain dictionaries, so there is no typed property set to update.
- **No renderer**: The Python SDK has no renderer, so it does not implement the optional `agent_renderer_app` feature.

## **Validation & Execution Recipes**

- **Test execution**: Run `uv run pytest` to execute unit tests.
- **Code verification**: Run linting audits using `uv run pyink --check .`.
- **Formatting**: Auto-format styling with `uv run pyink .`.

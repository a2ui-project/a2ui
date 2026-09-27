---
codebase_path: python/a2ui_core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features: []
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

## **Validation & Execution Recipes**

- **Test execution**: Run `uv run pytest` to execute unit tests.
- **Code verification**: Run linting audits using `uv run pyink --check .`.
- **Formatting**: Auto-format styling with `uv run pyink .`.

---
codebase_path: typescript/core/web_core
associated_module: a2ui_core
module_blueprint_commit: ab3954fdef84d1bea723128ceac41cf88a5979cb
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
  universal_custom_elements: b1dd650750c6072b4a42f95b03420273d099965e
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Web Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

This is the reference TypeScript implementation of the A2UI Core State Layer (`a2ui_core`).

- **Reactivity & Signaling**: Powered by `@preact/signals-core` (`Signal`, `ReadonlySignal`, `computed`, `effect`, `batch`) paired with `EventSource<T>`, `EventNotifier<T>`, and `Subscription` for discrete lifecycle events under `src/reactivity/` and `src/events/`.
- **Validation & Parsing**: Employs `zod` and JSON Schema validation (`src/validation/`) alongside topological graph/composition checks (`SurfaceComponentsModel`) and protocol-versioned processors (`src/processing/`, `src/v0_9/`, `src/v1_0/`).
- **Resolution & Binding**: `DataContext`, `ComponentContext`, `GenericBinder`, `NodeResolver`, and `ComponentNode` resolve reactive component trees, `ResolvedBinding` values, and check rule evaluations under `src/resolution/`.
- **Universal Custom Elements**: `src/universal/` implements `A2uiLitElement`, `A2uiController`, `defineA2uiElement`, and `registerUniversalElement` so Web Component catalogs run across Lit, React, and Angular.

## **Local Technical Decisions & Overrides**

- **Unified State & Version Entrypoints**: Shared state and resolution primitives live under `src/{state,processing,resolution,rpc,validation,universal}` while `src/v0_9/` and `src/v1_0/` expose version-specific schemas and subpath barrels.
- **Transitional `ComponentNode.context` Property**: `ComponentNode` retains a transitional `context?: ComponentContext` property alongside `props` so legacy or standalone callers can access `ComponentContext` during incremental adapter migration.

## **Validation & Execution Recipes**

- **Test execution**: Run unit and conformance tests using `yarn test`.
- **Linting check**: Ensure style alignment with `yarn lint`.
- **Formatting**: Format the entire directory with `yarn format`.

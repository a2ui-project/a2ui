---
codebase_path: renderers/web_core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Web Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

This is the reference TypeScript implementation of the A2UI Core State Layer (`a2ui_core`).

- **Reactivity & Signaling**: Powered by `@preact/signals-core`. Standard multi-cast BehaviorSubjects and discrete EventEmitters coordinate state changes, allowing reactive updates to bubble and cascade efficiently.
- **Validation & Parsing**: Employs `zod` for type-safe compile-time assertions and `zod-to-json-schema` to dynamically output compliant client capabilities.
- **Pathing**: Native string-based and array-based JSON Pointer resolver matching the custom relative and absolute data binding requirements.

## **Local Technical Decisions & Overrides**

- **TypeScript Reflection**: We utilize Zod runtime reflection to implement the automated generic binder layer. This automatically resolves complex properties (such as `DynamicString` or action callbacks) into simple static native types, freeing renderers (React, Angular, Lit) from having to deal with raw subscription loops.
- **State Partitioning**: State is segmented under `src/v0_9/state` and `src/v1_0/state` to support side-by-side protocol evolution while sharing utilities inside `src/common`.

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests using `yarn test`.
- **Linting check**: Ensure style alignment with `yarn lint`.
- **Formatting**: Format the entire directory with `yarn format`.

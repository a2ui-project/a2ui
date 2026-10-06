---
codebase_path: typescript/web_core
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
- **Unified State & Protocol Agnosticism**: State is consolidated under `src/state` to power a single, version-agnostic runtime supporting both v0.9 and v1.0 messages, while v0.8 remains isolated under `src/v0_8`.

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests using `yarn test`.
- **Linting check**: Ensure style alignment with `yarn lint`.
- **Formatting**: Format the entire directory with `yarn format`.

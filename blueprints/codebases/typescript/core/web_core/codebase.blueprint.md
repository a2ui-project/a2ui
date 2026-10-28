---
codebase_path: typescript/core/web_core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features:
  - agent_renderer_app
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

- **TypeScript Reflection**: We utilize Zod runtime reflection to implement the automated generic binder layer. This automatically resolves complex properties (such as `DynamicString` or action callbacks) into simple static native types, freeing renderers (React, Angular, Lit) from having to deal with raw subscription loops. `ResolveA2uiProps` mirrors the binder at the type level, inside lists and objects too, and leaves lists of `CheckRule` as they are, as the binder does.
- **Per-call validation config**: `MessageProcessor` reads its `validationConfig` from a field in many private checks, so a config passed in `ExecutionContext` replaces the field for the synchronous part of that call and restores it after. `processMessagesAsync` applies it around each synchronous step.
- **State Partitioning**: State is segmented under `src/v0_9/state` and `src/v1_0/state` to support side-by-side protocol evolution while sharing utilities inside `src/common`.

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests using `yarn test`.
- **Linting check**: Ensure style alignment with `yarn lint`.
- **Formatting**: Format the entire directory with `yarn format`.

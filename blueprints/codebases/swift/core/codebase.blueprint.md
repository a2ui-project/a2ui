---
codebase_path: swift/core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'swift test'
  lint_command: 'swift-format lint -r Package.swift swift/core'
  format_command: 'swift-format format -i -r Package.swift swift/core'
---

# **Swift Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The native Swift runtime processing engine and state model implementation for A2UI.

- **A2UIJSON** (`swift/core/Sources/A2UIJSON`): Decoupled target defining A2UI JSON Schema
  2020-12 structures and remote schema resolution.
- **A2UICore** (`swift/core/Sources/A2UICore`): Stateful engine managing message processing,
  JSON pointer cascades, DataModel bindings, and action dispatch.
- **BasicCatalog** (`swift/core/Sources/BasicCatalog`): Core schemas and function handlers
  for the standard Basic Catalog.
- **Swift Testing**: Uses Apple's native Swift Testing framework (`import Testing`).

## **Local Technical Decisions & Overrides**

- **Target Boundaries**: Separates core protocol parsing from SwiftUI rendering to allow
  non-UI use cases (such as CLI tools or server integrations).
- **Safe Evaluation**: Avoids force-unwrapping (`!`) and forced tries (`try!`), propagating
  errors or providing fallbacks.
- **Per-call validation config**: `processMessages(_:validationConfig:)` takes the config of one
  call as a parameter rather than in an execution context object, since Swift has no
  `processMessagesAsync` and a message carries its own user activation. Validators are cached per
  catalog and config, so a call with its own config gets validators built for it.
- **`MessageProcessor.catalogs`**: Returns the catalogs as the processor was created with them,
  before they are erased to `AnyCatalog`.
- **`Catalog.derive` entries**: Swift has no union of a name and an entry, so `derive` takes the
  names of the entries to keep in `components` and `functions`, and the new entries in
  `addComponents` and `addFunctions`, which replace a kept entry of the same name. A Swift
  `Catalog` has no `$id`, title, description or instructions, so `derive` has none to drop and
  takes no instructions.
- **Nested values in the resolver**: `NodeResolver` resolves actions, bindings and child lists
  inside lists and objects, as the module blueprint requires. Its properties are
  `[String: any Resolved]`, so there are no property types to follow it.

## **Validation & Execution Recipes**

- **Test execution**: Run core tests via `swift test --filter A2UICoreTests`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/core`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/core`.

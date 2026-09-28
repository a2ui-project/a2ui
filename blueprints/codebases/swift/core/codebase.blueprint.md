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

## **Validation & Execution Recipes**

- **Test execution**: Run core tests via `swift test --filter A2UICoreTests`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/core`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/core`.

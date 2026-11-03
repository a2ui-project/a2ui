---
codebase_path: swift/core
associated_module: a2ui_core
module_blueprint_commit: ab3954fdef84d1bea723128ceac41cf88a5979cb
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
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
  JSON pointer cascades, DataModel bindings, reactive `NodeResolver` / `ComponentNode` trees
  (`Sources/A2UICore/Resolution/NodeResolver.swift`), and action dispatch.
- **BasicCatalog** (`swift/core/Sources/BasicCatalog`): Core schemas and function handlers
  for the standard Basic Catalog.
- **Swift Testing**: Uses Apple's native Swift Testing framework (`import Testing`).

## **Local Technical Decisions & Overrides**

- **Target Boundaries**: Separates core protocol parsing from SwiftUI rendering to allow
  non-UI use cases (such as CLI tools or server integrations).
- **Safe Evaluation**: Avoids force-unwrapping (`!`) and forced tries (`try!`), propagating
  errors or providing fallbacks.
- **Derived catalogs**: `Catalog.derive` takes lists of `DerivedCatalogEntry`, an enum of a
  name to keep (`.keep`, or a string literal) and a new entry (`.add`). A Swift catalog has no
  `$id`, title, description or instructions, so `derive` takes no instructions and has nothing
  else to drop.
- **Renderer fallback routing**: Fallback routing to the agent is implemented as the module blueprint's RPC layer describes, with `MessageProcessor.agentFunctionTimeoutSeconds` as the routed call timeout. `module_blueprint_commit` stays at its older pin because the codebase has not caught up with earlier module changes, such as the per-call `ExecutionContext` (`isUserActivated`) of `processMessages`.
- **No agent**: The Swift SDK is a renderer only, so it does not implement the optional
  `agent_renderer_app` feature.

## **Validation & Execution Recipes**

- **Test execution**: Run core tests via `swift test --filter A2UICoreTests`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/core`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/core`.

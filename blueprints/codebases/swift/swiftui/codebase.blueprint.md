---
codebase_path: swift/swiftui
associated_module: a2ui_framework_adapter
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'swift test --filter A2UISwiftUITests'
  lint_command: 'swift-format lint -r Package.swift swift/swiftui'
  format_command: 'swift-format format -i -r Package.swift swift/swiftui'
---

# **SwiftUI Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The native SwiftUI rendering adaptation layer for A2UI.

- **A2UISwiftUI** (`swift/swiftui/Sources/A2UISwiftUI`): Bridge layer hosting the root `Surface`
  view, recursive `ComponentNodeView`, dynamic binding helpers, and theme injection.
- **BasicCatalogSwiftUI** (`swift/swiftui/Sources/BasicCatalog`): Native SwiftUI component
  implementations conforming to `ComponentImplementation` for all Basic Catalog elements.
- **Swift Testing**: Validates view instantiation, property binding, dynamic child lists,
  theme propagation, and stress scenarios.

## **Local Technical Decisions & Overrides**

- **Declarative View Construction**: Maps core node signals and bindings to SwiftUI `@State`,
  `@ObservedObject`, or environment keys.
- **Dynamic Catalog Registration**: Components register builders producing SwiftUI views
  keyed by component type names.

## **Validation & Execution Recipes**

- **Test execution**: Run SwiftUI unit tests via `swift test --filter A2UISwiftUITests`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/swiftui`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/swiftui`.

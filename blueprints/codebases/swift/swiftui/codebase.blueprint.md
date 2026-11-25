---
codebase_path: swift/swiftui
associated_module: a2ui_framework_adapter
module_blueprint_commit: b1dd650750c6072b4a42f95b03420273d099965e
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
local_development:
  test_command: 'swift test --filter A2UISwiftUITests'
  lint_command: 'swift-format lint -r Package.swift swift/swiftui'
  format_command: 'swift-format format -i -r Package.swift swift/swiftui'
---

# **SwiftUI Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The native SwiftUI rendering adaptation layer for A2UI.

- **A2UISwiftUI** (`swift/swiftui/Sources/A2UISwiftUI`): Bridge layer hosting the root `Surface`
  view, recursive `ComponentNodeView`, `A2UIAccessibilityModifier`, dynamic binding helpers, and
  SwiftUI environment propagation (`a2uiTheme`, `a2uiSurfaceMetadata`, `a2uiCatalogs`,
  `a2uiDefaultCatalogID`).
- **BasicCatalogSwiftUI** (`swift/swiftui/Sources/BasicCatalog`): Native SwiftUI component
  implementations conforming to `ComponentImplementation` for all Basic Catalog elements.
- **Swift Testing** (`swift/swiftui/Tests/A2UISwiftUITests`): Unit and shared adapter conformance
  tests (`AdapterConformanceTests` running `core/adapter_conformance.yaml`,
  `adapter/adapter_conformance_v0_9.yaml`, and `core/accessibility.yaml` across resolved-node and
  hosted platform view drivers, plus `MarkdownSubsetConformanceTests` running
  `adapter/markdown_subset.yaml`).

## **Local Technical Decisions & Overrides**

- **Reactivity model**: `Surface` observes `SurfaceViewModel` via `@ObservedObject`, while each
  `Node` wraps an `@MainActor` Swift `Observation` `NodeBox` tracking `properties` and `metadata`
  separately.
- **Resolver ownership**: `SurfaceViewModel` in `A2UICore` instantiates `NodeResolver`, and only
  `SurfaceViewModel.dispose()` disposes it. `Surface` neither creates nor disposes a resolver on
  unmount, so removing the view leaves resolver subscriptions active until the view model is
  disposed ([a2ui_framework_adapter.blueprint.md](../../../modules/a2ui_framework_adapter.blueprint.md)
  §4.1 and §7 deviation).
- **Explicit view catalogs and lookup fallback**: Because `SurfaceViewModel` stays UI-independent
  with schema-only `AnyComponentAPI` catalogs, `Surface` takes view-carrying
  `catalogs: [Catalog<ComponentImplementation>]` alongside `viewModel` (with
  `Surface.makeWithBasicCatalogs(viewModel:)` for the standard catalog). When neither
  `node.catalogID` nor `defaultCatalogID` holds `node.type`,
  `Surface.implementation(for:using:defaultCatalogID:)` falls back across all passed catalogs in
  sorted catalog-ID order.
- **Built-in Markdown without a host view hook**: `A2UIText` renders Markdown directly through
  Foundation `AttributedString` and `MarkdownBlockView`
  (`swift/swiftui/Sources/BasicCatalog/MarkdownBlockView.swift`). `Surface` publishes no ambient
  host-supplied Markdown view builder or markup renderer into the SwiftUI environment, so
  `module_blueprint_commit` stops before `2e3d9bc4`.
- **Unresolved placeholders without `fallbacks` API**: `Surface` renders `EmptyView()` before
  `rootNode` arrives, and `ComponentNodeView` renders `EmptyView()` for `.pending`,
  `.unknownType`, and `.cyclic` placeholders. `A2UIRow` and `A2UIColumn` filter children through
  `Node.renderedChildren(for:in:defaultCatalogID:)` so unresolved nodes take no spacing or
  `Spacer` slots (`28f0a416`), while `A2UIList` iterates unfiltered `node.children(for: "children")`
  with a `.frame(...)` wrapper per child and relies on `LazyVStack` and `LazyHStack` giving an
  `EmptyView` child no gap (measured in commit `b36f1a6d1`). The optional `A2UIFallbacks` API from
  `32c03e3a` is not yet implemented on `Surface`.
- **Eager node metadata observation in `ComponentNodeView`**: `Surface` injects
  `viewModel.metadata` into `EnvironmentValues.a2uiSurfaceMetadata`, `ComponentImplementation`
  carries static `metadata`, and `ResolvedAction` forwards call-time action `metadata`. However,
  `ComponentNodeView.body` evaluates `(node.properties, node.metadata)` unconditionally on every
  render, so a `@metadata`-only update also invalidates views that read only `properties`
  ([a2ui_framework_adapter.blueprint.md](../../../modules/a2ui_framework_adapter.blueprint.md) §3 in
  `9055207b`, holding both module and feature pins before `9055207b`).
- **Version-agnostic theme environment**: `Surface` injects `viewModel.theme` into
  `EnvironmentValues.a2uiTheme` on every protocol version, and `DefaultA2UIButtonStyle` reads its
  `primaryColor`. While `MessageProcessor` drops `theme` on a v1.0 `createSurface`, a v1.0
  `SurfaceViewModel` constructed directly with `theme:` still styles buttons
  ([a2ui_framework_adapter.blueprint.md](../../../modules/a2ui_framework_adapter.blueprint.md) §8
  `No theme on v1.0` in `a641e84f`).
- **Unconditional `accessibility` property fallback in `Node.explicitAccessibilityAttributes`**:
  While `NodeResolver` keeps `@accessibility` in `node.properties["@accessibility"]` and leaves a
  custom v1.0 `accessibility` property in `node.properties["accessibility"]`,
  `A2UIAccessibilityModifier` and catalog views read `node.explicitAccessibilityAttributes`, which
  checks `properties["@accessibility"] ?? properties["accessibility"]` without inspecting
  `protocolVersion`. On a v1.0 component that declares an object-valued `accessibility` property
  and omits `@accessibility`, the adapter can misread that custom property as protocol
  accessibility attributes
  ([a2ui_framework_adapter.blueprint.md](../../../modules/a2ui_framework_adapter.blueprint.md) §3 in
  `24d1bf9c`).

## **Validation & Execution Recipes**

- **Test execution**: Run SwiftUI unit tests via `swift test --filter A2UISwiftUITests`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/swiftui`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/swiftui`.

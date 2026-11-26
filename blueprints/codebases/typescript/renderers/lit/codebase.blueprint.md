---
codebase_path: typescript/renderers/lit
associated_module: a2ui_framework_adapter
module_blueprint_commit: b1dd650750c6072b4a42f95b03420273d099965e
implemented_features:
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
  universal_custom_elements: 0d70f4407f3defb78f1fa5646868341536b7a29b
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Lit Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The Lit and W3C Custom Elements renderer (`@a2ui/lit`) for A2UI, built on `@a2ui/web_core` and `@a2ui/web_core/universal`.

- **Surface & Node Resolution (`A2uiSurface`, `NodeResolver`)**: `<a2ui-surface>` instantiates a `NodeResolver` for its `SurfaceModel`, tracks `resolver.rootNode` via a signal `effect`, and renders the root `ComponentNode` through `renderA2uiNode(root)`.
- **Node-Driven Reactive Controller (`A2uiLitElement`, `A2uiController`)**: Re-exported from `@a2ui/web_core/universal`. When an `A2uiLitElement` receives a resolved `ComponentNode` (`el.node`), `A2uiController` subscribes directly to `node.props` and unwraps `ResolvedBinding` values and `set<Prop>` setters without allocating a duplicate `GenericBinder`.
- **Universal Custom Elements (`renderA2uiNode`, `Context`)**: Re-exports `renderA2uiNode` from `@a2ui/web_core/universal` (which lazily defines elements through `registerUniversalElement`), and defines `Context.markdown` (a `@lit/context` key). Renders in the Light DOM by default (`createRenderRoot()` returns `this` on `<a2ui-surface>` and adopts scoped stylesheets via `adoptLightDomStyles()` on `A2uiLitElement`) for cross-framework composition.

## **Local Technical Decisions & Overrides**

- **Lazy Mounting**: Postpones active property subscriptions and events registration until components are connected to the document DOM (`hostConnected`).
- **Markup-only Markdown and ambient context (`src/context/markdown.ts`, `src/surface/a2ui-surface.ts`)**: `Context.markdown` (`Symbol.for('A2UIMarkdown')`) and `@a2ui/web_core/universal`'s `setMarkdownRenderer` accept only a markup-returning `MarkdownRenderer` (`Promise<string>`) rendered through Lit's `unsafeHTML` directive without sanitizing (the provided renderer must sanitize its own output), not a framework-native Lit view or template callback. `A2uiSurface` also does not publish `SurfaceModel` through `@lit/context`; elements read the surface through the deprecated `node.context?.dataContext.surface` (`A2uiController.surfaceMetadata`, with `A2uiLitElement.willUpdate` mirroring `node.context`), overriding the module rule against direct `ComponentContext` and `DataContext` reads. Because [a2ui_framework_adapter.blueprint.md](../../../../modules/a2ui_framework_adapter.blueprint.md) §4.1 in `2e3d9bc4` requires accepting a framework-native view for `Text` Markdown rendering, `module_blueprint_commit` stays at `b1dd6507`.
- **Lazy extension metadata (`@a2ui/web_core/universal` `A2uiLitElement`, `A2uiController`)**: Exposes lazily subscribed `metadata`, `extensions`, `surfaceMetadata`, and `surfaceExtensions` getters (`9055207b`), so elements that never read metadata do not re-render on metadata-only updates. Elements read static catalog definition metadata from `node.impl.metadata`, and `NodeAction` accepts optional `ActionDispatchOptions` carrying `metadata`.
- **Unresolved placeholders without `fallbacks` API (`A2uiSurface`, `renderA2uiNode`)**: `A2uiSurface` returns `nothing` before `rootNode` arrives or while `rootNode.isPlaceholder` is true, `renderA2uiNode` returns `nothing` for placeholders and disposed nodes, and `A2uiLitElement.isChildResolved` lets containers omit wrappers for unresolved children (`28f0a416`). Neither `A2uiSurface` nor `@a2ui/web_core/universal`'s `renderA2uiNode` implements the optional `fallbacks` API from `32c03e3a`, which holds `universal_custom_elements` at `0d70f440`. On `universal_custom_elements`, the later commits `cffceb18` (base-element accessibility wiring in `@a2ui/web_core/universal`) and `24d1bf9c` (`@accessibility` key) are otherwise reflected, except for the `24d1bf9c` pre-1.0 limit on the `accessibility` fallback recorded below; on `a2ui_framework_adapter`, the commits after `b1dd6507` other than `2e3d9bc4` and `32c03e3a` (`28f0a416`, `9055207b`, `a641e84f` no theme on v1.0, `24d1bf9c` `@`-prefixed envelope keys, `d56f84f9` doc links, and `7fae1b76` `catalogs/basic/v0_9/` paths in tests and `a2ui_explorer`) are reflected, with the same `24d1bf9c` exception.
- **Host accessibility pre-1.0 fallback scope (`typescript/core/web_core/src/universal/host_accessibility.ts`)**: `A2uiLitElement.updated()` delegates to `resolveAccessibilityProps`, which checks `['@accessibility', 'accessibility']` without inspecting protocol version. On a v1.0 component that declares a custom object-valued `accessibility` property and omits `@accessibility`, the element still applies that custom property as protocol accessibility attributes. This departs from [a2ui_framework_adapter.blueprint.md](../../../../modules/a2ui_framework_adapter.blueprint.md) §3 and [universal_custom_elements.blueprint.md](../../../../features/universal_custom_elements.blueprint.md) §7 in `24d1bf9c`, which limit the `accessibility` fallback to pre-1.0 surfaces.
- **Catalog packaging (`src/index.ts`, `package.json`, `src/v0_9/catalogs/basic/index.ts`)**: `@a2ui/lit/v0_9` exports the v0.9 `basicCatalog` (`protocolVersion: '0.9'`), whereas v1.0 applications import `basicCatalog` directly from `@a2ui/web_core/catalogs/basic/v1` rather than from the `@a2ui/lit` root entry point. The root entry point also keeps a deprecated `v0_8` namespace export (`./0.8/core.js`), and `package.json` keeps an unversioned `./ui` subpath for the v0.8 elements (`./dist/src/0.8/ui/ui.js`), whereas [a2ui_framework_adapter.blueprint.md](../../../../modules/a2ui_framework_adapter.blueprint.md) §1 isolates deprecated pre-Node-API implementations under versioned subpaths.
- **Adapter conformance skip (`src/tests/adapter_harness.ts`)**: `src/tests/adapter_conformance.test.ts` runs `core/accessibility.yaml`, `core/adapter_conformance.yaml`, and `adapter/adapter_conformance_v0_9.yaml`. `UNSUPPORTED` holds one entry, `validation_results_error_disables_warning_allows/hints`, which skips that entire case because the Web Basic Catalog `TextField` does not render optional `SHOULD` hints.

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests with `yarn test`.
- **Linting check**: Execute standard style lint audits with `yarn lint`.
- **Formatting**: Auto-format standard styles with `yarn format`.

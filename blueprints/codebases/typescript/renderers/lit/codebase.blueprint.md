---
codebase_path: typescript/renderers/lit
associated_module: a2ui_framework_adapter
module_blueprint_commit: b1dd650750c6072b4a42f95b03420273d099965e
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
  universal_custom_elements: b1dd650750c6072b4a42f95b03420273d099965e
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Lit Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The Lit and W3C Custom Elements renderer (`@a2ui/lit`) for A2UI, built on `@a2ui/web_core`.

- **Surface & Node Resolution (`A2uiSurface`, `NodeResolver`)**: `<a2ui-surface>` instantiates a `NodeResolver` for its `SurfaceModel`, tracks `resolver.rootNode` via a signal `effect`, and renders the root `ComponentNode` through `renderA2uiNode(this._rootNode)`.
- **Node-Driven Reactive Controller (`A2uiLitElement`, `A2uiController`)**: When an `A2uiLitElement` receives a resolved `ComponentNode` (`el.node`), `A2uiController` subscribes directly to `node.props` and unwraps `ResolvedBinding` values and `set<Prop>` setters without allocating a duplicate `GenericBinder`.
- **Universal Custom Elements (`renderA2uiNode`, `registerUniversalElement`)**: Renders in the Light DOM by default (`createRenderRoot()` returns `this` on `<a2ui-surface>` and adopts scoped stylesheets via `adoptLightDomStyles()` on `A2uiLitElement`) for cross-framework composition.

## **Local Technical Decisions & Overrides**

- **Lazy Mounting**: Postpones active property subscriptions and events registration until components are connected to the document DOM (`hostConnected`).

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests with `yarn test`.
- **Linting check**: Execute standard style lint audits with `yarn lint`.
- **Formatting**: Auto-format standard styles with `yarn format`.

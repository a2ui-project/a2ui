---
codebase_path: typescript/renderers/angular
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

# **Angular Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The Angular-native adapter (`@a2ui/angular`) rendering visual components and universal W3C Custom Elements dynamically.

- **Native Signal Reactivity (`initializeAngularReactivity`, `ComponentBinder`)**: Plugs Angular's `signal`, `computed`, and `effect` primitives into `@a2ui/web_core` via `setSignalImplementation`, and binds resolved `ComponentNode.props` (`binder.bindNode(node)`) or standalone `ComponentContext` properties (`binder.bind(context)`) into `BoundProperty<T>` signals.
- **Surface & Host Resolution (`SurfaceComponent`, `ComponentHostComponent`)**: `SurfaceComponent` mounts a root `ComponentHostComponent`, which resolves `ComponentNode` instances through a per-surface `NodeResolver` and mounts either native Angular components (`NgComponentOutlet`) or universal Custom Elements.
- **Universal Custom Elements (`AngularWcHost`, `toWebComponent`)**: Wraps Angular catalog components into W3C Custom Elements (`AngularWcHost`) that accept `el.node` and `el.context` so Angular components and Lit Web Components can be hosted interchangeably.

## **Local Technical Decisions & Overrides**

- **OnPush & Signal-Driven Change Detection**: Uses `ChangeDetectionStrategy.OnPush` and Angular Signals across all host and catalog components.

## **Validation & Execution Recipes**

- **Test execution**: Run unit/integration tests with `yarn test`.
- **Code standards check**: Check styles standards with `yarn lint`.
- **Formatting**: Auto-format files with `yarn format`.

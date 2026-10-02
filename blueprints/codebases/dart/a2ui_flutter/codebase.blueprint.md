---
codebase_path: dart/a2ui_flutter
associated_module: a2ui_framework_adapter
module_blueprint_commit: 672675f55
implemented_features: []
local_development:
  test_command: 'flutter test'
  lint_command: 'flutter analyze'
  format_command: 'dart format .'
---

# **Flutter Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The Flutter declarative renderer for the A2UI ecosystem.

- **Architecture**: Maps A2UI `ComponentNode` trees resolved by `a2ui_core`'s `NodeResolver` into native Flutter widgets.
- **Root Entrypoint**: `A2uiSurface` widget taking a `SurfaceModel<FlutterComponentImplementation>` as its sole input.
- **Component Contract**: `FlutterComponentImplementation` pairing schemas with `(context, node, buildChild)` widget builders.
- **Dispatcher**: `NodeView` recursive dispatcher keyed by `ValueKey(node.instanceId)`.
- **Reactivity Bridge**: Subscribes directly to `node.props` signals (`preact_signals`) with automatic unmount disposal.

## **Local Technical Decisions & Overrides**

- **Node API Purity**: Strictly eliminates legacy `GenericBinder` and `ComponentContext` dependencies from views in compliance with the updated framework adapter specification.
- **Reconciliation Keys**: Every `NodeView` assigns `ValueKey(node.instanceId)` to preserve native widget and element state during sibling reordering.

## **Validation & Execution Recipes**

- **Test execution**: Run `flutter test`.
- **Analysis**: Check code health via `flutter analyze`.
- **Formatting**: Run `dart format .`.

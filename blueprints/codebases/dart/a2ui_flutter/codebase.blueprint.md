---
codebase_path: dart/a2ui_flutter
associated_module: a2ui_framework_adapter
module_blueprint_commit: 8d75b7901dcbb78dded6449036a6f17bf52c62c1
implemented_features:
  - node_resolution
local_development:
  test_command: 'flutter test'
  lint_command: 'flutter analyze'
  format_command: 'dart format .'
---

# **Flutter Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The Flutter renderer for the A2UI ecosystem, built on the node layer of `dart/a2ui_core`.

- **Architecture Goal**: Map A2UI component schemas into Flutter widget trees.
- **Reactivity Bridge**: `StatefulWidget`s subscribe to `NodeResolver.rootNode` and to each mounted `ComponentNode`'s `props` signal, with no state-management package, and unsubscribe when disposed.

## **Local Technical Decisions & Overrides**

- **Package layout**: Folders follow the React adapter rather than the module blueprint's layout: the surface, node view, component API and props accessors are files in `lib/src/`, and there are no `surface/`, `nodes/`, `binding/` or `theme/` folders.

## **Validation & Execution Recipes**

- **Test execution**: Run `flutter test`.
- **Analysis**: Check code health via `flutter analyze`.
- **Formatting**: Run `dart format .`.

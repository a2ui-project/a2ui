---
codebase_path: dart/a2ui_flutter
associated_module: a2ui_framework_adapter
module_blueprint_commit: 2e3d9bc434a34ba25498a11e0bfba079b52dcf29
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
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

- **Package layout**: Folders follow the React adapter rather than the module blueprint's layout: the surface, node view, component API and props accessors are files in `lib/src/`, and there are no `surface/`, `nodes/` or `binding/` folders. The basic components are a library of their own, `package:a2ui_flutter/basic_catalog.dart` for v1.0 and `package:a2ui_flutter/v0_9/basic_catalog.dart` for v0.9, in `lib/src/catalog/basic/`. They import neither the surface widget nor the node view, and read the surface model only through its ambient scope, to apply its v0.9 theme and to report a write the data model rejects.
- **Theme on v1.0**: `a2ui_core` rejects a v1.0 `createSurface` that carries `theme`, so the module blueprint's "Theme ignored" test does not apply.
- **Basic catalog schemas**: Component schemas come from `a2ui_core`'s `BasicCatalog.v1_0()` and `BasicCatalog.v0_9()`, which are generated from the basic catalog documents, rather than being written by hand.
- **Accessibility**: `NodeView` applies a component's `accessibility` attributes on a semantics node around the component's widget. On a Button, CheckBox or Slider that node is a parent of the focusable control, so `label`, `description` and `live` land there, and on a TextField or Text an explicit `label` is joined to the widget's own label rather than replacing it.
- **Markdown**: The basic `Text` renders its Markdown with the `A2uiMarkdownBuilder` of the nearest `A2uiMarkdown` above it, a widget builder the app gives, built inside the app's widget tree, as the module blueprint's ambient context injection asks. Flutter renders text natively, so there is no renderer that returns markup. A Text without an `A2uiMarkdown` above it shows its text without common Markdown markers.
- **Check hints**: Failing `warning` and `info` checks show as hints in one style, since Material has no warning color. A Button shows none: a Tooltip that came and went with a hint would remount the enabled button and drop its focus.

## **Validation & Execution Recipes**

- **Test execution**: Run `flutter test`.
- **Analysis**: Check code health via `flutter analyze`.
- **Formatting**: Run `dart format .`.

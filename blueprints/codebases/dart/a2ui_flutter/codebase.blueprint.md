---
codebase_path: dart/a2ui_flutter
associated_module: a2ui_framework_adapter
module_blueprint_commit: 28f0a4163b7a45d4425bdecec70781a83b67bd8b
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
- **Reactivity Bridge**: `StatefulWidget`s subscribe to `NodeResolver.rootNode` and to each mounted `ComponentNode`'s `props` signal, and unsubscribe when disposed. `NodeView` also runs resolved builders inside a `preact_signals` `effect`, so builders reading `node.metadata` or `SurfaceModel.metadataSignal` subscribe on demand.

## **Local Technical Decisions & Overrides**

- **Package layout**: Folders follow the React adapter rather than the module blueprint's layout: the surface, node view, component API and props accessors are files in `lib/src/`, and there are no `surface/`, `nodes/` or `binding/` folders. The basic components are a library of their own, `package:a2ui_flutter/basic_catalog.dart` for v1.0 and `package:a2ui_flutter/v0_9/basic_catalog.dart` for v0.9, in `lib/src/catalog/basic/`. They import neither the surface widget nor the node view, and read the surface model only through its ambient scope, to apply its v0.9 theme and to report a write the data model rejects.
- **Basic catalog schemas**: Component schemas come from `a2ui_core`'s `BasicCatalog.v1_0()` and `BasicCatalog.v0_9()`, which are generated from the basic catalog documents, rather than being written by hand.
- **Accessibility**: `NodeView` reads `props.value('@accessibility') ?? props.value('accessibility')` without checking `surface.protocolVersion`. On a v1.0 component without `@accessibility`, a custom map-valued `accessibility` property reaches the builder and `NodeView`, whereas `24d1bf9c` limits that fallback to pre-1.0 surfaces. `NodeView` also resolves attribute values that reach it as raw binding maps via `node.context?.dataContext`, overriding the module rule against direct `ComponentContext` and `DataContext` reads. `GenericBinder._withEnvelopeMixins` resolves only `label`, `description` and `hidden`, and adds nothing when the component schema has no object shape, so other map values arrive unresolved. On a Button, CheckBox or Slider the outer `Semantics` node wraps the focusable control, so `label`, `description` and `live` land there. On a TextField or Text, an explicit `label` joins the widget's own label rather than replacing it.
- **Metadata channels without `ComponentImplementation.metadata`**: A builder that reads `node.metadata` or `A2uiSurface.of(context).metadataSignal` subscribes through `NodeView`'s build `effect` (see Reactivity Bridge), and `ComponentProps.action` returns `NodeAction?` accepting `ActionDispatchOptions`. `ComponentImplementation` omits `super.metadata` from its constructor (`BasicComponents._implement` in `basic_catalog.dart` and `basic_catalog_v0_9.dart` also drops `definition.metadata`), leaving `node.impl?.metadata` null. Both `module_blueprint_commit` (`28f0a416`) and the `node_resolution` pin (`b161f9bd`) therefore stop before `9055207b`.
- **Relaxed v1.0 `createSurface.theme` in core**: The v1.0 basic catalog never reads `surface.theme`, and `BasicTheme` is wired only in the v0.9 basic catalog. However, `a2ui_core`'s `AgentToRendererMessage.fromJson` rejects `createSurface.theme` on v1.0 with `A2uiValidationError` even under `ValidationConfig.relaxed`, leaving `v10_theme_dropped_in_permissive_mode_renders_like_none` skipped in `test/adapter_harness.dart` and the `No theme on v1.0` row (`a641e84f`) unmet.
- **Unresolved node fallbacks**: `A2uiSurface` takes `surface` only and renders `SizedBox.shrink()` before the root arrives. `NodeView` renders `SizedBox.shrink()` for `pending`, `unknown-type` and `cyclic` placeholders, and `_FlexContainer` skips `child.isPlaceholder` in `Row`, `Column` and `List`. The `A2uiFallbacks` and `buildChildOrNull` APIs specified in `32c03e3a` are not implemented.
- **Markdown**: The basic `Text` renders its Markdown with the `A2uiMarkdownBuilder` of the nearest `A2uiMarkdown` above it, a widget builder the app gives, built inside the app's widget tree, as the module blueprint's ambient context injection asks. Flutter renders text natively, so there is no renderer that returns markup. A Text without an `A2uiMarkdown` above it shows its text without common Markdown markers.
- **Check hints**: Failing `warning` and `info` checks show as hints in one style, since Material has no warning color. A Button shows none: a Tooltip that came and went with a hint would remount the enabled button and drop its focus.

## **Validation & Execution Recipes**

- **Test execution**: Run `flutter test`.
- **Analysis**: Check code health via `flutter analyze`.
- **Formatting**: Run `dart format .`.

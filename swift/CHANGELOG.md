# Changelog

## Unreleased

- **BREAKING CHANGE**: Gate component `metadata` and `catalogId` envelope handling in
  `MessageProcessor` and `PayloadValidator` to v1.0 and later surfaces so pre-1.0 surfaces treat
  `metadata` and `catalogId` as ordinary component properties in `ComponentModel.properties` (with
  `ComponentModel.metadata` remaining `nil` and `ComponentModel.catalogID` set to the surface
  default catalog). On v1.0 surfaces, `MessageProcessor`, `PayloadValidator`,
  `GraphTopologyValidator`, `NodeResolver`, and `Node.explicitAccessibilityAttributes` accept
  `@catalogId`, `@metadata`, `@accessibility`, and `@checks` (`ComponentModel.properties` stores
  the accessibility and checks mixins under `@accessibility` and `@checks`), dual-read legacy bare
  keys when undeclared by the component schema, validate `@metadata.extensions` keys as UAX #31
  identifiers, and reject components that specify both `@`-prefixed and bare forms of the same
  mixin. Recommended migration: read `metadata` and `catalogId` from `ComponentModel.properties` on
  pre-1.0 surfaces, and emit `@catalogId`, `@metadata`, `@accessibility`, and `@checks` on v1.0
  components. [#4140](https://github.com/a2ui-project/a2ui/pull/4140),
  [#4037](https://github.com/a2ui-project/a2ui/pull/4037),
  [#4044](https://github.com/a2ui-project/a2ui/pull/4044)
- **BREAKING CHANGE**: Migrate `A2UIAudioPlayerModel` and `A2UIVideoPlayerModel` in
  `BasicCatalogSwiftUI` from `ObservableObject` to `@Observable`, update
  `A2UIAudioPlayer.init(node:model:)` and `A2UIVideo.init(node:model:)` to take a direct model
  instance, skip redundant `AVPlayer` seeks during `A2UIAudioPlayer` playback, and adopt
  `ContentUnavailableView` and an accessibility label on the poster play button in `A2UIVideo`.
  Recommended migration: hold custom `A2UIAudioPlayerModel` or `A2UIVideoPlayerModel` instances
  with `@State` instead of `@StateObject` or `@ObservedObject`.
  [#4022](https://github.com/a2ui-project/a2ui/pull/4022)
- **BREAKING CHANGE**: Remove the default `= []` argument on
  `Surface.init(viewModel:catalogs:defaultCatalogID:)` so callers explicitly choose a catalog list
  (or pass `catalogs: []`). Recommended migration: pass `BasicCatalogImplementation.allCatalogs`,
  use `Surface.makeWithBasicCatalogs(viewModel:)`, or pass `catalogs: []` explicitly.
  [#4024](https://github.com/a2ui-project/a2ui/pull/4024)
- Add `A2UICardStyle` (`.automatic`, `.elevated`, `.outlined`), `A2UIButtonStyle` (`.automatic`),
  `View.a2uiCardStyle(_:)`, `View.a2uiButtonStyle(_:)`, and
  `Surface.makeWithBasicCatalogs(viewModel:)` in `BasicCatalogSwiftUI`.
  [#4024](https://github.com/a2ui-project/a2ui/pull/4024)
- Report the component definition ID rather than the synthesized `:index` instance ID as
  `sourceComponentID` on actions dispatched from template-expanded components.
  [#4043](https://github.com/a2ui-project/a2ui/pull/4043)
- (v1.0) Inherit the enclosing function's resolved `catalogId` for catalogless calls inside
  `FormatStringFunction` `${...}` template expressions (keeping `@`-prefixed system calls such as
  `${@index()}` catalogless), add `DataContext.activeFunctionCatalogID` and
  `FunctionHandler.resolvedFunctionCatalogID(forCallCatalogID:)`, and scope `RPCHandler`
  `callRendererFunction` argument and function evaluation to the target catalog.
  [#4030](https://github.com/a2ui-project/a2ui/pull/4030)
- (v1.0) Include `$defs.anyComponent` and `$defs.anyFunction` unions in inline catalog schemas
  emitted by `MessageProcessor.getRendererCapabilities(options:)` so v1.0 or later inline catalogs
  conform to `catalog_definition.json`. [#4092](https://github.com/a2ui-project/a2ui/pull/4092)
- Deprecate `A2UICatalogsKey`, `A2UIDefaultCatalogIDKey`, and `A2UIThemeKey` in `A2UISwiftUI` in
  favor of `EnvironmentValues.a2uiCatalogs`, `EnvironmentValues.a2uiDefaultCatalogID`, and
  `EnvironmentValues.a2uiTheme`, and update `BasicCatalogSwiftUI` components (`A2UIIcon` and
  `A2UIChoicePicker` Dynamic Type scaling, multi-line `TextField(axis: .vertical)` for `longText`
  `A2UITextField`, and SVG path parsing improvements in `SVGPathParser` / `SVGPathShape`).
  [#4023](https://github.com/a2ui-project/a2ui/pull/4023)
- Map `A2UIImage` `fit` values (`contain`, `cover`, `fill`, `none`, `scaleDown`) to CSS
  `object-fit` semantics in `BasicCatalogSwiftUI`: `fill` stretches to the frame, `none` renders at
  intrinsic size without scaling, `scaleDown` avoids upscaling small images, feature variants size
  their frame from the image's aspect ratio without upscaling, and `avatar` and `header` variants
  honor an explicit `fit` while defaulting to `cover`.
  [#4097](https://github.com/a2ui-project/a2ui/pull/4097)
- (v1.0) Drop `theme` from `createSurface` payloads in `V10VersionAdapter` and `MessageProcessor`
  when `ValidationConfig.allowUnknownElements` is `true` instead of rejecting the message, and add
  `allowUnknownElements` overloads to
  `VersionAdapter.extractOperations(from:allowUnknownElements:)`,
  `VersionAdapter.adaptMessage(_:allowUnknownElements:)`, and
  `BaseVersionAdapter.preparePayloadForValidation(_:action:allowUnknownElements:)`.
  [#4099](https://github.com/a2ui-project/a2ui/pull/4099)
- Send the message of an error thrown by a renderer function in the `rendererFunctionResponse`
  error, falling back to the generic execution-error text only when that message is empty.
  [#4105](https://github.com/a2ui-project/a2ui/pull/4105)
- Announce visible text changes in `live` regions: a live component or container now announces its
  explicit `label` followed by the text its subtree reports with the new `.a2uiAccessibleText(_:)`
  modifier (collected through `A2UIAccessibleTextKey`). `A2UIText` reports its text without
  Markdown syntax, and custom components that render text can call the modifier too.
  [#4021](https://github.com/a2ui-project/a2ui/pull/4021)

## 0.10.0

- Initial release of the A2UI Swift SDK for iOS 17+ and macOS 14+, supporting protocol versions
  v0.9, v0.9.1, and v1.0:
  - `A2UISwiftCore` (`A2UICore`, `A2UIJSON`): stateful message processor, surface and data models,
    JSON pointer bindings, schema validation, and bidirectional function calls.
  - `BasicCatalog`: component schemas and standard functions for the A2UI Basic Catalog.
  - `A2UISwiftUI` and `BasicCatalogSwiftUI`: declarative SwiftUI `Surface` rendering adapter and
    Basic Catalog component views.

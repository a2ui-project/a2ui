# Changelog

## Unreleased

- **BREAKING CHANGE**: Make `EnvironmentValues.a2uiCatalogs`,
  `EnvironmentValues.a2uiDefaultCatalogID`, and `EnvironmentValues.a2uiSurfaceMetadata` read-only
  (`public internal(set)`) in `A2UISwiftUI`, and remove `A2UICatalogsKey` and
  `A2UIDefaultCatalogIDKey` so catalogs and surface metadata are injected only by `Surface`.
  Recommended migration: pass catalogs to `Surface.init(viewModel:catalogs:defaultCatalogID:)` or
  `Surface.makeWithBasicCatalogs(viewModel:)`, update surface metadata through `SurfaceViewModel`
  (`metadata`, `setMetadata(_:)`, `setExtension(_:value:)`, `removeExtension(_:)`), and read
  `\.a2uiCatalogs`, `\.a2uiDefaultCatalogID`, and `\.a2uiSurfaceMetadata` from `@Environment`.
  [#4195](https://github.com/a2ui-project/a2ui/issues/4195),
  [#4275](https://github.com/a2ui-project/a2ui/pull/4275)
- **BREAKING CHANGE**: `RegexSubset.analyze`, `RegexSubset.compileGuarded`, and the `regex`
  function in `BasicCatalog` reject a repetition of a group that can match the empty string in
  more than one way, such as `(a?){1000}a{1000}` or `(a{0,2})+b`, with `NESTED_QUANTIFIER`. Such a
  pattern made `NSRegularExpression` run for seconds or longer on a value only a few characters
  long. Recommended migration: rewrite the group so each repetition consumes at least one
  character, for example `(?:ab?){3}` instead of `(?:a?b?){3}`.
  [#4236](https://github.com/a2ui-project/a2ui/issues/4236),
  [#4310](https://github.com/a2ui-project/a2ui/pull/4310)
- Add optional `instructions` (Markdown design guidelines for agents) to `CatalogProtocol` and
  `Catalog`, with an `instructions:` parameter on `Catalog.init` and `Catalog.derive`. `derive`
  does not keep the source catalog's instructions, and `MessageProcessor.getRendererCapabilities`
  writes them into v1.0 inline catalogs when set.
  [#3842](https://github.com/a2ui-project/a2ui/issues/3842),
  [#4312](https://github.com/a2ui-project/a2ui/pull/4312)
- Add an `isUserActivated` parameter (default `false`) to `MessageProcessor.processMessages(_:)`,
  `process(payload:)`, `process(message:)`, and `process(messages:)`. Pass `true` when the payload
  is handled within a user gesture so a v1.0 `callRendererFunction` may run functions that set
  `requiresUserActivation`, such as a nested call in its arguments.
  [#4311](https://github.com/a2ui-project/a2ui/pull/4311)

## 0.11.0

- **BREAKING CHANGE**: Enforce object-level (`anyOf`, `additionalProperties: false`) and
  array-level (`minItems`, `maxItems`, `prefixItems`) JSON Schema constraints on function arguments
  containing dynamic bindings in `PayloadValidator`, validate declared `returnType` values on nested
  function calls against the catalog function definition on pre-1.0 surfaces, disallow undeclared
  arguments across all `BasicCatalog` functions, and enforce RFC 3986 scheme-prefixed URI syntax on
  `openUrl.args.url`. Recommended migration: remove undeclared function arguments, supply at least
  one bound on `length` and `numeric`, pass a scheme-prefixed URI to `openUrl.url`, and match or
  omit `returnType` on nested function calls.
  [#4173](https://github.com/a2ui-project/a2ui/issues/4173),
  [#4187](https://github.com/a2ui-project/a2ui/pull/4187)
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
- Generalize direct `DataBinding` properties to `DataBinding<JSONValue>`, resolve direct
  `FunctionCall` properties, and preserve typed resolution for inline dynamic unions in
  `NodeResolver`. [#3809](https://github.com/a2ui-project/a2ui/issues/3809)
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
- Report a two-way binding write that the data model rejects, such as writing `/name/first` while
  `/name` is a string, as a `DATA_ERROR` to the surface's `ActionHandling` and the
  `MessageProcessor` outbound listener instead of dropping it silently. The data model stays
  unchanged. [#4257](https://github.com/a2ui-project/a2ui/pull/4257)
- Draw SVG elliptical arc commands (`A` and `a`) in `SVGPathParser`, so `Icon` `svgPath` values
  with arcs render circles and rounded shapes instead of dropping those segments. Arc flags written
  without separators (for example `a1 1 0 011 1`) are also accepted.
  [#4260](https://github.com/a2ui-project/a2ui/pull/4260)

## 0.10.0

- Initial release of the A2UI Swift SDK for iOS 17+ and macOS 14+, supporting protocol versions
  v0.9, v0.9.1, and v1.0:
  - `A2UISwiftCore` (`A2UICore`, `A2UIJSON`): stateful message processor, surface and data models,
    JSON pointer bindings, schema validation, and bidirectional function calls.
  - `BasicCatalog`: component schemas and standard functions for the A2UI Basic Catalog.
  - `A2UISwiftUI` and `BasicCatalogSwiftUI`: declarative SwiftUI `Surface` rendering adapter and
    Basic Catalog component views.

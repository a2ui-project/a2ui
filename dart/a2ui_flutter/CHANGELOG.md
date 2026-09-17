# [a2ui_flutter](https://pub.dev/packages/a2ui_flutter) Changelog

## 0.11.0-wip001

- Moved into the a2ui repository from [flutter/genui](https://github.com/flutter/genui)
  at genui 0.10.3, renamed `a2ui_flutter`, and relicensed under Apache 2.0.
- Requires `a2ui_core` `^0.2.0`: `AgentToRendererMessage`, the two-parameter
  `Catalog`, `MessageProcessor` with `protocolVersion` and
  `ValidationConfig.relaxed`, and core `A2uiError`s reported as
  `VALIDATION_FAILED`.
- Added `NodeSurface`, a sibling of `Surface` that renders through
  `a2ui_core`'s `NodeResolver`: child references mount as resolved nodes,
  templates expand one node per data item, missing components become
  placeholders that upgrade in place, and each node's subtree rebuilds only
  when its own properties change. `SurfaceController.liveSurfaceFor` exposes
  the live surface model it renders from.
- `A2uiSchemas.componentReference()` carries the shared `ComponentId` schema
  reference, so `a2ui_core` graph validation and the node resolver recognize
  single child references.

## 0.10.3

- Updated `basicCatalogId` to point to the canonical URL: `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`.
- Introduced `catalogIdAliases` in `Catalog` model to support alternate URLs (like the legacy/non-canonical one) for graceful backwards compatibility.
- Augmented `SurfaceController` so that the protocol processor successfully processes both canonical and secondary aliases transparently.
- Fixed `PluralizeFunction` to use `Intl.pluralLogic` instead of `Intl.plural` to
  avoid message extraction errors when arguments are dynamic runtime
  expressions.

## 0.10.2

- Fixed `A2uiTransportAdapter.incomingText` trimming every streamed chunk, which
  made words run together when chunks were concatenated.

- Added examples of how to use TextField.

- Fixed `TextField` variants: `longText` now grows to fit multiple lines,
  `number` now rejects non-numeric input, and the `obscured`
  example now sets `variant` so that it is actually obscured.

- `TextField.validationRegexp` is now enforced: the value has to match the
  pattern in full, an empty field is exempt, and a value that does not match
  shows an error and blocks `onSubmittedAction`. It was previously accepted and
  ignored.

## 0.10.1

- Depend on `a2ui_core` 0.1.0, its first non-pre-release version.

## 0.10.0

- **BREAKING**: Changed `SurfaceDefinition.validate` to be asynchronous to support resolving `$ref` schemas via `SchemaRegistry`.
- **Refactor**: genui now runs on `package:a2ui_core`. See
  [the migration guide](../../docs/usage/migration/migration_0.9.1_to_0.10.0.md).
- **BREAKING**: A2UI message types are now `package:a2ui_core` types. The GenUI
  message classes (`A2uiMessage`, `CreateSurface`, `UpdateComponents`,
  `UpdateDataModel`, `DeleteSurface`) are removed; `SurfaceController.handleMessage`
  and `Transport.incomingMessages` take `a2ui_core` messages, and
  `UpdateComponentsMessage` carries raw component JSON maps rather than `Component`
  objects. Depend on `a2ui_core` directly.
- **BREAKING**: `SurfaceController.store` and `DataModelStore` are removed. Read a
  surface's data model via `SurfaceController.contextFor(id).dataModel`.
- **BREAKING**: `SurfaceRegistry.updateSurface(...)` is removed; drive surfaces
  through `SurfaceController.handleMessage`.
- **BREAKING**: Changed `PromptBuilder.chat` and `PromptBuilder.custom` from synchronous factory constructors to asynchronous static methods (`createChat` and `createCustom`) to support asynchronous asset loading.
- **BREAKING**: Changed `_loadSchemas` return type to a named record structure.
- **BREAKING**: Restricted public API surface of low-level `primitives` exports. Only `CancellationException`, `CancellationSignal`, `JsonMap`, `basicCatalogId`, `configureLogging`, `genUiLogger`, and `generateId` are now exported from `package:genui/genui.dart`.
- **Behavior**: `DataModel` writes are stricter; some writes that previously did
  nothing now throw, and sparse list writes fill skipped entries with `null`.
- **Behavior**: A duplicate `createSurface` for an already-active surface id is now
  an error.
- The catalog-widget authoring API is unchanged; `SurfaceDefinition` and
  `Component` remain genui types.
- **Refactor**: Extracted exception mapping logic to a private helper `_errorToMap` in `SurfaceController`.
- **Refactor**: Centralized and shared common schema registry initialization helper.
- **Refactor**: Extracted mock binary messenger asset setup to a shared helper for test reuse.
- **Fix**: Sanitized raw error messages exposed from `ArgumentError` in `Button` press handlers.
- **Docs** Removed `google_generative_ai` from the README.md.

## 0.9.2

## 0.9.1

- **Feature**: Updated example/README.md.

## 0.9.0

- **BREAKING**: Reorganized library exports (#866).
- **Feature**: Add two skills to the `genui` package (#800).
- **Feature**: Create Dart replicas for Flutter's notifiers (#850).
- **Feature**: Add `FlutterListenable` adapter (#860).
- **Fix**: Improvements to prompt builder to prevent misleading LLM (#841).
- **Fix**: Match `A2uiMessage.a2uiMessageSchema` to A2UI v0.9 specification (#833).
- **Fix**: Bug fixes for A2UI JSONL stream parser (#868).

## 0.8.0

- **BREAKING**: Updated package to align with A2UI v0.9 protocol and introduced extensive architectural changes.
- **BREAKING**: Updated minimum Dart SDK constraints to `^3.10.0` to leverage modern Dart 3+ syntax and features (#772).
- **BREAKING**: `DataModel` is now an abstract interface class. `InMemoryDataModel` provides the concrete implementation.
- **BREAKING**: Enforce non-null `DataPath` in `DataModel.update`, `subscribe`, and `getValue` operations (#743).
- **BREAKING**: `DataContext.evaluate` renamed to `resolve`, returning `Stream<Object?>`.
- **BREAKING**: Made client functions reactive and catalog-based. `SimpleClientFunction` renamed to `SynchronousClientFunction` and its `call` method to `executeSync`.
- **BREAKING**: Removed global `FunctionRegistry`. Functions are now registered to the catalog. Renamed `registerStandardFunctions` to `registerBasicFunctions`.
- **BREAKING**: Removed `SurfaceCleanupStrategy` from `SurfaceController`.
- **BREAKING**: `SurfaceContext` and `SurfaceDefinition` now require a non-nullable `catalogId`.
- **BREAKING**: Renamed `CoreCatalog` to `BasicCatalog` and relocated catalog widgets.
- **Feature**: Added `examples` app with a gallery of pre-designed surfaces allowing editing/previewing A2UI JSON (#761).
- **Feature**: Implemented audio and video basic catalog components (#802).
- **Feature**: Added client capabilities JSON generation via `A2UiClientCapabilities.fromCatalogs` (#773).
- **Feature**: Initial implementation of prompt builder via `PromptBuilder` and the `Conversation` facade (#777).
- **Feature**: Consolidated component name into `CatalogItem` constructor (#757).
- **Feature**: Added descriptions to basic component schemas for standard validation (#756).
- **Fix**: Filter whitespace-only AI text responses from transport (#759).
- **Fix**: Resolved `DataModel` double-dispose crashing issue (#741).
- **Fix**: Fixed memory leaks in `RefCountedValueNotifier` and refactored catalog widgets to use lifecycle-safe `BoundValue` / `BoundString` widgets.
- **Refactor**: Decoupled `ClientFunction` from `DataContext` and resolved package cycles (#742).
- **Refactor**: Updated `Modal` component to self-contain showing logic.
- **Internal**: Removed legacy events `ToolStartEvent`, `ToolEndEvent`, `TokenUsageEvent`, and `ThinkingEvent` from the core genui package.

## 0.7.0

- **Fix**: Improved error handling for catalog example loading to include context about the invalid item (#653).
- **BREAKING**: Renamed `ChatMessageWidget` to `ChatMessageView` and `InternalMessageWidget` to `InternalMessageView` (#661).
- **Fix**: Pass the correct `catalogId` in `DebugCatalogView` widget (#676).
- **BREAKING**: Renamed most classes with `GenUi` prefix to remove the prefix or use `Surface`.
  - `GenUiConversation` -> `Conversation`
  - `GenUiController` -> `SurfaceController`
  - `GenUiSurface` -> `Surface`
  - `GenUiHost` -> `SurfaceHost`
  - `GenUiContext` -> `SurfaceContext`
  - `GenUiTransport` -> `Transport`
  - `GenUiPromptFragments` -> `PromptFragments`
  - `GenUiFunctionDeclaration` -> `ClientFunction`
  - `GenUiFallback` -> `FallbackWidget`
  - `configureGenUiLogging` -> `configureLogging`
- Added some dart documentation and an `example` directory to improve `package:genui` pub score.
- **Fix**: Make `ContentGeneratorError` be an `Exception` (#660).
- **Feature**: Define genui parts as extensions of `genai_primitives` (#675).
- **Internal**: Enable stricter dynamic-related analysis (#652).

## 0.6.1

- **Fix**: Corrected `DateTimeInput` catalog item JSON key mapping (#622).
- **Fix**: Added missing `weight` property to `Component` constructor (#603).
- **Fix**: Defaulted `TextField` `width` to 1 when nested in a `Row` (#603).

## 0.6.0

- **BREAKING**: Renamed `GenUiManager` to `A2uiMessageProcessor` to better reflect its role.
- **BREAKING**: `A2uiMessageProcessor` now accepts an `Iterable<Catalog>` via `catalogs` instead of a single `catalog`.
- **BREAKING**: Removed `GenUiConfiguration` and `ActionsConfig`.
- **BREAKING**: Removed `GenUiHost.catalog` in favor of `GenUiHost.catalogs`.
- Improved surface rendering logic to cache components before rendering.
- Updated README sample code to reflect current `FirebaseAiContentGenerator` API (added `catalog` parameter and replaced `tools` with `additionalTools`).
- **Feature**: `GenUiManager` now supports multiple catalogs by accepting an `Iterable<Catalog>` in its constructor.
- **Feature**: `A2uiMessageProcessor` now supports multiple catalogs by accepting an `Iterable<Catalog>` in its constructor.
- **Feature**: `catalogId` property added to `UiDefinition` to specify which catalog a UI surface should use.
- **Refactor**: Moved `standardCatalogId` constant from `basic_catalog.dart` to `primitives/constants.dart` for better organization and accessibility.
- **Fix**: `MultipleChoice` widget now correctly handles `maxAllowedSelections` when provided as a `double` in JSON, preventing type cast errors.
- **Fix**: The `Text` catalog item now respects the ambient `DefaultTextStyle`, resolving contrast issues where, for example, text inside a dark purple primary `Button` would be black instead of white.

## 0.5.1

- Homepage URL was updated.
- Deprecated `flutter_markdown` package was replaced with `flutter_markdown_plus`.

## 0.5.0

- Initial published release.

## 0.4.0

- **BREAKING**: Replaced `AiClient` interface with `ContentGenerator`. `ContentGenerator` uses a stream-based API (`a2uiMessageStream`, `textResponseStream`, `errorStream`) for asynchronous communication of AI-generated UI commands, text, and errors.
- **BREAKING**: `GenUiConversation` now requires a `ContentGenerator` instance instead of an `AiClient`.
- **Feature**: Introduced `A2uiMessage` sealed class (`BeginRendering`, `SurfaceUpdate`, `DataModelUpdate`, `SurfaceDeletion`) to represent AI-to-UI commands, emitted from `ContentGenerator.a2uiMessageStream`.
- **Feature**: Added `FakeContentGenerator` for testing purposes, replacing `FakeAiClient`.
- **Feature**: Added `configureGenUiLogging` function and `genUiLogger` instance for configurable package logging.
- **Feature**: Added `JsonMap` type alias in `primitives/simple_items.dart`.
- **Feature**: Added `DirectCallHost` and related utilities in `facade/direct_call_integration` for more direct AI model interactions.
- **Refactor**: `GenUiConversation` now internally subscribes to `ContentGenerator` streams and uses callbacks (`onSurfaceAdded`, `onSurfaceUpdated`, `onSurfaceDeleted`, `onTextResponse`, `onError`) to notify the application of events.
- **Fix**: Improved error handling and reporting through the `ContentGenerator.errorStream` and `ContentGeneratorError` class.

## 0.2.0

- **BREAKING**: Replaced `ElevatedButton` with a more generic `Button` component.
- **BREAKING**: Removed `CheckboxGroup` and `RadioGroup` from the basic catalog. The `MultipleChoice` or `CheckBox` widgets can be used as replacements.
- **Feature**: Added an `obscured` property to `TextInputChip` to allow for password style inputs.
- **Feature**: Added many new components to the basic catalog: `AudioPlayer` (placeholder), `Button`, `Card`, `CheckBox`, `DateTimeInput`, `Divider`, `Heading`, `List`, `Modal`, `MultipleChoice`, `Row`, `Slider`, `Tabs`, and `Video` (placeholder).
- **Fix**: Corrected the action key from `actionName` to `name` in `Trailhead` and `TravelCarousel`.
- **Fix**: Corrected the image property from `location` to `url` in `TravelCarousel`.

## 0.1.0

- Initial commit

# Dart: migrate from `genui` to the A2UI Dart SDKs

Case of the [migration skill](../SKILL.md).

- **Language**: Dart / Flutter.
- **From**: `package:genui` 0.10.x (flutter/genui), which speaks A2UI v0.9.
- **To**: `package:a2ui_core` and `package:a2ui_flutter` from this repository,
  plus `package:a2ui_agent` for apps that prompt a model themselves. These
  are the A2UI 1.0 SDKs: they speak v0.9 and v1.0 with one processor, so the
  wire version can stay at v0.9 or move to v1.0 in the same migration.

`genui` 0.10 was the Flutter renderer for A2UI v0.9. The A2UI project
replaced it with three packages in this repository:

| Package             | What it owns                                                                                           | genui layer it replaces                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `dart/a2ui_core`    | Messages, `MessageProcessor`, surfaces, data model, expressions, basic catalog functions, capabilities | `SurfaceController`, `A2uiMessage`, `DataModel`, `ClientFunction`, `A2UiClientCapabilities`, `package:genui/a2ui_core.dart` |
| `dart/a2ui_flutter` | `A2uiSurface` widget, `ComponentImplementation`, `ComponentProps`, basic catalog widgets               | `Surface`, `CatalogItem`, `Catalog`, `BasicCatalogItems`, `A2uiSchemas`, `BoundString`, `CatalogItemContext`                |
| `dart/a2ui_agent`   | Prompting a model for A2UI and parsing its streamed reply                                              | `A2uiTransportAdapter`, `A2uiParserTransformer`, `Conversation` (only when the app talks to a raw LLM)                      |
| `dart/a2ui_cli`     | Generates typed Dart classes for a catalog                                                             | Hand-written data classes over `CatalogItemContext.data`                                                                    |

The new packages speak A2UI v0.9 and v1.0 with one `MessageProcessor`, so
an app can move off genui first and move its agent to v1.0 later.

## Before you start

1. Read [API mapping](#api-mapping) for the
   symbol-by-symbol table, [Recipes](#recipes)
   for before/after code, and
   [Behavior changes](#behavior-changes) for
   what the processor now does differently. Keep them open while you edit.
2. Inventory the code: list every file that imports `package:genui/` and
   note which of these it uses, because each is a separate step below:
   - renderer wiring (`SurfaceController`, `Surface`, `onSubmit`,
     `surfaceUpdates`, `contextFor`, `ActionDelegate`, `A2uiTransportAdapter`,
     `Conversation`, `A2UiClientCapabilities`);
   - custom components (`CatalogItem`, `CatalogItemContext`, `Catalog`,
     `BasicCatalogItems`, `A2uiSchemas`, `BoundString`/`BoundObject`,
     `DataContext`, `buildWeightedChild`, `ComponentChildrenBuilder`);
   - client functions (`ClientFunction`, `SynchronousClientFunction`,
     `ExecutionContext`, `BasicFunctions`);
   - types genui re-exported from other packages: `ChatMessage`, `TextPart`,
     `DataPart`, `UiInteractionPart` (from `genai_primitives`) and signals
     (from `preact_signals`);
   - tests that build a `SurfaceController` and pump a `Surface`.
3. Decide the wire version. Every genui app speaks **v0.9**. Keep v0.9 when
   the agent is not changing in the same step: use
   `package:a2ui_flutter/v0_9/basic_catalog.dart` and `CommonSchemas`. Move to
   v1.0 only together with the agent: use
   `package:a2ui_flutter/basic_catalog.dart` and `CommonSchemasV1`, and read
   the v1.0 notes in each reference. The processor serves both at once, so a
   transition period can register catalogs of each version.

## Migration steps

Do the steps in order; each leaves the code compiling if the previous one is
complete. Commit after each step when the change is large.

### 1. Dependencies

`pubspec.yaml`: remove `genui`; add `a2ui_core` and `a2ui_flutter` (see
`dart/a2ui_flutter/README.md` for the current version constraints), keep
`json_schema_builder` if the app declares component schemas, and add
`genai_primitives` explicitly if the app still uses `ChatMessage` or the UI
parts from it. Add `a2ui_agent` only for an app that prompts a model itself.
Markdown rendering and `openUrl` are no longer built in: add
`flutter_markdown_plus` (or another Markdown widget) and `url_launcher` if the
app relied on them.

Imports:

```dart
// Remove
import 'package:genui/genui.dart';
import 'package:genui/a2ui_core.dart';

// Add what the file needs
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9; // v0.9 basic catalog
import 'package:a2ui_flutter/basic_catalog.dart';              // v1.0 basic catalog
import 'package:json_schema_builder/json_schema_builder.dart' hide ValidationResult;
```

`ValidationResult` exists in both `a2ui_core` and `json_schema_builder`;
hide the latter. If the app already defines its own `A2uiProtocolVersion` enum, use `import 'package:a2ui_core/a2ui_core.dart' hide A2uiProtocolVersion;` and alias `a2ui_core` where the SDK enum is needed.

### 2. Renderer wiring

Replace `SurfaceController` with `MessageProcessor<ComponentImplementation>`
and `Surface` with `A2uiSurface`. The processor takes decoded JSON directly,
so `A2uiMessage.fromJson` and `A2uiTransportAdapter` go away:

```dart
processor = MessageProcessor<ComponentImplementation>(
  catalogs: [myCatalog],
  defaultVersion: A2uiProtocolVersion.v0_9,
  validationConfig: ValidationConfig.relaxed,
);
processor.model.onSurfaceCreated.subscribe(_addSurface);
processor.model.onSurfaceDeleted.subscribe(_removeSurface);
processor.model.onAction.subscribe(_sendAction);

processor.processMessages(jsonDecode(body)); // a map, a list, or {"messages": [...]}

A2uiSurface(key: ObjectKey(surface), surface: surface)
```

What changes in behaviour, with the fix for each:

- `onSubmit` is gone. Actions arrive on `processor.model.onAction` as
  `A2uiRendererAction`; build the wire message with
  `ActionMessage(version: 'v0.9', action: action).toJson()`. The JSON is the
  same `{"version":"v0.9","action":{...}}` genui sent inside its
  `UiInteractionPart`, so a backend that reads that string keeps working if
  the app keeps the outer framing.
- Errors arrive on `surface.onError` (subscribe inside `onSurfaceCreated`),
  and `processMessages` **throws** `A2uiError` for a bad message instead of
  reporting it. Catch it and send an `ErrorMessage`, or call
  `processMessagesWithErrors` where available. See recipe (e) for the
  `A2uiRendererError` constraints.
- `ActionDelegate` is gone. Decide in the `onAction` listener which actions
  stay local and which go to the agent.
- `surfaceUpdates` / `activeSurfaceIds` / `contextFor` become
  `onSurfaceCreated` / `onSurfaceDeleted` / `processor.model.getSurface(id)`.
  There is no "components updated" event; `A2uiSurface` rerenders itself.
- `clientCapabilities.toJson()` becomes
  `processor.getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9])).toJson()`,
  which produces the same `{"v0.9": {"supportedCatalogIds": [...]}}`.
- Wrap `A2uiSurface` in `A2uiMarkdown` if the app showed Markdown in Text.
- `Conversation` and `A2uiTransportAdapter` have no equivalent. An app
  whose backend returns A2UI JSON decodes it and calls `processMessages`. An
  app that prompts a model directly moves to `a2ui_agent` (recipe (f)).
- Dispose: unsubscribe your `Subscription`s, then `processor.dispose()`.

### 3. Catalogs

`Catalog` becomes `CatalogImplementation` (an alias of
`Catalog<ComponentImplementation, FunctionImplementation>`). The constructor
needs an `id`, and the v0.9 variant needs the basic functions, theme schema
and definitions, because a v0.9 surface has exactly one catalog:

```dart
CatalogImplementation(
  id: 'https://example.com/catalog.json',                 // what the agent sends as catalogId
  components: [...v0_9.BasicComponents.all, myComponent],
  functions: BasicCatalog.v0_9().functions.values.toList(),
  themeSchema: v0_9.BasicComponents.api.themeSchema,
  definitions: v0_9.BasicComponents.api.definitions,
)
```

- `functions`, `themeSchema` and `definitions` are optional. A catalog that
  does not build on the basic components and whose agent sends no theme and
  calls no basic function is just `CatalogImplementation(id:, components:)`.
  Pass the basic ones only when the agent uses them.
- `BasicCatalogItems.asCatalog()` becomes `v0_9.basicCatalog(openUrl: ...)`
  (v0.9) or `basicCatalog(openUrl: ...)` (v1.0).
- `copyWith(newItems:)` replaced items by name; `CatalogImplementation`
  throws on a duplicate name. Filter `BasicComponents.all` before adding an
  override.
- `catalogIdAliases` is gone. Register the same component list under each id
  the agent may send. Note that `basicCatalog()` registers only
  `BasicCatalog.v0_9Id`, not genui's legacy
  `https://a2ui.org/specification/v0_9/basic_catalog.json`.
- A missing or unknown `catalogId` on a v0.9 `createSurface` is an error
  (`A2uiValidationError` when absent, `A2uiCatalogError` when unregistered),
  not a tolerated stub. Notice also that `Catalog([...])` with no `catalogId`
  in genui synthesized an unreachable `inline_catalog_<hashCode>` id: pick a
  stable id, register every id the agent sends up front, and if a legacy v0.9
  backend omits `catalogId` on `createSurface`, inject the default id into the
  decoded map before calling `processMessages`.
- For v1.0, put only your own components in your catalog, set
  `protocolVersion: A2uiProtocolVersion.v1_0`, and register `basicCatalog()`
  beside it.

### 4. Custom components

`CatalogItem(name, dataSchema, widgetBuilder)` becomes
`ComponentImplementation(name, schema, builder)`. The builder receives
resolved properties, so the `BoundString`, `ValueListenableBuilder`,
`StreamBuilder` and `DataContext.subscribe*` layers disappear:

```dart
ComponentImplementation(
  name: 'Rating',
  schema: Schema.object(
    properties: {
      'label': CommonSchemas.dynamicString,   // was A2uiSchemas.stringReference()
      'value': CommonSchemas.dynamicNumber,   // was A2uiSchemas.numberReference()
      'onChanged': CommonSchemas.action,      // was A2uiSchemas.action()
      'children': CommonSchemas.childList,    // was A2uiSchemas.componentArrayReference()
    },
    required: ['value'],
  ),
  builder: (context, node, props, buildChild) {
    final WritableBinding<Object?>? value = props.writable('value');
    return StarRating(
      label: props.string('label') ?? '',
      value: props.number('value') ?? 0,
      onChanged: value == null ? null : (stars) {
        value.set(stars);                              // was dataContext.update(DataPath(...))
        unawaited(props.action('onChanged')?.call());  // was resolveContext + dispatchEvent
      },
      children: [for (final child in props.children('children')) buildChild(child)],
    );
  },
)
```

Rules that differ from genui:

- Read with `props.string/number/boolean/list/value(key)`; the builder reruns
  when any bound value changes. Properties declared with non-dynamic schemas
  (plain `Schema.string()`, `Schema.object()`, `Schema.list()`) are passed
  through unchanged as deep-frozen snapshots (`props.value(key)` returns an
  unmodifiable `Map` or `List`).
- A factory constructor can be passed directly as `builder` when it matches
  `ComponentWidgetBuilder`:
  `factory MyWidget.fromNode(BuildContext context, ComponentNode<ComponentImplementation> node, ComponentProps props, ChildWidgetBuilder buildChild)`
  (replacing `widgetBuilder: MyWidget.fromContext`).
- Write only through `props.writable(key)`, which is null when the agent gave
  a literal. genui's fallback path `<id>.value` no longer exists.
- Call `props.action(key)` synchronously in the gesture handler; it resolves
  the action context and runs as a user activation.
- Child references must be top-level properties declared with
  `CommonSchemas.componentId` / `childList` (v0.9) or a `$ref` to
  `common_types.json#/$defs/Child` / `ChildList` (v1.0); otherwise the
  builder receives id strings. Wrap each child you decorate in
  `KeyedSubtree(key: NodeKey(child.instanceId), ...)`.
- `isImplicitlyFlexible` and `exampleData` have no equivalent: give widgets a
  bound with `LimitedBox`, and move examples into
  `CatalogImplementation(instructions:)` or prompts.
- Accessibility attributes are applied by the framework; do not wrap in
  `Semantics` for them.
- `A2uiSurface.of(context)` gives the surface for `theme`, `id`,
  `dataModel` and `dispatchError`.

### 5. Client functions

`SynchronousClientFunction` / `AsynchronousClientFunction` become
`FunctionImplementation`s passed to `CatalogImplementation(functions:)`; see
the functions section of the mapping and recipe (k). Functions that mutated
the data model as a side effect (`setValue`-style) have no sanctioned
equivalent: on v0.9 keep the write in the component through
`props.writable`, on v1.0 use an action whose handler writes through
`surface.dataModel`.

### 6. Tests

Tests that built a `SurfaceController` and pumped a `Surface`—or that called
`catalogItem.widgetBuilder(CatalogItemContext(...))` directly with a
hand-built `CatalogItemContext`—now build a
`MessageProcessor<ComponentImplementation>` with
`ValidationConfig.strict`, feed JSON with `processMessages`, and pump
`A2uiSurface(surface: processor.model.getSurface(id)!)` under
`MaterialApp(home: Scaffold(...))`. Recipe (m) has a self-contained harness.
Assert on `processor.model.onAction` events and `surface.dataModel.get('/path')`
instead of `onSubmit` and `DataModel.getValue(DataPath(...))`.

### 7. Clean up

- Remove the `genui` dependency and every `package:genui/` import; search for
  leftover `JsonMap` (use `Map<String, Object?>`), `DataPath` (JSON Pointer
  strings) and `genUiLogger` (the new packages log under `a2ui.*` through
  `package:logging`).
- Run `dart analyze`, the app's tests, and a manual check of a surface with
  an input and an action against the real agent.

## Checklist

- [ ] No `package:genui/` imports remain; `genui` is out of `pubspec.yaml`.
- [ ] Every catalog id the agent sends is registered on the processor,
      including aliases and the legacy basic catalog id if used.
- [ ] v0.9 catalogs built on the basic components pass `functions`,
      `themeSchema` and `definitions`.
- [ ] `processMessages` is wrapped in a `try`/`on A2uiError`, and surface
      errors are forwarded to the agent.
- [ ] Actions reach the agent with the envelope the backend expects.
- [ ] Capabilities and, when `sendDataModel` is used, the data model go out
      in request metadata.
- [ ] Each custom component declares child references and actions with the
      common types, and reads values through `props`.
- [ ] Widget tests pump `A2uiSurface` under `MaterialApp` and pass with
      `ValidationConfig.strict`.
- [ ] `Subscription`s are unsubscribed and the processor disposed.

## API mapping

Old symbols are from `genui` 0.10.x;
new symbols are from the packages under `dart/` in this repository. Paths in
the notes are relative to `dart/`.

Imports on the new side:

```dart
import 'package:a2ui_core/a2ui_core.dart';       // MessageProcessor, SurfaceModel, messages, errors, DataModel, CommonSchemas*, FunctionImplementation, BasicCatalog
import 'package:a2ui_flutter/a2ui_flutter.dart'; // A2uiSurface, ComponentImplementation, CatalogImplementation, ComponentProps, NodeKey
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9; // v0.9 basicCatalog(), BasicComponents, A2uiMarkdown
import 'package:a2ui_flutter/basic_catalog.dart';              // v1.0 basicCatalog(), BasicComponents, A2uiMarkdown
import 'package:json_schema_builder/json_schema_builder.dart' hide ValidationResult;
```

### 1. Renderer wiring

| genui                                                                                                            | New                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SurfaceController({required Iterable<Catalog> catalogs, pendingUpdateTimeout})`                                 | `MessageProcessor<ComponentImplementation>({required List<CatalogImplementation> catalogs, A2uiProtocolVersion? defaultVersion, ValidationConfig? validationConfig, onAction, onError, OutboundMessageListener? outboundListener})` | `a2ui_core/lib/src/processing/processor.dart`. No `pendingUpdateTimeout`: updates for a surface that does not exist yet are errors, see behavior changes. `catalogs` is unmodifiable after construction.                                                                                                                                                                     |
| `controller.catalogs`                                                                                            | `processor.catalogs`                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                              |
| `controller.handleMessage(A2uiMessage)`; `A2uiMessageSink`                                                       | `processor.processMessages(Object? payload)`                                                                                                                                                                                        | Takes a decoded envelope map, a list of envelopes, `{"messages": [...]}`, or parsed `AgentToRendererMessage`s. Throws `A2uiError` synchronously. `processMessagesWithErrors(payload)` returns `List<ErrorMessage>` instead.                                                                                                                                                  |
| `A2uiMessage.fromJson(map)` (`package:genui/a2ui_core.dart`)                                                     | `AgentToRendererMessage.fromJson(map)`                                                                                                                                                                                              | Pass JSON directly to `processMessages` unless the app distinguishes envelope parsing (`AgentToRendererMessage.fromJson` throws only on malformed envelopes) from semantic processing (`processMessages` also throws `A2uiError` on unknown `catalogId`, missing surface, or schema failure).                                                                                |
| `CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`, `DeleteSurfaceMessage`              | Same names in `a2ui_core`                                                                                                                                                                                                           | `version` is a required constructor argument; `catalogId` is nullable (optional on v1.0 only). `toJson()` produces the same wire shape.                                                                                                                                                                                                                                      |
| `controller.surfaceUpdates` (`SurfaceAdded`, `ComponentsUpdated`, `SurfaceRemoved`)                              | `processor.model.onSurfaceCreated: EventSource<SurfaceModel>`, `processor.model.onSurfaceDeleted: EventSource<String>`                                                                                                              | `subscribe(listener)` returns a `Subscription`; call `unsubscribe()` on dispose. No components-updated event; `A2uiSurface` rerenders on its own.                                                                                                                                                                                                                            |
| `controller.activeSurfaceIds`                                                                                    | `processor.model.allSurfaces.map((s) => s.id)` or a list the app keeps from the two events                                                                                                                                          | genui moved a surface to the end on each update; `allSurfaces` keeps creation order.                                                                                                                                                                                                                                                                                         |
| `controller.contextFor(id)` → `SurfaceContext`                                                                   | `processor.model.getSurface(id)` → `SurfaceModel<ComponentImplementation>?`                                                                                                                                                         | Unlike `contextFor(id)` (which lazily created a `SurfaceContext` even before `createSurface` arrived), `getSurface(id)` returns `null` until `createSurface` succeeds. `SurfaceModel` has `id`, `protocolVersion`, `defaultCatalog`, `availableCatalogs`, `theme`, `sendDataModel`, `dataModel`, `componentsModel`, `onAction`, `onError`, `onWarning`.                      |
| `SurfaceContext.definition` (`ValueListenable<SurfaceDefinition?>`)                                              | none needed                                                                                                                                                                                                                         | Pass the `SurfaceModel` to `A2uiSurface`.                                                                                                                                                                                                                                                                                                                                    |
| `SurfaceContext.dataModel`                                                                                       | `surface.dataModel`                                                                                                                                                                                                                 | Different class; see section 4.                                                                                                                                                                                                                                                                                                                                              |
| `SurfaceContext.catalog`                                                                                         | `surface.defaultCatalog`                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                                                              |
| `SurfaceContext.handleUiEvent(UiEvent)` / `controller.handleUiEvent`                                             | `surface.dispatchAction(Map payload, String sourceComponentId)`                                                                                                                                                                     | Built-in and custom components dispatch through `props.action`; app code only listens.                                                                                                                                                                                                                                                                                       |
| `SurfaceContext.reportError(error, stack)` / `controller.reportError`                                            | `surface.dispatchError(A2uiRendererError(...))`                                                                                                                                                                                     | Typed error with `code`, `surfaceId`, `message`, `path`, `details`.                                                                                                                                                                                                                                                                                                          |
| `controller.onSubmit: Stream<ChatMessage>`                                                                       | `processor.model.onAction: EventSource<A2uiRendererAction>` for actions; `surface.onError: EventSource<A2uiRendererError>` for errors; `outboundListener` for RPC messages                                                          | The app builds the wire message: `ActionMessage(version:, action:)`, `ErrorMessage(version:, error:)`, `RendererToAgentMessagePayload.of(message).toJson()` for the `{"messages": [...]}` form.                                                                                                                                                                              |
| `ChatMessage`, `UiInteractionPart.create(json)` (from `genai_primitives`)                                        | none                                                                                                                                                                                                                                | The envelope around A2UI JSON is app-defined. The inner `{"version":"v0.9","action":{...}}` JSON is unchanged, so an app can keep its old framing.                                                                                                                                                                                                                           |
| `UiEvent`, `UserActionEvent(name, context, surfaceId, sourceComponentId)`                                        | `A2uiRendererAction(name, surfaceId, sourceComponentId, timestamp, context, userMessage, catalogId, metadata)`                                                                                                                      | `toJson()` adds a UTC ISO-8601 `timestamp` and optional `userMessage`, `catalogId`, `metadata`.                                                                                                                                                                                                                                                                              |
| `DispatchEventCallback`                                                                                          | `void Function(A2uiRendererAction)`                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                              |
| `ActionDelegate`, `DefaultActionDelegate`, `Surface(actionDelegate:)`                                            | none                                                                                                                                                                                                                                | Branch on `action.name` in the `onAction` listener; handle locally or forward.                                                                                                                                                                                                                                                                                               |
| `controller.clientCapabilities`, `A2UiClientCapabilities.fromCatalogs(catalogs, inlineHandling:)`                | `processor.getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9], includeInlineCatalogs: false))`                                                                                                        | `toJson()` gives `{"v0.9": {"supportedCatalogIds": [...]}}`, the same shape (`inlineCatalogs` on `A2uiVersionCapabilities` is a non-null `List<CatalogApi>` defaulting to `[]`, omitted from `toJson()` when empty). `InlineCatalogHandling.none/missingIds/all` collapses to the boolean.                                                                                   |
| manual data-model snapshot                                                                                       | `processor.getRendererDataModel(version: A2uiProtocolVersion.v0_9)`                                                                                                                                                                 | Null until a surface with `sendDataModel: true` exists; send as `a2uiClientDataModel` (v0.9) or `a2uiRendererDataModel` (v1.0).                                                                                                                                                                                                                                              |
| `Surface({surfaceContext, defaultBuilder, actionDelegate})`                                                      | `A2uiSurface({Key? key, required SurfaceModel<ComponentImplementation> surface})`                                                                                                                                                   | Key it with `ObjectKey(surface)`. No `defaultBuilder`: if a wrapper widget previously relied on `defaultBuilder` before `createSurface` arrived, accept `SurfaceModel<ComponentImplementation>?` and render the fallback when `surface == null` (or when `surface.componentsModel.get('root') == null`). `A2uiSurface.of(context)` / `maybeOf` return the enclosing surface. |
| `FallbackWidget`                                                                                                 | none                                                                                                                                                                                                                                | Keep a copy in the app if it is shown for other reasons. To render a custom widget for unresolved or unknown children, check `child.state != NodeState.resolved` (or `child.impl == null`) before calling `buildChild(child)`.                                                                                                                                               |
| `A2uiTransportAdapter`, `A2uiParserTransformer`, `Transport`, `GenerationEvent`, `TextEvent`, `A2uiMessageEvent` | none in `a2ui_core`/`a2ui_flutter`                                                                                                                                                                                                  | Backend returns A2UI JSON: `jsonDecode` and `processMessages`. App prompts a model: `package:a2ui_agent` (`A2uiGenerator`, `A2uiRequestProcessor.openStream`, `ResponsePart` = `TextPart` or `A2uiPart`).                                                                                                                                                                    |
| `Conversation`, `ConversationState`, `ConversationEvent`, `ConversationError`                                    | none                                                                                                                                                                                                                                | App-owned state; `dart/a2ui_flutter/example/lib/chat_session.dart` is a model to copy.                                                                                                                                                                                                                                                                                       |
| `InternalMessageView`, `ChatMessageView`                                                                         | none                                                                                                                                                                                                                                | App-owned widgets.                                                                                                                                                                                                                                                                                                                                                           |
| `'v0.9'` literal                                                                                                 | `A2uiProtocolVersion.v0_9.jsonValue`                                                                                                                                                                                                | Values: `v0_9` (`'v0.9'`), `v0_9_1` (`'v0.9.1'`), `v1_0` (`'1.0'`).                                                                                                                                                                                                                                                                                                          |
| `controller.dispose()`                                                                                           | unsubscribe `Subscription`s, then `processor.dispose()`                                                                                                                                                                             | Disposing fires `onSurfaceDeleted` for each surface.                                                                                                                                                                                                                                                                                                                         |

### 2. Catalogs and components

| genui                                                                                  | New                                                                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --- |
| `Catalog(items, catalogId:, catalogIdAliases:, functions:, systemPromptFragments:)`    | `CatalogImplementation(id:, components:, functions:, protocolVersion:, themeSchema:, definitions:, instructions:, title:, description:)`                                                                                               | `CatalogImplementation` = `Catalog<ComponentImplementation, FunctionImplementation>`. `id` is required. `protocolVersion` null means pre-1.0.                                                                                                                                                                                                                                                                                                        |
| `catalog.copyWith(newItems:, newFunctions:, catalogId:)`                               | build a new list                                                                                                                                                                                                                       | Duplicate component names throw `A2uiCatalogError`; filter before overriding: `BasicComponents.all.where((c) => c.name != 'Text')`.                                                                                                                                                                                                                                                                                                                  |
| `catalog.copyWithout(itemsToRemove:)`                                                  | `BasicComponents.all.where(...)` or pick `BasicComponents.row`, `.column`, ...                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `catalog.catalogIdAliases`, `matchesId`                                                | a second `CatalogImplementation` with the alias id and the same components                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `catalog.items`, `catalog.functions` (iterables)                                       | `catalog.components`, `catalog.functions` (`Map<String, ...>`)                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `catalog.fullSchema`, `catalog.definition`, `toCapabilitiesJson()`                     | `catalog.toJson()`, `catalog.validationSchema`                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BasicCatalogItems.asCatalog()`                                                        | `v0_9.basicCatalog(openUrl:, locale:)` (v0.9) or `basicCatalog(openUrl:, locale:)` (v1.0)                                                                                                                                              | Ids: `BasicCatalog.v0_9Id`, `BasicCatalog.v1_0Id`. The genui legacy alias `https://a2ui.org/specification/v0_9/basic_catalog.json` is not registered.                                                                                                                                                                                                                                                                                                |
| `BasicCatalogItems.asNoAssetCatalog()`                                                 | `CatalogImplementation(id: BasicCatalog.v0_9Id, components: v0_9.BasicComponents.all.where((c) => !{'Image', 'Video', 'AudioPlayer'}.contains(c.name)).toList(), functions: ..., themeSchema: ..., definitions: ...)`                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BasicCatalogItems.text`, `.row`, ... (static `CatalogItem`s)                          | `BasicComponents.text`, `.row`, ... (static `ComponentImplementation`s); `BasicComponents.all`; `BasicComponents.api` (`themeSchema`, `definitions`, `instructions`)                                                                   | In the version-specific library.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `basicCatalogId`, `legacyBasicCatalogId`, `commonTypesSchemaId`                        | `BasicCatalog.v0_9Id`, `BasicCatalog.v1_0Id`; no legacy or common-types constant                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BasicCatalogItems.basicCatalogRules`                                                  | `BasicComponents.api.instructions`                                                                                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CatalogItem(name:, dataSchema:, widgetBuilder:, exampleData:, isImplicitlyFlexible:)` | `ComponentImplementation(name:, schema:, builder:)`                                                                                                                                                                                    | `exampleData` and `isImplicitlyFlexible` have no equivalent. If porting `genui`'s built-in `BasicCatalogItems` example JSON for v0.9 tests, fix three legacy keys rejected by `a2ui_core`'s strict schemas: `Button` (`"primary": true` -> `"variant": "primary"`), `DateTimeInput` (`"variant": "date"`/`"time"` -> `"enableDate": true`/`"enableTime": true`), and `Tabs` (`tabItems[].label`/`content` -> `title`/`child`, remove `"activeTab"`). |
| `widgetBuilder: (CatalogItemContext itemContext) => ...`                               | `builder: (BuildContext context, ComponentNode<ComponentImplementation> node, ComponentProps props, ChildWidgetBuilder buildChild) => ...`                                                                                             | `a2ui_flutter/lib/src/component_implementation.dart`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `itemContext.data` (raw JSON)                                                          | `props` (resolved values)                                                                                                                                                                                                              | To pass all resolved properties as a `Map<String, Object?>` to an existing `fromJson` helper, build `{for (final key in props.keys) key: props.value(key)}`. Authored JSON is still at `node.context!.componentModel.properties` if needed.                                                                                                                                                                                                          |
| `itemContext.id`                                                                       | `node.componentId`; `node.instanceId` for keys                                                                                                                                                                                         | `instanceId` is unique per tree position (template children get a suffix).                                                                                                                                                                                                                                                                                                                                                                           |
| `itemContext.type`                                                                     | `node.type`                                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `itemContext.buildChild(childId, [dataContext])`                                       | `buildChild(props.child('key')!)` / `for (final c in props.children('key')) buildChild(c)`                                                                                                                                             | Template children are already expanded into nodes.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `itemContext.dispatchEvent(UserActionEvent(...))` after `resolveContext(...)`          | `unawaited(props.action('key')?.call())`                                                                                                                                                                                               | Call synchronously from the gesture handler. Ad hoc action not in the schema: `node.context!.dispatchAction({'event': {'name': ..., 'context': {...}}})`.                                                                                                                                                                                                                                                                                            |
| `itemContext.buildContext`                                                             | `context`                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `itemContext.dataContext`                                                              | `node.context!.dataContext`                                                                                                                                                                                                            | Rarely needed; `props` covers declared properties.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `itemContext.getComponent(id)`                                                         | `A2uiSurface.of(context).componentsModel.get(id)`; `props.children(key)` / `props.child(key)` include placeholder nodes (`state == NodeState.pending` or `NodeState.unknownType`, `impl == null`), replacing `getComponent(id) == null |                                                                                                                                                                                                                                                                                                                                                                                                                                                      | getCatalogItem(type) == null` |     |
| `itemContext.getCatalogItem(type)`                                                     | `child.impl`; `A2uiSurface.of(context).defaultCatalog?.components[type]`                                                                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `itemContext.surfaceId`                                                                | `A2uiSurface.of(context).id`                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `itemContext.reportError(error, stack)`                                                | `unawaited(surface.dispatchError(A2uiRendererError(code:, surfaceId: surface.id, message:)))`                                                                                                                                          | `surface.dispatchWarning(A2uiWarning(...))` for non-fatal.                                                                                                                                                                                                                                                                                                                                                                                           |
| `BoundString(dataContext:, value:, builder:)`                                          | `props.string('key')`                                                                                                                                                                                                                  | Numbers and booleans are stringified.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BoundNumber`, `BoundBool`, `BoundList`, `BoundObject`, `BoundValue<T>`                | `props.number('key')`, `props.boolean('key')`, `props.list('key')`, `props.value('key')`                                                                                                                                               | Null or empty when absent or of another shape.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OptionalValueBuilder`                                                                 | none                                                                                                                                                                                                                                   | `if (value == null) return const SizedBox.shrink();`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dataContext.subscribe<T>(DataPath)`, `subscribeStream<T>`                             | `props` for declared properties; `A2uiSurface.of(context).dataModel.watch<T>('/abs/path')` → `ReadonlySignal<T?>` for anything else                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dataContext.getValue<T>(DataPath)`                                                    | `surface.dataModel.get('/abs/path')`                                                                                                                                                                                                   | Returns `Object?`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dataContext.update(DataPath(path), value)`                                            | `props.writable('key')?.set(value)`                                                                                                                                                                                                    | Null when the agent gave a literal. `set` throws `A2uiDataError` for an unwritable path. Arbitrary path: `node.context!.dataContext.set(relativePath, value)`.                                                                                                                                                                                                                                                                                       |
| genui's implicit write path `<componentId>.value`                                      | none                                                                                                                                                                                                                                   | Keep local widget state for an unbound input.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `dataContext.resolve(value)` (`Stream`)                                                | `node.context!.dataContext.resolveDynamicValue(value)` (one-shot) / `resolveSignal(value)` (reactive)                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ValidationHelper.validateStream(checks, ctx)`, `evaluateConditionStream`              | `props.isValid`, `props.validationErrors`, `props.validationResults`                                                                                                                                                                   | The schema must declare `checks`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resolveContext(dataContext, contextDefinition)`                                       | done by `NodeAction`; manual: `node.context!.dataContext.resolveActionAsync(actionMap)`                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `DataContext.nested(DataPath)`, `resolvePath(DataPath)`                                | `dataContext.childContext(relativePath)`, `dataContext.resolvePath(relativePath)`                                                                                                                                                      | Paths are JSON Pointer strings.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `buildWeightedChild(...)`, `ComponentChildrenBuilder`                                  | none                                                                                                                                                                                                                                   | `for (final c in props.children('children')) KeyedSubtree(key: NodeKey(c.instanceId), child: Flexible(flex: ..., child: buildChild(c)))`; read a child's weight with `ComponentProps(c.props.peek()).number('weight')`.                                                                                                                                                                                                                              |
| `A2uiAccessibility`                                                                    | automatic                                                                                                                                                                                                                              | `NodeView` applies `accessibility.label/description/live/hidden`.                                                                                                                                                                                                                                                                                                                                                                                    |
| `Component(id, type, properties)`, `SurfaceDefinition`                                 | `ComponentModel`, `SurfaceModel`                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `JsonMap`                                                                              | `Map<String, Object?>`                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CatalogItemNotFoundException`                                                         | none                                                                                                                                                                                                                                   | Unknown type renders nothing and reports on `surface.onError`.                                                                                                                                                                                                                                                                                                                                                                                       |
| surface theme (`SurfaceDefinition.theme`)                                              | `A2uiSurface.of(context).theme` (`Map`)                                                                                                                                                                                                | v0.9 basic components apply `primaryColor`; custom ones apply their own `Theme`. v1.0 has no theme.                                                                                                                                                                                                                                                                                                                                                  |
| built-in Markdown in Text                                                              | `A2uiMarkdown(builder: (context, markdown, style) => MarkdownBody(data: markdown), child: A2uiSurface(...))`                                                                                                                           | Without it Text strips common Markdown markers.                                                                                                                                                                                                                                                                                                                                                                                                      |

#### Schemas: `A2uiSchemas` → `CommonSchemas` (v0.9) / `CommonSchemasV1` (v1.0)

| `A2uiSchemas.`                   | v0.9 `CommonSchemas.`                                                             | v1.0                                                               |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `stringReference()`              | `dynamicString`                                                                   | `CommonSchemasV1.dynamicString`                                    |
| `stringReference(enumValues:)`   | `Schema.string(enumValues:)` for literal-only, or an `allOf` with `dynamicString` | same                                                               |
| `numberReference()`              | `dynamicNumber`                                                                   | `CommonSchemasV1.dynamicNumber`                                    |
| `booleanReference()`             | `dynamicBoolean`                                                                  | `CommonSchemasV1.dynamicBoolean`                                   |
| `stringArrayReference()`         | `dynamicStringList`                                                               | `CommonSchemasV1.dynamicStringList`                                |
| `propertyReference()`            | `dynamicValue`                                                                    | `CommonSchemasV1.dynamicValue`                                     |
| `dataBindingSchema()`            | `dataBinding` (`{path}`)                                                          | `CommonSchemasV1.dataBinding` (`{@path}`)                          |
| `functionCall()`                 | `functionCall` (`{call, args, returnType}`)                                       | `CommonSchemasV1.functionCall` (`{@call, args, catalogId}`)        |
| `componentReference()`           | `componentId`                                                                     | `Schema.fromMap({r'$ref': r'common_types.json#/$defs/Child'})`     |
| `componentArrayReference()`      | `childList`                                                                       | `Schema.fromMap({r'$ref': r'common_types.json#/$defs/ChildList'})` |
| `action()`                       | `action`                                                                          | `Schema.fromMap({r'$ref': r'common_types.json#/$defs/Action'})`    |
| `checkable()` as `'checks': ...` | `Schema.list(items: CommonSchemas.checkRule)`                                     | `Schema.list(items: CommonSchemasV1.checkRule)`                    |
| `validationCheck()`              | `checkRule`                                                                       | `CommonSchemasV1.checkRule`                                        |
| (none)                           | `accessibilityAttributes`, `componentCommon`                                      | same on `CommonSchemasV1`                                          |

`CommonSchemasV1` has no `action`, `componentId` or `childList` member; use
the `$ref` forms. A child reference declared as plain `Schema.string()` is
not resolved to a node and the builder receives the id string. `CommonSchemas.*`
are static `Schema` constants rather than factory functions; to preserve a
property `description` from `A2uiSchemas.*(description: '...')`, use
`Schema.fromMap({...CommonSchemas.dynamicString.value, 'description': '...'})`.

### 3. Client functions

| genui                                                                                                                  | New                                                                                                                                                                                                                                                                                                                                                             | Notes                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientFunction { name, description, argumentSchema, returnType, Stream<Object?> execute(args, ExecutionContext) }`    | `abstract class FunctionImplementation extends FunctionApi` with constructor `({required String name, required Schema argumentSchema, A2uiReturnType returnType = any, String? description, AllowedCallers? allowedCallers, bool? requiresUserActivation})` and `Object? execute(Map<String, dynamic> args, DataContext context, [CancellationSignal? signal])` | `a2ui_core/lib/src/core/catalog.dart`. Return a value, a `Future` or a `ReadonlySignal`.                                                                                      |
| `SynchronousClientFunction.executeSync(args, ctx)`                                                                     | return the value from `execute`                                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                                               |
| `AsynchronousClientFunction.executeAsync(args, ctx)`                                                                   | return a `Future` from `execute`                                                                                                                                                                                                                                                                                                                                | Awaited only when the function runs from an action or an RPC. In a binding the `Future` itself becomes the value, so keep binding functions synchronous.                      |
| stream-returning `ClientFunction` (reactive)                                                                           | return `computed(() => ...)` (`ReadonlySignal`)                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                                               |
| `ClientFunctionReturnType {string, number, boolean, array, object, any, empty}`                                        | `A2uiReturnType {string, number, boolean, array, object, validationResult, any, void_}`                                                                                                                                                                                                                                                                         | `validationResult` is v1.0 only.                                                                                                                                              |
| `ExecutionContext.path`                                                                                                | `context.path` (`String`)                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                               |
| `ExecutionContext.getValue<T>(DataPath)`                                                                               | `context.dataModel.get(context.resolvePath(relativePath))`                                                                                                                                                                                                                                                                                                      |                                                                                                                                                                               |
| `ExecutionContext.update(DataPath, value)`                                                                             | `context.set(relativePath, value)`                                                                                                                                                                                                                                                                                                                              | Only call from a function that runs as an action; see behavior changes.                                                                                                       |
| `ExecutionContext.subscribe<T>`, `subscribeStream<T>`                                                                  | `context.dataModel.watch<T>(absPath)`, `context.resolveSignal(bindingJson)`                                                                                                                                                                                                                                                                                     | Signals instead of listenables and streams.                                                                                                                                   |
| `ExecutionContext.nested(DataPath)`, `resolvePath`                                                                     | `context.childContext(relativePath)`, `context.resolvePath(relativePath)`                                                                                                                                                                                                                                                                                       |                                                                                                                                                                               |
| `ExecutionContext.resolve(value)`                                                                                      | `context.resolveDynamicValue(value)` / `context.resolveSignal(value)`                                                                                                                                                                                                                                                                                           |                                                                                                                                                                               |
| `ExecutionContext.evaluateConditionStream(cond)`                                                                       | `coerceDynamicBoolean(context.resolveDynamicValue(cond))`                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                               |
| `ExecutionContext.getFunction(name)`                                                                                   | none; call through the expression system: `context.resolveDynamicValue({'call': name, 'args': {...}})`                                                                                                                                                                                                                                                          | `a2ui_core` also exports an unrelated `ExecutionContext({isUserActivated})` for RPC; do not confuse them.                                                                     |
| `Catalog(items, functions: [MyFn()])`                                                                                  | `CatalogImplementation(id:, components:, functions: [MyFn(), ...BasicCatalog.v0_9().functions.values])`                                                                                                                                                                                                                                                         |                                                                                                                                                                               |
| `BasicFunctions.all`                                                                                                   | `BasicCatalog.v0_9(locale:, openUrl:).functions.values` or `BasicCatalog.v1_0(...)`; `basicCatalog()` in `a2ui_flutter` bundles them                                                                                                                                                                                                                            | Same 14 names: `required`, `regex`, `length`, `numeric`, `email`, `formatString`, `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`, `openUrl`, `and`, `or`, `not`. |
| `RequiredFunction()`, `RegexFunction()`, `OpenUrlFunction()`, ... (public classes)                                     | `BasicCatalog.v0_9().functions['required']!` and so on                                                                                                                                                                                                                                                                                                          | No public per-function classes.                                                                                                                                               |
| `OpenUrlFunction` (launches through `url_launcher` itself)                                                             | `openUrl: (Uri url) => launchUrl(url)` passed to `basicCatalog()`                                                                                                                                                                                                                                                                                               | Throws `A2uiExpressionError` without a callback; only `http`, `https`, `mailto`, `tel`. The app owns the `url_launcher` dependency.                                           |
| `formatNumber(value, decimalPlaces, useGrouping)`, `formatCurrency(value, currencyCode)`, `formatDate(value, pattern)` | `formatNumber(value, decimals, grouping)`, `formatCurrency(value, currency, decimals, grouping)`, `formatDate(value, format)`                                                                                                                                                                                                                                   | Argument names changed; update prompts and fixtures.                                                                                                                          |
| (none)                                                                                                                 | `allowedCallers` (`AllowedCallers.rendererOnly`, `agentOnly`, `rendererOrAgent`), `requiresUserActivation`                                                                                                                                                                                                                                                      | Enforced locally on every version.                                                                                                                                            |
| (none)                                                                                                                 | `processor.callAgentFunction(surfaceId, FunctionCall(call:, args:), options: CallOptions(...))`                                                                                                                                                                                                                                                                 | v1.0 only; needs an `outboundListener`.                                                                                                                                       |

### 4. Data model, errors, logging, other re-exports

| genui                                                                                                                                                                                                          | New                                                                                                                                                                                        | Notes                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataModel` (interface), `InMemoryDataModel()`, `InMemoryDataModel.wrap`                                                                                                                                       | `DataModel([Object? initialData])` (concrete)                                                                                                                                              | `a2ui_core/lib/src/core/data_model.dart`. Surfaces own one at `surface.dataModel`.                                                                             |
| `DataPath('/a/b')`, `.segments`, `.join`, `.basename`, `.dirname`                                                                                                                                              | `String` JSON Pointer; `DataModel.resolvePath(path, basePath)`                                                                                                                             | No `DataPath` class.                                                                                                                                           |
| `dataModel.update(DataPath, value)`                                                                                                                                                                            | `dataModel.set(path, value)`                                                                                                                                                               | `set(path, null)` deletes; `set('/', map)` replaces the root.                                                                                                  |
| `dataModel.getValue<T>(DataPath)` (throws `DataModelTypeException`)                                                                                                                                            | `dataModel.get(path)` → `Object?`; `dataModel.has(path)`                                                                                                                                   | Cast yourself.                                                                                                                                                 |
| `dataModel.subscribe<T>(DataPath)` → `ValueNotifier<T?>`                                                                                                                                                       | `dataModel.watch<T>(path)` → `ReadonlySignal<T?>`; `dataModel.subscribe<T>(path, onChange)` → `DataSubscription<T>`                                                                        | `subscribe` does not fire for the current value. `effect`, `computed`, `signal` are re-exported from `preact_signals`.                                         |
| `dataModel.bindExternalState({path, source, twoWay})`                                                                                                                                                          | none                                                                                                                                                                                       | A listener on the source that calls `set`, and an `effect` on `watch` the other way.                                                                           |
| `A2uiValidationException(message, {surfaceId, path, json, cause})`                                                                                                                                             | `A2uiValidationError(message, {path, errors, cause, surfaceId})` (code `VALIDATION_FAILED`); subclasses `A2uiIntegrityError` (`INTEGRITY_ERROR`), `A2uiRecursionError` (`RECURSION_ERROR`) | Base class `A2uiError(message, {code, cause, surfaceId, functionCallId})`.                                                                                     |
| `A2uiFunctionException(message, {functionName, argumentKey})`                                                                                                                                                  | `A2uiExpressionError(message, {expression, details})` (`EXPRESSION_ERROR`); failures at run time arrive as `A2uiRendererError` with code `EXECUTION_ERROR`                                 |                                                                                                                                                                |
| `DataModelTypeException`                                                                                                                                                                                       | `A2uiDataError(message, {path})` (`DATA_ERROR`)                                                                                                                                            |                                                                                                                                                                |
| `CatalogItemNotFoundException`                                                                                                                                                                                 | `A2uiCatalogError(message, {catalogId})` (`CATALOG_ERROR`), `A2uiCatalogResolutionError(message, {catalogId, functionName})`                                                               |                                                                                                                                                                |
| parse failures in the transport                                                                                                                                                                                | `A2uiParseError(message, {rawContent})` (`PARSE_ERROR`)                                                                                                                                    |                                                                                                                                                                |
| (none)                                                                                                                                                                                                         | `A2uiStateError` (`STATE_ERROR`), `A2uiRpcError(message, RpcErrorCode rpcCode)`                                                                                                            | `RpcErrorCode`: `invalidFunctionCall`, `executionError`, `unknownFunction`, `unknownError`, `timeout`, `cancelled`, `disposed`, `duplicate`, `noListener`.     |
| `ValidationError`, `ValidationHelper`                                                                                                                                                                          | `ValidationResult({valid, message, code, severity})`, `coerceDynamicBoolean`                                                                                                               |                                                                                                                                                                |
| `CancellationSignal`, `CancellationException`                                                                                                                                                                  | same names                                                                                                                                                                                 | `throwIfCancelled()` added.                                                                                                                                    |
| `genUiLogger` (`Logger('GenUI')`), `configureLogging(...)`                                                                                                                                                     | none                                                                                                                                                                                       | `a2ui_core` logs under `a2ui_core.*` and `a2ui.*` through `package:logging`; attach a `Logger.root.onRecord` listener. Use your own `Logger` for app messages. |
| `JsonBlockParser.parseFirstJsonBlock`, `parseJsonBlocks`, `stripJsonBlock` (`package:genui/parsing.dart`)                                                                                                      | `package:a2ui_agent`: `Parser` (`DirectJsonParser`, `ExpressParser`) with `unwrap`, `compile`, `parseResponse`; `ResponseStream`                                                           | `a2ui_agent` also defines a `TextPart`; alias the import if `genai_primitives` is also imported.                                                               |
| `DebugCatalogView`                                                                                                                                                                                             | none                                                                                                                                                                                       | `dart/a2ui_flutter/a2ui_explorer` is the gallery app; render examples with `A2uiSurface` in a test or dev screen.                                              |
| `package:genui/test.dart` (`validateCatalogItemExamples`, `createSchemaRegistryWithCommonTypes`)                                                                                                               | none                                                                                                                                                                                       | Use `MessageProcessor(validationConfig: ValidationConfig.strict)` and feed example payloads in a test; see recipe (m).                                         |
| `export 'package:genai_primitives/...'` (`ChatMessage`, `ChatMessageRole`, `TextPart`, `DataPart`, `StandardPart`), `UiPart`, `UiInteractionPart`, `UiPartConstants`, `UiPartExtension`, `UiPartListExtension` | not re-exported                                                                                                                                                                            | Depend on `genai_primitives` directly to keep the chat types, or replace them with `ActionMessage` / `ErrorMessage` JSON and an app-defined envelope.          |
| `export 'package:preact_signals/...'`                                                                                                                                                                          | still available through `a2ui_core` (`signal`, `computed`, `effect`, `batch`, `Signal`, `ReadonlySignal`)                                                                                  |                                                                                                                                                                |
| hand-written data classes over `CatalogItemContext.data`                                                                                                                                                       | `dart/a2ui_cli` code generation (`a2ui codegen -c catalog.json -o out_dir/`)                                                                                                               | Optional; useful when the app also authors payloads.                                                                                                           |

## Recipes

Each recipe shows the genui code and
its replacement. The "after" code targets the v0.9 wire unless the recipe
says otherwise; the v1.0 differences are called out where they exist.
Full working apps: `dart/a2ui_flutter/example_v0_9` (v0.9) and
`dart/a2ui_flutter/example` (v1.0).

Imports used by the "after" snippets:

```dart
import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9;
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart' hide ValidationResult;
```

### Renderer wiring

#### (a) Create the processor and feed it messages

Before:

```dart
final controller = SurfaceController(catalogs: [myCatalog]);

// From a parsed map:
controller.handleMessage(A2uiMessage.fromJson(map));
// From streamed text, through the transport adapter:
final transport = A2uiTransportAdapter();
transport.incomingMessages.listen(controller.handleMessage);
transport.addChunk(chunk);
```

After:

```dart
final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [myCatalog],
  defaultVersion: A2uiProtocolVersion.v0_9,
  validationConfig: ValidationConfig.relaxed, // what a streamed surface needs
);

void onAgentJson(Object? json) {
  try {
    processor.processMessages(json); // a map, a list of maps, or {"messages": [...]}
  } on A2uiError catch (error) {
    // Not reported for you: send an ErrorMessage, see recipe (e).
    reportToAgent(error, json);
  }
}

onAgentJson(jsonDecode(body));
```

`A2uiError implements Exception`, so place `on A2uiError` _before_ any general `on Exception` clause (otherwise the analyzer reports `#dead_code_on_catch_subtype`). An app that called `transport.addChunk` once per decoded item keeps the same failure granularity by calling `processMessages(item)` in a loop instead of passing the whole batch (a batch stops at the first failing message). `defaultVersion` does not fill in a missing `"version"`; every envelope must
carry one (`"v0.9"`, `"v0.9.1"` or `"1.0"`). There is no text parser in
`a2ui_core`: an app that extracted JSON from model text with
`A2uiTransportAdapter` moves to `a2ui_agent`, recipe (f).

#### (b) Track surfaces and render them

Before:

```dart
controller.surfaceUpdates.listen((update) {
  switch (update) {
    case SurfaceAdded(:final surfaceId):
      setState(() => _ids.add(surfaceId));
    case SurfaceRemoved(:final surfaceId):
      setState(() => _ids.remove(surfaceId));
    case ComponentsUpdated():
      setState(() {});
  }
});

// build:
for (final id in _ids)
  Surface(
    surfaceContext: controller.contextFor(id),
    defaultBuilder: (_) => const CircularProgressIndicator(),
  )
```

After:

```dart
final surfaces = ValueNotifier<List<SurfaceModel<ComponentImplementation>>>(const []);

final Subscription created = processor.model.onSurfaceCreated.subscribe((surface) {
  surfaces.value = [...surfaces.value, surface];
});
final Subscription deleted = processor.model.onSurfaceDeleted.subscribe((id) {
  surfaces.value = [for (final s in surfaces.value) if (s.id != id) s];
});

// build, under a MaterialApp and inside a Material such as a Scaffold body:
ValueListenableBuilder(
  valueListenable: surfaces,
  builder: (context, surfaces, _) => Column(
    children: [
      for (final surface in surfaces)
        v0_9.A2uiMarkdown( // only if the app showed Markdown in Text
          builder: (context, markdown, style) => MarkdownBody(data: markdown),
          child: A2uiSurface(key: ObjectKey(surface), surface: surface),
        ),
    ],
  ),
)
```

There is no update event; `A2uiSurface` rerenders when the surface changes.
Nothing is drawn until the root component arrives; wrap the widget if a
placeholder is wanted. `processor.model.getSurface(id)` looks a surface up
by id.

#### (c) Send actions to the agent

Before:

```dart
controller.onSubmit.listen((ChatMessage message) {
  // message.parts holds a UiInteractionPart whose `interaction` is
  // {"version":"v0.9","action":{"surfaceId":...,"name":...,"sourceComponentId":...,"timestamp":...,"context":{...}}}
  transport.sendRequest(message);
});

class MyDelegate implements ActionDelegate {
  @override
  bool handleEvent(BuildContext context, UiEvent event, SurfaceContext surface, buildWidget) {
    if (event is UserActionEvent && event.name == 'openDetails') {
      showDetails(event.context);
      return true; // handled locally
    }
    return false; // forward to the agent
  }
}
```

After:

```dart
final String version = A2uiProtocolVersion.v0_9.jsonValue;

final Subscription actions = processor.model.onAction.subscribe((A2uiRendererAction action) {
  if (action.name == 'openDetails') {
    showDetails(action.context); // handled locally, nothing sent
    return;
  }
  final Map<String, dynamic> envelope = ActionMessage(version: version, action: action).toJson();
  // {"version":"v0.9","action":{"name":...,"surfaceId":...,"sourceComponentId":...,
  //   "timestamp":"2025-01-01T00:00:00.000Z","context":{...}}}
  sendToBackend(envelope);
});
```

The inner JSON matches what genui put in `UiInteractionPart.interaction`,
so a backend that reads that string keeps working if the app keeps its outer
framing (for example a `DataPart` with the old MIME type). The batch form
`RendererToAgentMessagePayload.of(message).toJson()` gives
`{"messages": [envelope]}`. On v1.0 use `surface.protocolVersion` as the
version so mixed surfaces answer in their own version.

#### (d) Capabilities and data model in request metadata

Before:

```dart
final Map<String, Object?> capabilities = controller.clientCapabilities.toJson();
// {"v0.9":{"supportedCatalogIds":[...]}}
```

After:

```dart
final Map<String, Object?> capabilities = processor
    .getRendererCapabilities(const CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9]))
    .toJson(); // same shape; send as "a2uiClientCapabilities"

final Map<String, Object?>? dataModel =
    processor.getRendererDataModel(version: A2uiProtocolVersion.v0_9);
// null until a surface with sendDataModel is created; send as "a2uiClientDataModel"
```

On v1.0 the keys are `a2uiRendererCapabilities` and
`a2uiRendererDataModel`, with `versions: [A2uiProtocolVersion.v1_0]`.

#### (e) Report errors to the agent

Before:

```dart
// genui reported everything through onSubmit as
// {"version":"v0.9","error":{"code":"VALIDATION_FAILED"|"INTERNAL_ERROR","surfaceId"?,"path"?,"message"}}
controller.reportError(error, stackTrace);
```

After, two channels:

```dart
// 1. Errors met while rendering or binding a surface.
processor.model.onSurfaceCreated.subscribe((surface) {
  surface.onError.subscribe((A2uiRendererError error) {
    sendToBackend(ErrorMessage(version: version, error: error).toJson());
    // {"version":"v0.9","error":{"code":...,"surfaceId":...,"message":...,"path"?:...}}
  });
});

// 2. Errors thrown by processMessages for a bad message.
A2uiRendererError rendererErrorFor(Object error, String? surfaceId) {
  final A2uiError a2ui = error is A2uiError ? error : A2uiError('$error');
  final String? path = a2ui is A2uiValidationError ? a2ui.path : null;
  // A2uiRendererError rejects VALIDATION_FAILED without a path and a surfaceId.
  final bool downgrade = a2ui.code == A2uiRendererError.validationFailedCode &&
      (path == null || path.isEmpty || surfaceId == null);
  return A2uiRendererError(
    code: downgrade ? 'UNKNOWN_ERROR' : a2ui.code,
    surfaceId: surfaceId,
    message: a2ui.message,
    path: downgrade ? null : path,
  );
}
```

Releases of `a2ui_core` that have `processMessagesWithErrors` return the
`ErrorMessage`s for a batch instead of throwing, and also emit each thrown
error on `surface.onError` or `processor.model.onError` before rethrowing
from `processMessages`; check the `CHANGELOG.md` of the release in use so an
error is not sent twice.

#### (f) Replace `A2uiTransportAdapter` and `Conversation`

Case 1, the backend returns A2UI JSON (A2A, HTTP, WebSocket):

```dart
// Before: transport.addChunk(responseBody); conversation.sendRequest(ChatMessage.user(text));
// After:
final response = await http.post(uri, body: jsonEncode({
  'text': text,
  'metadata': {
    'a2uiClientCapabilities': capabilities,
    if (dataModel != null) 'a2uiClientDataModel': dataModel,
  },
}));
onAgentJson(jsonDecode(response.body)); // recipe (a)
```

Case 2, the app prompts a model and parses its streamed text:

```dart
import 'package:a2ui_agent/a2ui_agent.dart';

final A2uiRequestProcessor agent = A2uiGenerator(
  catalogs: [CatalogConfig(myCatalog)],
  inferenceFormatFactory: const DirectJsonFormatFactory(progressiveKeys: {'text', 'label'}),
).createProcessor(
  A2uiRendererCapabilities.forCatalogIds([myCatalog.id], version: A2uiProtocolVersion.v0_9),
);
final String systemPrompt = '$appInstructions\n${agent.promptSnippet}';
final RendererState state = agent.createState(); // the agent's mirror of the renderer

final ResponseStream stream = agent.openStream(state: state);
void read(List<ResponsePart> parts) {
  for (final ResponsePart part in parts) {
    switch (part) {
      case TextPart(:final text):
        showText(text);
      case A2uiPart(:final a2ui):
        processor.processMessages(AgentToRendererMessagePayload(a2ui));
    }
  }
}
try {
  await for (final String chunk in modelChunks) {
    read(stream.feed(chunk));
  }
  read(stream.close()); // text held back until the end
} on A2uiError catch (error) {
  // the stream has ended; error.partialResults may hold parts to show
}
```

`RendererState.of(processor)` is the alternative for an app that is both
agent and renderer: that state applies each accepted message to the
processor itself, so the `A2uiPart` branch does nothing and the processor
must receive no messages from anywhere else.
`dart/a2ui_flutter/example_v0_9/lib/chat_session.dart` is a complete
`ChangeNotifier` that replaces `Conversation` for this case.

### Catalogs and components

#### (g) Display component

Before:

```dart
final greeting = CatalogItem(
  name: 'Greeting',
  dataSchema: S.object(
    properties: {
      'title': A2uiSchemas.stringReference(description: 'Heading'),
      'subtitle': A2uiSchemas.stringReference(),
    },
    required: ['title'],
  ),
  widgetBuilder: (itemContext) {
    final data = itemContext.data as JsonMap;
    return BoundString(
      dataContext: itemContext.dataContext,
      value: data['title'],
      builder: (context, title) => BoundString(
        dataContext: itemContext.dataContext,
        value: data['subtitle'],
        builder: (context, subtitle) => Column(children: [
          Text(title ?? '', style: Theme.of(context).textTheme.titleLarge),
          if (subtitle != null) Text(subtitle),
        ]),
      ),
    );
  },
);
```

After:

```dart
final greeting = ComponentImplementation(
  name: 'Greeting',
  schema: Schema.object(
    properties: {
      'title': CommonSchemas.dynamicString,    // v1.0: CommonSchemasV1.dynamicString
      'subtitle': CommonSchemas.dynamicString,
    },
    required: ['title'],
  ),
  builder: (context, node, props, buildChild) {
    final String? subtitle = props.string('subtitle');
    return Column(children: [
      Text(props.string('title') ?? '', style: Theme.of(context).textTheme.titleLarge),
      if (subtitle != null) Text(subtitle),
    ]);
  },
);
```

The builder reruns whenever a bound property changes; no listener code is
needed.

#### (h) Input component: write-back, action, validation

Before:

```dart
final rating = CatalogItem(
  name: 'Rating',
  isImplicitlyFlexible: true,
  dataSchema: S.object(properties: {
    'label': A2uiSchemas.stringReference(),
    'value': A2uiSchemas.numberReference(),
    'checks': A2uiSchemas.checkable(),
    'onChanged': A2uiSchemas.action(),
  }, required: ['value']),
  widgetBuilder: (itemContext) {
    final data = itemContext.data as JsonMap;
    final valueRef = data['value'];
    final path = valueRef is Map && valueRef.containsKey('path')
        ? valueRef['path'] as String
        : '${itemContext.id}.value';
    return BoundNumber(
      dataContext: itemContext.dataContext,
      value: {'path': path},
      builder: (context, current) => StreamBuilder<String?>(
        stream: ValidationHelper.validateStream(
            (data['checks'] as List?)?.cast<JsonMap>(), itemContext.dataContext),
        builder: (context, snapshot) => Stars(
          value: current ?? 0,
          error: snapshot.data,
          onChanged: (stars) async {
            itemContext.dataContext.update(DataPath(path), stars);
            final event = (data['onChanged'] as JsonMap?)?['event'] as JsonMap?;
            if (event == null) return;
            final resolved = await resolveContext(itemContext.dataContext, event['context'] as JsonMap?);
            itemContext.dispatchEvent(UserActionEvent(
              name: event['name'] as String,
              sourceComponentId: itemContext.id,
              context: resolved,
            ));
          },
        ),
      ),
    );
  },
);
```

After:

```dart
final rating = ComponentImplementation(
  name: 'Rating',
  schema: Schema.object(
    properties: {
      'label': CommonSchemas.dynamicString,
      'value': CommonSchemas.dynamicNumber,
      'checks': Schema.list(items: CommonSchemas.checkRule), // feeds props.isValid
      'onChanged': CommonSchemas.action, // v1.0: Schema.fromMap({r'$ref': r'common_types.json#/$defs/Action'})
    },
    required: ['value'],
  ),
  builder: (context, node, props, buildChild) {
    final WritableBinding<Object?>? value = props.writable('value'); // null for a literal
    return LimitedBox( // replaces isImplicitlyFlexible: take a bound yourself
      maxWidth: 400,
      child: Stars(
        label: props.string('label') ?? '',
        value: props.number('value') ?? 0,
        error: props.isValid ? null : props.validationErrors.firstOrNull,
        onChanged: value == null
            ? null
            : (stars) {
                try {
                  value.set(stars);
                } on A2uiDataError catch (error) {
                  final surface = A2uiSurface.of(context);
                  unawaited(surface.dispatchError(A2uiRendererError(
                    code: error.code,
                    surfaceId: surface.id,
                    message: error.message,
                    path: error.path,
                  )));
                  return;
                }
                unawaited(props.action('onChanged')?.call()); // synchronously, in the handler
              },
      ),
    );
  },
);
```

An input whose `value` is a literal has nowhere to write; keep the edit in
local widget state, as the basic `TextField` does. An action that is not in
the schema can be sent with
`node.context!.dispatchAction({'event': {'name': 'rated', 'context': {'stars': stars}}})`,
but declaring it is better because the agent then sees it in the catalog.

#### (i) Container component with children

Before:

```dart
final panel = CatalogItem(
  name: 'Panel',
  dataSchema: S.object(properties: {
    'header': A2uiSchemas.componentReference(),
    'children': A2uiSchemas.componentArrayReference(),
  }, required: ['children']),
  widgetBuilder: (itemContext) {
    final data = itemContext.data as JsonMap;
    return Column(children: [
      itemContext.buildChild(data['header'] as String),
      ComponentChildrenBuilder(
        childrenData: data['children'],
        dataContext: itemContext.dataContext,
        buildChild: itemContext.buildChild,
        getComponent: itemContext.getComponent,
        explicitListBuilder: (ids, buildChild, getComponent, dataContext) => Column(children: [
          for (final id in ids)
            buildWeightedChild(
              componentId: id,
              dataContext: dataContext,
              buildChild: buildChild,
              weight: getComponent(id)?.properties['weight'] as int?,
              key: ValueKey(id),
            ),
        ]),
        templateListWidgetBuilder: (context, data, componentId, path) =>
            itemContext.buildChild(componentId, itemContext.dataContext.nested(DataPath(path))),
      ),
    ]);
  },
);
```

After:

```dart
final panel = ComponentImplementation(
  name: 'Panel',
  schema: Schema.object(
    properties: {
      // Child references must be top-level properties of the common types.
      'header': CommonSchemas.componentId, // v1.0: Schema.fromMap({r'$ref': r'common_types.json#/$defs/Child'})
      'children': CommonSchemas.childList, // v1.0: Schema.fromMap({r'$ref': r'common_types.json#/$defs/ChildList'})
    },
    required: ['children'],
  ),
  builder: (context, node, props, buildChild) {
    final header = props.child('header');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (header != null) buildChild(header),
        for (final child in props.children('children'))
          KeyedSubtree( // outermost key keeps the child's State across reorders
            key: NodeKey(child.instanceId),
            child: Padding(padding: const EdgeInsets.all(8), child: buildChild(child)),
          ),
      ],
    );
  },
);
```

Template children (`{"componentId": ..., "path": "/items"}`) arrive already
expanded, one node per item with its own data scope. `buildChild(child)` is
already keyed; the `KeyedSubtree` is needed only when the child is wrapped.
A child's weight is `ComponentProps(child.props.peek()).number('weight')`.

#### (j) Custom catalogs

v0.9, on top of the basic components, with an alias id:

```dart
// Before:
final myCatalog = BasicCatalogItems.asCatalog().copyWith(
  newItems: [rating, panel, myText], // myText replaced 'Text' by name
  catalogId: 'https://example.com/catalog.json',
  catalogIdAliases: ['https://example.com/legacy.json'],
);
final controller = SurfaceController(catalogs: [myCatalog]);

// After:
List<ComponentImplementation> myComponents() => [
  ...v0_9.BasicComponents.all.where((c) => c.name != 'Text'), // duplicates throw
  myText,
  rating,
  panel,
];

CatalogImplementation myCatalog(String id) => CatalogImplementation(
  id: id,
  components: myComponents(),
  functions: BasicCatalog.v0_9().functions.values.toList(), // a v0.9 surface has one catalog
  themeSchema: v0_9.BasicComponents.api.themeSchema,
  definitions: v0_9.BasicComponents.api.definitions,
  instructions: v0_9.BasicComponents.api.instructions,
);

final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [
    myCatalog('https://example.com/catalog.json'),
    myCatalog('https://example.com/legacy.json'), // the alias
    v0_9.basicCatalog(openUrl: launchUrl),        // if the agent also sends the basic id
  ],
);
```

v1.0, where a surface draws on several catalogs:

```dart
import 'package:a2ui_flutter/basic_catalog.dart';

final myCatalogV1 = CatalogImplementation(
  id: 'https://example.com/catalog.json',
  protocolVersion: A2uiProtocolVersion.v1_0, // required for v1.0 common types
  components: [ratingV1, panelV1],           // only your own components
);

final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [basicCatalog(openUrl: launchUrl), myCatalogV1],
);
// The agent names it per component: {"id": "r", "component": "Rating", "catalogId": "https://example.com/catalog.json"}
```

Builders are version-independent; only the schemas differ.

### Functions, data model, tests

#### (k) Client functions

A function that returns a value:

```dart
// Before:
class AddTaxFunction extends SynchronousClientFunction {
  const AddTaxFunction();
  @override String get name => 'addTax';
  @override String get description => 'Adds tax to a price.';
  @override ClientFunctionReturnType get returnType => ClientFunctionReturnType.number;
  @override Schema get argumentSchema =>
      S.object(properties: {'price': S.number(), 'rate': S.number()}, required: ['price', 'rate']);
  @override
  Object? executeSync(JsonMap args, ExecutionContext context) =>
      (args['price'] as num) * (1 + (args['rate'] as num));
}
final catalog = Catalog([...items], functions: [...BasicFunctions.all, const AddTaxFunction()]);

// After:
class AddTaxFunction extends FunctionImplementation {
  AddTaxFunction()
      : super(
          name: 'addTax',
          description: 'Adds tax to a price.',
          returnType: A2uiReturnType.number,
          argumentSchema: Schema.object(
            properties: {'price': Schema.number(), 'rate': Schema.number()},
            required: ['price', 'rate'],
          ),
        );

  @override
  Object? execute(Map<String, dynamic> args, DataContext context, [CancellationSignal? signal]) =>
      (args['price'] as num) * (1 + (args['rate'] as num)); // args are resolved and schema-checked
}

final catalog = CatalogImplementation(
  id: myId,
  components: myComponents(),
  functions: [...BasicCatalog.v0_9().functions.values, AddTaxFunction()],
  themeSchema: v0_9.BasicComponents.api.themeSchema,
  definitions: v0_9.BasicComponents.api.definitions,
);
```

A function with a side effect, such as genui's `setValue` or `navigate`
pattern:

```dart
// Before:
class SelectTabFunction extends SynchronousClientFunction {
  // ...
  @override
  Object? executeSync(JsonMap args, ExecutionContext context) {
    context.update(DataPath('/ui/selectedTab'), args['tab']);
    navigatorKey.currentState?.pushNamed('/tab/${args['tab']}');
    return null;
  }
}

// After: only from an action, never from a binding.
class SelectTabFunction extends FunctionImplementation {
  SelectTabFunction()
      : super(
          name: 'selectTab',
          returnType: A2uiReturnType.void_,
          argumentSchema: Schema.object(properties: {'tab': Schema.string()}, required: ['tab']),
          requiresUserActivation: true,
        );

  @override
  Future<Object?> execute(Map<String, dynamic> args, DataContext context, [CancellationSignal? signal]) async {
    context.set('/ui/selectedTab', args['tab']);
    await navigatorKey.currentState?.pushNamed('/tab/${args['tab']}');
    return null;
  }
}
// Agent invokes it as a Button action: {"functionCall": {"call": "selectTab", "args": {"tab": "x"}}} on v0.9,
// {"@call": "selectTab", "args": {"tab": "x"}} on v1.0.
```

Most side effects need no function at all: the app handles the action in
its `onAction` listener (recipe (c)), and inputs write their own value
through `props.writable`.

#### (l) Read and write a surface's data model from app code

```dart
// Before:
final DataModel model = controller.contextFor('main').dataModel;
final String? name = model.getValue<String>(DataPath('/user/name'));
model.update(DataPath('/user/name'), 'Ada');
final ValueNotifier<int?> count = model.subscribe<int>(DataPath('/count'));

// After:
final DataModel model = processor.model.getSurface('main')!.dataModel;
final String? name = model.get('/user/name') as String?;
model.set('/user/name', 'Ada');            // set(path, null) deletes
final ReadonlySignal<int?> count = model.watch<int>('/count');
final void Function() stop = effect(() => print(count.value));
final Object? everything = model.get('/'); // whole tree, live object
```

#### (m) Widget test for a custom component

Before:

```dart
testWidgets('Rating writes back and dispatches', (tester) async {
  final controller = SurfaceController(
    catalogs: [Catalog([rating, BasicCatalogItems.column], catalogId: 'test')],
  );
  ChatMessage? sent;
  controller.onSubmit.listen((message) => sent = message);
  controller.handleMessage(A2uiMessage.fromJson({
    'version': 'v0.9',
    'createSurface': {'surfaceId': 's', 'catalogId': 'test'},
  }));
  controller.handleMessage(A2uiMessage.fromJson({
    'version': 'v0.9',
    'updateComponents': {'surfaceId': 's', 'components': [
      {'id': 'root', 'component': 'Rating', 'value': {'path': '/stars'}, 'onChanged': {'event': {'name': 'rated'}}},
    ]},
  }));
  await tester.pumpWidget(MaterialApp(home: Scaffold(
    body: Surface(surfaceContext: controller.contextFor('s')),
  )));
  await tester.tap(find.byTooltip('4'));
  await tester.pump();
  expect(controller.contextFor('s').dataModel.getValue<num>(DataPath('/stars')), 4);
  expect(sent, isNotNull);
});
```

After, with a small harness the test file owns (the package's own
`test/support/surface_harness.dart` is not published):

```dart
import 'package:flutter_test/flutter_test.dart';

const String _catalogId = 'https://example.com/test/catalog.json';

CatalogImplementation _catalog() => CatalogImplementation(
  id: _catalogId,
  components: [v0_9.BasicComponents.column, v0_9.BasicComponents.text, rating],
  functions: BasicCatalog.v0_9().functions.values.toList(),
  themeSchema: v0_9.BasicComponents.api.themeSchema,
  definitions: v0_9.BasicComponents.api.definitions,
);

typedef Harness = ({
  MessageProcessor<ComponentImplementation> processor,
  List<A2uiRendererAction> actions,
  List<A2uiRendererError> errors,
});

Future<Harness> pumpA2ui(
  WidgetTester tester,
  List<Map<String, Object?>> messages, {
  String surfaceId = 'main',
}) async {
  final processor = MessageProcessor<ComponentImplementation>(
    catalogs: [_catalog()],
    validationConfig: ValidationConfig.strict, // surfaces schema mistakes in the component
  );
  addTearDown(processor.dispose);
  final actions = <A2uiRendererAction>[];
  final errors = <A2uiRendererError>[];
  processor.model.onAction.subscribe(actions.add);
  processor.model.onSurfaceCreated.subscribe((surface) => surface.onError.subscribe(errors.add));
  processor.processMessages([
    {'version': 'v0.9', 'createSurface': {'surfaceId': surfaceId, 'catalogId': _catalogId}},
    ...messages,
  ]);
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView( // unbounded height, like a chat host
        child: A2uiSurface(surface: processor.model.getSurface(surfaceId)!),
      ),
    ),
  ));
  return (processor: processor, actions: actions, errors: errors);
}

void main() {
  testWidgets('Rating writes back and dispatches', (tester) async {
    final harness = await pumpA2ui(tester, [
      {'version': 'v0.9', 'updateDataModel': {'surfaceId': 'main', 'path': '/', 'value': {'stars': 2}}},
      {'version': 'v0.9', 'updateComponents': {'surfaceId': 'main', 'components': [
        {
          'id': 'root',
          'component': 'Rating',
          'label': 'Stars',
          'value': {'path': '/stars'},
          'onChanged': {'event': {'name': 'rated', 'context': {'stars': {'path': '/stars'}}}},
        },
      ]}},
    ]);

    expect(find.byIcon(Icons.star), findsNWidgets(2));
    await tester.tap(find.byTooltip('4'));
    await tester.pump();

    expect(harness.processor.model.getSurface('main')!.dataModel.get('/stars'), 4);
    expect(harness.actions.single.name, 'rated');
    expect(harness.actions.single.context, {'stars': 4});
    expect(harness.errors, isEmpty);
  });
}
```

For v1.0 tests send `'version': '1.0'` envelopes, create the surface with
`catalogId: BasicCatalog.v1_0Id` or inline `components`, and give each custom
component its `catalogId`.

If a unit test must invoke `ComponentImplementation.builder` directly inside a
`Builder` without mounting `A2uiSurface` (for example, to test catalog
registration or feature-flag gating in isolation), resolve a `ComponentNode`
through `SurfaceModel` and `NodeResolver`:

```dart
final surface = SurfaceModel<ComponentImplementation>(
  's1',
  defaultCatalog: myCatalog,
  rootId: 'root',
);
surface.componentsModel.addComponent(ComponentModel('root', 'Rating', data));
final node = NodeResolver<ComponentImplementation>(surface).rootNode.peek()!;
final widget = myCatalog.components['Rating']!.builder(
  context,
  node,
  ComponentProps(node.props.peek()),
  (_) => const SizedBox.shrink(),
);
```

#### (n) Dispose

```dart
// Before:
conversation.dispose();
transport.dispose();
controller.dispose();

// After:
created.unsubscribe();
deleted.unsubscribe();
actions.unsubscribe();
processor.dispose(); // fires onSurfaceDeleted for each surface
```

## Behavior changes

Each row names what `genui`'s
`SurfaceController` and `Surface` did, what `a2ui_core`'s `MessageProcessor`
and `a2ui_flutter`'s `A2uiSurface` do instead, and what the app has to do
about it. Check every row against the app during step 2 and step 3 of the
guide.

### Message processing

| Topic                                             | genui                                                                                                                                                                  | a2ui_core                                                                                                                                                                                                                                                                                                                                                                                                                                                                | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing or unknown `catalogId` on `createSurface` | Registered an empty stub catalog and created the surface; `Surface` then showed `FallbackWidget`.                                                                      | On v0.9, a missing `catalogId` throws `A2uiValidationError` in `AgentToRendererMessage.fromJson` and an unknown `catalogId` throws `A2uiCatalogError` (code `CATALOG_ERROR`); in both cases the surface is not created. `processor.catalogs` cannot be extended afterwards.                                                                                                                                                                                              | Register every id the agent may send, including aliases and the legacy basic catalog id. Catch the error and send an `ErrorMessage`.                                                                                                                                                                                                                                                                                                                                                                                              |
| Catalog version mismatch                          | n/a                                                                                                                                                                    | A catalog with `protocolVersion: v1_0` rejects a v0.9 `createSurface`, and a catalog with no `protocolVersion` rejects a v1.0 one (`A2uiCatalogError`).                                                                                                                                                                                                                                                                                                                  | Register a catalog per protocol version the agent uses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Update before create                              | Buffered `updateComponents` / `updateDataModel` for an unknown surface and replayed them when the surface appeared (dropped after `pendingUpdateTimeout`).             | Throws `A2uiIntegrityError` (code `INTEGRITY_ERROR`); the message is dropped and the rest of that `processMessages` batch is not applied.                                                                                                                                                                                                                                                                                                                                | If the backend can reorder messages, buffer in the app keyed by surface id and replay on `onSurfaceCreated`, or process messages one at a time so one failure does not stop the others.                                                                                                                                                                                                                                                                                                                                           |
| `deleteSurface` for an unknown id                 | Error reported.                                                                                                                                                        | Silent no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `version` field                                   | Required and had to be exactly `"v0.9"`.                                                                                                                               | Required on every envelope; accepted values are `"v0.9"`, `"v0.9.1"` and `"1.0"`. `defaultVersion` does not fill a missing one. An envelope with a key other than `version` and one message body is rejected.                                                                                                                                                                                                                                                            | Nothing for well-formed traffic. An app that added `"version"` itself keeps doing so.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Empty `surfaceId`                                 | Rejected with `VALIDATION_FAILED`.                                                                                                                                     | Not rejected; a surface with id `""` is created.                                                                                                                                                                                                                                                                                                                                                                                                                         | Validate in the app if it mattered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Validation of components                          | Asynchronous JSON Schema validation after each `updateComponents`; failures reported but the update stayed applied. Unknown component types rendered `FallbackWidget`. | Synchronous, before the update is applied: duplicate ids and each component's schema are always checked; a failing message leaves the surface unchanged. With no `validationConfig`, unknown types are accepted. `ValidationConfig.strict` also requires a root, resolvable references and reachability after every batch, which a surface streamed over several messages fails. `ValidationConfig.relaxed` keeps the schema, duplicate id, cycle and depth checks only. | Use `ValidationConfig.relaxed` in the app (`allowUnknownElements: true` lets unknown component types become placeholder nodes instead of rejecting `updateComponents`) and `ValidationConfig.strict` in tests of your own components. Note that `Catalog.validationSchema` closes every component's `schema` with `unevaluatedProperties: false` unless `unevaluatedProperties` or `additionalProperties` is set, so every property the builder reads or the agent sends (even optional) must be declared in `schema.properties`. |
| Theme                                             | Stored and applied.                                                                                                                                                    | On v0.9 the `theme` of `createSurface` is validated against the catalog's `themeSchema` and an invalid theme rejects the message. v1.0 has no theme.                                                                                                                                                                                                                                                                                                                     | Pass `themeSchema` from `v0_9.BasicComponents.api` to a v0.9 catalog that the agent themes.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Multiple protocol versions                        | v0.9 only.                                                                                                                                                             | One processor routes each envelope by its `version`. Replies follow `surface.protocolVersion`.                                                                                                                                                                                                                                                                                                                                                                           | Use `surface.protocolVersion` as the version of `ActionMessage` and `ErrorMessage` when both versions are live.                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Actions and errors

| Topic                     | genui                                                                                                                       | a2ui_core                                                                                                                                                                                                                                                                                                                                                                                                         | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where actions arrive      | `onSubmit`, as a `ChatMessage` with a `UiInteractionPart` holding `{"version":"v0.9","action":{...}}`.                      | `processor.model.onAction` (and `surface.onAction`) as `A2uiRendererAction`. `ActionMessage(version:, action:).toJson()` gives the same inner JSON, with a UTC `timestamp` and optional `userMessage`, `catalogId`, `metadata`.                                                                                                                                                                                   | Subscribe, build the envelope, send it with the framing the backend expects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Local handling of actions | `ActionDelegate.handleEvent` returned `true` to swallow an event.                                                           | No delegate; nothing is sent unless the app sends it.                                                                                                                                                                                                                                                                                                                                                             | Branch on `action.name` (and `action.surfaceId` for per-surface policies such as suppressing events from inactive turns or overlays) in the listener. No `BuildContext` is passed; capture what the handler needs.                                                                                                                                                                                                                                                                                                                                   |
| Malformed actions         | Non-action `UiEvent`s were dropped.                                                                                         | A `functionCall` action or a missing `name` dispatched through `surface.dispatchAction` is reported as an `INVALID_ACTION` error, not an action.                                                                                                                                                                                                                                                                  | Nothing for components written against `props.action`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Where errors arrive       | `onSubmit`, with codes `VALIDATION_FAILED`, `INTERNAL_ERROR` or `FUNCTION_EXECUTION_FAILED` and an optional `functionName`. | `surface.onError` (in a microtask after the failure; listeners may call `setState`) for errors met while rendering; `processMessages` throws `A2uiError` for a bad message. Codes are `A2uiError.code` values: `VALIDATION_FAILED`, `INTEGRITY_ERROR`, `RECURSION_ERROR`, `DATA_ERROR`, `STATE_ERROR`, `CATALOG_ERROR`, `EXPRESSION_ERROR`, `EXECUTION_ERROR`, `PARSE_ERROR`, `UNKNOWN_ERROR`. No `functionName`. | Handle both channels (recipe (e)). Note that component JSON Schema validation (which `genui` ran asynchronously after `handleMessage` and emitted on `onSubmit`) now runs synchronously inside `processMessages` and throws `A2uiValidationError` (`VALIDATION_FAILED`), so wire both the `try`/`on A2uiError` block around `processMessages` and `surface.onError` to your error reporter. Releases with `processMessagesWithErrors` also emit thrown errors on `onError`; check the changelog of the release in use so an error is not sent twice. |
| `A2uiRendererError` shape | Any fields.                                                                                                                 | The constructor throws for code `VALIDATION_FAILED` without a non-empty `path` and a `surfaceId`, or with `details`.                                                                                                                                                                                                                                                                                              | Downgrade a path-less validation failure to `UNKNOWN_ERROR` before sending it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Error from a function     | `A2uiFunctionException` → `FUNCTION_EXECUTION_FAILED`.                                                                      | `A2uiExpressionError` for bad arguments; a function that throws at run time is reported as `EXECUTION_ERROR` on `surface.onError`.                                                                                                                                                                                                                                                                                | Nothing beyond re-wiring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Listener exceptions       | Propagated.                                                                                                                 | Logged at `severe` under `a2ui.EventNotifier` and swallowed.                                                                                                                                                                                                                                                                                                                                                      | Watch the log while migrating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Rendering

| Topic                         | genui                                                                                                                                                                                         | a2ui_flutter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the root arrives       | `defaultBuilder`, else nothing.                                                                                                                                                               | `LoadingPlaceholder` (an indeterminate `CircularProgressIndicator`) until the root component arrives and for pending children (`NodeState.pending`); unknown or cyclic children render `SizedBox.shrink()` and are reported on `surface.onError` / `onWarning`.                                                                                                                                                                                                                                                                             | Wrap `A2uiSurface` in the app's own placeholder logic if needed. In widget tests, `tester.pumpAndSettle()` will time out if a surface has no `root` component (or if `updateComponents` failed synchronous schema validation so `root` was rejected).                                                                                                                                                                                                                                         |
| Markdown                      | Rendered by the Text component.                                                                                                                                                               | Rendered only inside `A2uiMarkdown(builder: ...)`; otherwise body Text strips common markers and heading or caption Text never uses the builder.                                                                                                                                                                                                                                                                                                                                                                                            | Wrap the surface in `A2uiMarkdown` with a Markdown widget.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `openUrl`                     | The package launched the URL itself.                                                                                                                                                          | Fails unless the app passes `openUrl:` to `basicCatalog()`; only `http`, `https`, `mailto`, `tel`. On v0.9 a bound `openUrl` call runs whenever it resolves; on v1.0 only from an action.                                                                                                                                                                                                                                                                                                                                                   | Pass `openUrl: launchUrl` for an agent you trust; depend on `url_launcher` directly.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Theme                         | `primaryColor` applied by `Surface`.                                                                                                                                                          | v0.9 basic components apply the surface's `primaryColor` to their own `Theme`; a custom component gets it only through `A2uiSurface.of(context).theme`.                                                                                                                                                                                                                                                                                                                                                                                     | Apply a `Theme` in custom components that need the surface color.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Flexible children             | A `CatalogItem` with `isImplicitlyFlexible` received `weight: 1` from `Row` and `Column`.                                                                                                     | `BasicComponents.row` and `.column` build a `Flex` widget (`direction: Axis.horizontal` / `Axis.vertical`, spacing `8.0` vs `genui`'s `16.0` on `Row`), not `Row` or `Column` subclasses, and wrap every child in `Flexible` (`flex: 0` when unweighted in a `Column` or when keeping its own width in a `Row`; `flex: 1, fit: FlexFit.loose` for unweighted children in a bounded `Row` without weighted siblings; and `flex: (weight * 100).round(), fit: FlexFit.tight` when `weight` is set). `TextField` is wrapped in a `LimitedBox`. | Give widgets that need a bound a `LimitedBox` or `ConstrainedBox`; never use `Expanded` under an unbounded axis. In widget tests, match `Flex` with a `direction` predicate instead of `find.byType(Row)` / `find.byType(Column)`, use `.first` when finding the nearest `Flexible` ancestor, expect `flex: 100` for `weight: 1`, and note that `find.byKey(NodeKey(childId))` matches two widgets in `Row`/`Column` (the outer `KeyedSubtree` wrapping `Flexible` and the inner `NodeView`). |
| `Image` variants and assets   | `icon` and `avatar` were `32×32`, `smallFeature` `50×50`, `mediumFeature`/default `150×150`, `largeFeature` `400×400`, `header` `width: double.infinity`; non-`http` URLs used `Image.asset`. | `icon` is `24×24`, `avatar` is `40×40` (`ClipOval`), `smallFeature` is `maxWidth: 100`, `largeFeature` is `maxHeight: 400`, `header` is `height: 200`, and `mediumFeature`/default is unconstrained. Only `http://` and `https://` URLs are loaded; any other URL renders `Icon(Icons.broken_image)`.                                                                                                                                                                                                                                       | Update widget size expectations and goldens; provide a custom `Image` component if the app loads bundled `assets/...` paths.                                                                                                                                                                                                                                                                                                                                                                  |
| Accessibility                 | `A2uiAccessibility` applied by each item.                                                                                                                                                     | `NodeView` applies `accessibility.label`, `description`, `live`, `hidden` around every component.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Remove `Semantics` wrappers added for those attributes.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rebuild granularity           | `ValueListenableBuilder` per binding.                                                                                                                                                         | A builder reruns when its own node's props change, not when a child's do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A layout that depends on child props subscribes to `child.props`, as the basic `Row` and `Column` do.                                                                                                                                                                                                                                                                                                                                                                                         |
| Surface order                 | `activeSurfaceIds` moved an updated surface to the end.                                                                                                                                       | `allSurfaces` keeps creation order; there is no update event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Keep an ordered list in the app if the ordering mattered.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Modal` overlay and dismissal | Used `showModalBottomSheet` (dismissible via downward drag / `tester.fling`).                                                                                                                 | Uses `OverlayPortal` and `BottomSheet(enableDrag: false)` with a `CloseButton` and barrier tap handler.                                                                                                                                                                                                                                                                                                                                                                                                                                     | In widget tests, dismiss an open `Modal` by tapping `find.byType(CloseButton)` instead of `tester.fling`. To suppress actions while a turn is non-interactive (including inside an open `Modal` overlay), gate `SurfaceModel.dispatchAction` or filter in `onAction`.                                                                                                                                                                                                                         |
| Material                      | Same.                                                                                                                                                                                         | Basic components are Material widgets; `A2uiSurface` must sit under `MaterialApp` and inside a `Material`.                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tests pump `MaterialApp(home: Scaffold(body: ...))`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Data model and functions

| Topic                            | genui                                                                                             | a2ui_core                                                                                                                                       | What to do                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Paths                            | `DataPath`, dotted or slash separated.                                                            | JSON Pointer strings (`/a/b`). Invalid escapes and prototype-like keys throw `A2uiDataError`.                                                   | Rewrite paths; relative paths resolve through `DataContext.resolvePath`.                                          |
| Unbound input value              | Written to `<componentId>.value`.                                                                 | Not written anywhere; `props.writable` is null.                                                                                                 | Keep local state in the widget; bind the value in the agent if it must reach the data model or an action context. |
| Typed reads                      | `getValue<T>` threw `DataModelTypeException`.                                                     | `get` returns `Object?`; `ComponentProps` accessors return null on a type mismatch.                                                             | Cast and null-check.                                                                                              |
| `subscribe`                      | `ValueNotifier` that fired on subscribe.                                                          | `DataModel.subscribe(path, onChange)` does not fire for the current value; `watch(path)` returns a signal.                                      | Read `.value` once after subscribing if the first value is needed.                                                |
| Function arguments               | Raw `JsonMap`; functions validated themselves.                                                    | Resolved and schema-validated before `execute`; `containsKey` guards become dead code.                                                          | Trust the schema; tighten `required`.                                                                             |
| Asynchronous functions           | `AsynchronousClientFunction` awaited everywhere.                                                  | A returned `Future` is awaited only when the function runs from an action or an RPC; in a binding the `Future` object itself becomes the value. | Keep binding functions synchronous or reactive (`computed`).                                                      |
| Side effects in functions        | Common pattern (`setValue`, `navigate`).                                                          | A function in a binding reruns whenever it resolves; `requiresUserActivation: true` makes it fail outside an action.                            | Invoke side-effect functions from actions only, or handle the action in the app.                                  |
| Built-in function argument names | `formatNumber(decimalPlaces, useGrouping)`, `formatCurrency(currencyCode)`, `formatDate(pattern)` | `formatNumber(decimals, grouping)`, `formatCurrency(currency, decimals, grouping)`, `formatDate(format)`.                                       | Update prompts, fixtures and goldens.                                                                             |
| Locale                           | Implicit.                                                                                         | `basicCatalog(locale:)`, default `en-US`.                                                                                                       | Pass the app locale.                                                                                              |
| Logging                          | `genUiLogger`, `configureLogging`.                                                                | `package:logging` loggers under `a2ui_core.*` and `a2ui.*`; no configuration helper.                                                            | Listen on `Logger.root.onRecord`.                                                                                 |

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

1. Read [`api-mapping.md`](api-mapping.md) for the
   symbol-by-symbol table, [`recipes.md`](recipes.md)
   for before/after code, and
   [`behavior-changes.md`](behavior-changes.md) for
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
hide the latter.

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

- `BasicCatalogItems.asCatalog()` becomes `v0_9.basicCatalog(openUrl: ...)`
  (v0.9) or `basicCatalog(openUrl: ...)` (v1.0).
- `copyWith(newItems:)` replaced items by name; `CatalogImplementation`
  throws on a duplicate name. Filter `BasicComponents.all` before adding an
  override.
- `catalogIdAliases` is gone. Register the same component list under each id
  the agent may send. Note that `basicCatalog()` registers only
  `BasicCatalog.v0_9Id`, not genui's legacy
  `https://a2ui.org/specification/v0_9/basic_catalog.json`.
- An unknown `catalogId` on `createSurface` is now an error
  (`A2uiCatalogError`), not a tolerated stub. Register every id up front.
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
  when any bound value changes.
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

Tests that built a `SurfaceController` and pumped a `Surface` now build a
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
- [ ] v0.9 catalogs pass `functions`, `themeSchema` and `definitions`.
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

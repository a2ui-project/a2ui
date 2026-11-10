# Dart: migrate from `genui` to the A2UI Dart SDKs

Case of the [migration skill](../SKILL.md).

- **Language**: Dart / Flutter.
- **From**: `package:genui` 0.10.x (flutter/genui), which speaks A2UI v0.9.
  Code on genui 0.8.x and 0.9.x follows the same steps; see
  [From genui 0.9](#from-genui-09). genui 0.5 to 0.7 speak v0.8; see
  [From genui 0.5 to 0.7](#from-genui-05-to-07).
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

The new packages speak A2UI v0.9 and v1.0 with one `MessageProcessor`, so
an app can move off genui first and move its agent to v1.0 later.

## Before you start

1. Read [API mapping](#api-mapping) for the
   symbol-by-symbol table, [Recipes](#recipes)
   for before/after code, and
   [Behavior changes](#behavior-changes) for
   what the processor now does differently. Keep them open while you edit.
2. Inventory the code: list every file that imports `package:genui/`
   (`grep -rl 'package:genui' --include='*.dart'`), across every workspace
   member, since a member can import genui without declaring it. If none
   does, genui is
   an unused dependency: remove it from the pubspec instead of adding the
   A2UI packages, and leave docs that describe a planned genui design to
   the owner. Otherwise note which of these each file uses, because each is
   a separate step below:
   - renderer wiring (`SurfaceController`, `Surface`, `onSubmit`,
     `surfaceUpdates`, `contextFor`, `ActionDelegate`, `A2uiTransportAdapter`,
     `Conversation`, `A2UiClientCapabilities`);
   - prompting (`PromptBuilder`, `SurfaceOperations`, `PromptFragments`,
     `Catalog.systemPromptFragments`), and any class of the package that
     implements genui's `Transport` for a model provider (recipe (f), case 3);
   - custom components (`CatalogItem`, `CatalogItemContext`, `Catalog`,
     `BasicCatalogItems`, `A2uiSchemas`, `BoundString`/`BoundObject`,
     `DataContext`, `buildWeightedChild`, `ComponentChildrenBuilder`);
   - client functions (`ClientFunction`, `SynchronousClientFunction`,
     `ExecutionContext`, `BasicFunctions`);
   - types genui re-exported from other packages: `ChatMessage`, `TextPart`,
     `DataPart`, `UiInteractionPart` (from `genai_primitives`) and signals
     (from `preact_signals`);
   - tests that build a `SurfaceController` and pump a `Surface`.
3. Decide the wire version. genui 0.8 and later speak **v0.9**; genui 0.5
   to 0.7 speak v0.8, which `a2ui_core` does not read, so their wire moves to
   v0.9 in the same change (see
   [From genui 0.5 to 0.7](#from-genui-05-to-07)). Keep v0.9 when the agent
   is not changing in the same step: use
   `package:a2ui_flutter/v0_9/basic_catalog.dart` and `CommonSchemas`. Move to
   v1.0 only together with the agent: use
   `package:a2ui_flutter/basic_catalog.dart` and `CommonSchemasV1`, and read
   the v1.0 notes in each reference. The processor serves both at once, so a
   transition period can register catalogs of each version. While it does,
   build the capabilities of each version from the catalogs of that version:
   `getRendererCapabilities` lists every registered catalog under every
   requested version, and a v0.9 agent that picks a v1.0 catalog id fails
   to create its surface (see recipe (d)).

### From genui 0.9

The rest of this guide is written against genui 0.10. These differences
matter for code on 0.9, and on 0.8, which differs from 0.9 mainly in its
library exports:

| genui 0.9                                                                                          | Notes                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A2uiMessage`, `CreateSurface`, `UpdateComponents`, `UpdateDataModel`, `DeleteSurface`             | genui's own classes, without a `version`. 0.10 moved them to `a2ui_core` 0.1 as `A2uiMessage` and `*Message`. Both sets map to `AgentToRendererMessage` and the `*Message` classes of `a2ui_core` 0.5. |
| `basicCatalogId`, `https://a2ui.org/specification/v0_9/basic_catalog.json`                         | 0.10's `legacyBasicCatalogId`. `v0_9.basicCatalog()` does not register it; derive a catalog under it if the agent sends it (step 3).                                                                   |
| `PromptBuilder.chat(...)`, a factory                                                               | A static method in 0.10, called the same way; the replacement is the same.                                                                                                                             |
| A second `createSurface` for an existing surface set its catalog and theme and kept its components | 0.10 rejected it, as `a2ui_core` 0.5 does (`INTEGRITY_ERROR`).                                                                                                                                         |

A package that imported `a2ui_core` 0.1 directly also renames `A2uiMessage`
to `AgentToRendererMessage`. In 0.5, `AgentToRendererMessage.fromJson`
rejects unknown envelope and body fields, and accepts `"v0.9.1"` and `"1.0"`
as well as `"v0.9"`; an app that must keep rejecting them checks `version`
before `fromJson`. Every message constructor now takes `version:`.

### From genui 0.5 to 0.7

These releases speak A2UI v0.8 (genui 0.8.0 moved to v0.9), and
`a2ui_core` reads only `"v0.9"`, `"v0.9.1"` and `"1.0"`. The agent of such
an app is usually the app itself (a `ContentGenerator` calling a model), so
both sides move to v0.9 together. When the agent is a hand-written emitter
in the same repository (a backend that builds `surfaceUpdate` and
`beginRendering`), move it to v0.9 in the same change with
[the v0.9 evolution guide](../../../../specification/v0_9/docs/evolution_guide.md)
and say that both must ship together; its tests usually encode the v0.8
shapes. Otherwise convert v0.8 to v0.9 in the app before `processMessages`.
Read the pre-0.8 API in the pub cache (`genui-0.6.1/lib/src/`,
`genui-0.7.0/lib/src/`); the names differ from 0.10:

| genui 0.6                                                                                                                                     | Replacement                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A2uiMessageProcessor` (`GenUiManager` before 0.6), `GenUiHost`, `GenUiSurface(host:, surfaceId:)`                                            | `MessageProcessor`, `A2uiSurface` (recipes (a), (b)).                                                                                                                                    |
| `SurfaceUpdate(surfaceId, components: [Component(id:, componentProperties: {'Type': {...}})])`, then `BeginRendering(surfaceId:, root:, ...)` | `createSurface` first, then `updateComponents` with each component flattened to `{"id", "component": "Type", ...props}`. The root id must be `root`; genui 0.6 took any id.              |
| `SurfaceDeletion`, `DataModelUpdate`                                                                                                          | `deleteSurface`, `updateDataModel`.                                                                                                                                                      |
| Default catalog id `a2ui.org:standard_catalog_0_8_0`, `CoreCatalogItems.asCatalog()`, `catalog.copyWith([...])`                               | `v0_9.basicCatalog().derive(catalogId:, ...)`; the agent sends the new id.                                                                                                               |
| `processor.surfaces`, `surfaceUpdates` (`SurfaceAdded` on every `beginRendering`, `SurfaceUpdated`, `SurfaceRemoved`)                         | `processor.model.getSurface(id)`, `onSurfaceCreated`, `onSurfaceDeleted`; there is no update event.                                                                                      |
| `GenUiSurface(host:, surfaceId:)` placed before the surface exists                                                                            | A small `StatefulWidget` that reads `getSurface(id)` in `initState`, follows `onSurfaceCreated` and `onSurfaceDeleted` filtered by id, and shows the fallback while the surface is null. |
| genui's own sealed `ChatMessage` (`UserMessage`, `AiTextMessage`, `UserUiInteractionMessage`, ...), not `genai_primitives`                    | The app's own message type or a `String`. `onSubmit` text was `jsonEncode({'userAction': event.toMap()})`; `{'userAction': action.toJson()}` keeps it.                                   |
| `A2UiClientCapabilities.toJson()`, `{"supportedCatalogIds": [...]}`                                                                           | `getRendererCapabilities(...).toJson()`, keyed by version: `{"v0.9": {"supportedCatalogIds": [...]}}`.                                                                                   |
| `Catalog([CatalogItem(name:, dataSchema:, widgetBuilder:)], catalogId:)`, reading raw `ctx.data`                                              | Same mapping as the 0.10 `CatalogItem` row.                                                                                                                                              |
| `ContentGenerator` (`a2uiMessageStream`, `textResponseStream`, `errorStream`, `sendRequest(ChatMessage, {history})`), `GenUiConversation`     | Recipe (f). A package that exported a `ContentGenerator` keeps its public names by declaring its own class with the same streams, as recipe (f) case 3 describes for `Transport`.        |
| `genui_firebase_ai` and other generators that declared `surfaceUpdate`, `beginRendering` and `deleteSurface` as model tools                   | Use the model SDK directly with `a2ui_agent`'s prompt and parser, and restrict the parser to what the tools allowed (see below).                                                         |

Behavior that differs from genui 0.6:

- `handleMessage` did not validate and reported no errors. A second
  `beginRendering` re-created the surface, and a `surfaceUpdate` replaced
  components in place. `a2ui_core` rejects a second `createSurface` with
  `INTEGRITY_ERROR`, so a mock that replays fixed surface ids sends
  `createSurface` once per id.
- `GenUiConversation.sendRequest` added only the model's replies to the
  history, not the user's turns. A chat session in the model SDK sends both.
- Tool-call generators delivered each component whole, and the reply text
  arrived once, at the end, through a forced `provideFinalOutput` tool. With
  `DirectJsonFormatFactory(allowedMessages: ['createSurface',
'updateComponents', 'deleteSurface'], bufferIncompleteComponents: true)`
  the model writes text and `<a2ui-json>` blocks in one streamed reply;
  `TextPart`s arrive per chunk, so join them until the next `A2uiPart`,
  `ErrorPart` or `close()` to keep one text bubble per reply. Keeping
  function calling and checking the arguments with `a2ui_agent`'s
  `validatePayload` is the other option.
- `firebase_ai` also exports `TextPart`, and its `startChat` is the
  extension `StartChatExtension`: a `show` list on the `firebase_ai` import
  must name it.

## Migration steps

Do the steps in order; each leaves the code compiling if the previous one is
complete. Commit after each step when the change is large.

### 1. Dependencies

`pubspec.yaml`: remove `genui`; add `a2ui_core` and `a2ui_flutter` (see
`dart/a2ui_flutter/README.md` for the current version constraints; follow
the project's convention, such as exact pins, over `^`). `a2ui_flutter`
does not re-export `a2ui_core`, so a package that had `a2ui_core` only as a
dev dependency moves it to `dependencies`. In a pub workspace, every member
that imports `a2ui_core` directly moves to the same release, which can
widen the change (genui 0.10 pinned `a2ui_core` 0.1, whose `A2uiMessage`
is now `AgentToRendererMessage`). `a2ui_flutter` 0.2.0 depends on
`video_player`, as genui 0.8 and later did; coming from genui 0.5 to 0.7,
`pub get` adds its plugin to the tracked registrants (macOS) and to
`Podfile.lock` on the next `pod install`. Keep
`json_schema_builder` if the app declares component schemas, and add
`genai_primitives` explicitly if the app still uses `ChatMessage` or the UI
parts from it. Add `a2ui_agent` only for an app that prompts a model itself.
Markdown rendering and `openUrl` are no longer built in: add
`flutter_markdown_plus` (or another Markdown widget) and `url_launcher` if the
app relied on them. Conversely, if the app does not wire `openUrl` and its
native/web plugin registrar or build config declared `url_launcher` only
because `genui` pulled it in transitively, remove that unused `url_launcher`
plugin dependency so build/plugin analysis does not fail (the typical error
says the plugin is registered in the plugin registrar but not used in the Dart
code). genui also exported
the `combineLatestAll` and `switchMap` stream extensions; code that used them
depends on `package:stream_transform` or keeps local copies. A library that
re-exports `a2ui_core` or `a2ui_flutter` symbols to its own users must declare
those packages as exported dependencies when the build enforces strict deps.
genui depended on Flutter, so a pure-data library that used genui only for
schemas (`A2uiSchemas`) had to be built for `dart:ui`; once it imports only
`a2ui_core`, which has no Flutter dependency, drop that requirement from its
build rule (in Bazel-style builds, `required_libs = ["ui"]`). If the build
restricts package visibility, the client needs access to `json_schema_builder`
as well as to `a2ui_core` and `a2ui_flutter`.

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
hide the latter. `a2ui_core` also exports `Action`, which collides with
Flutter's `Action<T extends Intent>` in `package:flutter/widgets.dart` when a
file uses or re-exports `Action`; add `hide Action` on the `a2ui_core` import if
needed. If the app already defines its own `A2uiProtocolVersion` enum, use
`import 'package:a2ui_core/a2ui_core.dart' hide A2uiProtocolVersion;` and alias
`a2ui_core` where the SDK enum is needed. `package:intl` exports a
`TextDirection` that collides with `dart:ui`'s in files that import both (common
in compatibility code that ports formatting helpers); add `hide TextDirection`
on the `intl` import. When removing the genui import, also check files that
import a package re-exporting genui symbols under a prefix (`as generated`)
while using genui names unprefixed: they still need an explicit import of the
replacement.

### 2. Renderer wiring

Replace `SurfaceController` with `MessageProcessor<ComponentImplementation>`
and `Surface` with `A2uiSurface`. The processor takes decoded JSON directly,
so `A2uiMessage.fromJson` and `A2uiTransportAdapter` go away:

```dart
processor = MessageProcessor<ComponentImplementation>(
  catalogs: [myCatalog],
  validationConfig: ValidationConfig.relaxed,
  reportErrorsOnly: true, // report bad messages on onError instead of throwing
);
processor.model.onSurfaceCreated.subscribe(_addSurface);
processor.model.onSurfaceDeleted.subscribe(_removeSurface);
processor.model.onAction.subscribe(_sendAction);
processor.model.onError.subscribe(_sendError);

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
- Errors arrive on `processor.model.onError` as `A2uiRendererError`: both
  the ones surfaces report while rendering or binding (each
  `surface.onError` is forwarded there) and the ones `processMessages` meets
  for a bad message, already mapped to wire codes. Forward errors to the
  agent from that one channel; a second listener on `surface.onError` sends
  every error on an existing surface twice. Without `reportErrorsOnly: true`,
  `processMessages` also **throws** the `A2uiError` after reporting it, so a
  `try`/`on A2uiError` around it must not send the error again. Code that
  receives a processor it did not create, and must not throw whatever
  `reportErrorsOnly` the caller chose (as genui's `handleMessage` did not),
  calls `processMessagesWithErrors`. An app with no agent to send errors to
  (one that renders what a model produced once) still logs `error.code` and
  `error.message`: otherwise a rejected message leaves a blank surface with
  no trace. See recipe (e).
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
  app that prompts a model directly moves to `a2ui_agent` (recipe (f)). A
  package that implements `Transport` for a model provider keeps its class
  and moves its prompting and parsing to `a2ui_agent` (recipe (f), case 3).
- Dispose: unsubscribe your `Subscription`s, then `processor.dispose()`.

### 3. Catalogs

`Catalog` becomes `CatalogImplementation` (an alias of
`Catalog<ComponentImplementation, FunctionImplementation>`) and needs an
`id`. A v0.9 surface has exactly one catalog, so a v0.9 catalog built on the
basic components also needs their functions, theme schema and definitions.
`derive` on the basic catalog keeps all three, including the `openUrl` and
`locale` the basic catalog was built with:

```dart
final CatalogImplementation myCatalog = v0_9.basicCatalog(openUrl: launchUrl).derive(
  catalogId: 'https://example.com/catalog.json', // what the agent sends as catalogId
  addComponents: [myComponent],                  // replaces a basic component of the same name
  instructions: myInstructions,                  // the old systemPromptFragments, if any
);
```

- A catalog that does not build on the basic components and whose agent
  sends no theme and calls no basic function is just
  `CatalogImplementation(id:, components:)`.
- `BasicCatalogItems.asCatalog()` becomes `v0_9.basicCatalog(locale: ..., openUrl: ...)`
  (v0.9) or `basicCatalog(locale: ..., openUrl: ...)` (v1.0). Pass
  `locale: Intl.getCurrentLocale()` if your app uses `package:intl`'s active
  locale for `formatDate`, `formatNumber`, `formatCurrency`, and `pluralize`
  (the default is `'en-US'`).
- `copyWith(newItems:)` becomes `derive(catalogId:, addComponents:)`, which
  also replaces items by name. `derive` does not keep `instructions`; pass
  them. The v0.9 basic catalog has none, so genui's `basicCatalogRules` leave
  the prompt (see [Behavior changes](#message-processing)). Building
  `CatalogImplementation(components: [...])` directly throws
  `A2uiCatalogError` on a duplicate name, so filter `BasicComponents.all`
  before adding an override there. If you intentionally omit certain basic
  components (such as `Image`, `Video`, or `AudioPlayer`) while using
  `ValidationConfig.relaxed`, an agent that still emits them gets an
  `UNKNOWN_COMPONENT_TYPE` error on `surface.onError`, which the app's error
  listener sends back to the agent. Register silent `SizedBox.shrink()`
  component stubs for them to suppress it.
- `catalogIdAliases` is gone. Register the catalog under each id the agent
  may send, with one `derive(catalogId: alias, ...)` per id from the same
  base catalog. Note that `basicCatalog()` registers only
  `BasicCatalog.v0_9Id`, not genui's old basic catalog id
  `https://a2ui.org/specification/v0_9/basic_catalog.json`.
- A missing or unknown `catalogId` on a v0.9 `createSurface` is an error
  (`A2uiValidationError` when absent or `null`, `A2uiCatalogError` when
  unregistered), not a tolerated stub. Notice also that `Catalog([...])` with no
  `catalogId` in genui synthesized an unreachable `inline_catalog_<hashCode>`
  id: pick a stable id, register every id the agent sends up front, and if a
  v0.9 backend omits `catalogId` (or sends `{"catalogId": null}`) on
  `createSurface`, check `createSurface['catalogId'] != null` (not
  `containsKey('catalogId')`) and inject the default id into the decoded map
  before calling `processMessages`.
- When a stateful widget receives a growing list of streamed message payloads in
  `didUpdateWidget`, keep the existing `MessageProcessor` and feed only the
  newly appended slice (`widget.payloads.sublist(oldWidget.payloads.length)`)
  rather than disposing and recreating the processor on every chunk; recreating
  the processor creates a new `SurfaceModel` (`ObjectKey(surface)`) and resets
  stateful subtree state such as expanded cards or scroll positions.
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
  when any bound value changes. Because `MessageProcessor` validates every
  `updateComponents` payload against `ComponentImplementation.schema` and
  `NodeResolver` only binds `{"path": "/..."}` references on properties whose
  schema permits dynamic values, declare any property that may receive a data
  binding with `CommonSchemas.dynamicString` / `dynamicNumber` /
  `dynamicBoolean` / `dynamicStringList` rather than plain `Schema.string()` /
  `number()` / `boolean()`. A hand-written binding schema binds too: an
  object schema with a `path` property (`@path` on v1.0), so genui's
  `BoundObject` over `S.object(properties: {'path': S.string()})` becomes
  `props.value(key)` with the schema unchanged, and any union with a
  data-binding branch, such as `oneOf: [<literal schema>, CommonSchemas.dataBinding,
CommonSchemas.functionCall]`, and raw JSON Schemas may `$ref` the absolute
  `https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString`.
  Inside `Schema.object()` and `Schema.list()` properties, members declared
  dynamic are resolved as well: `props.list('rows')` gives maps whose
  `value` is a `ResolvedBinding` or `WritableBinding`, not `{"path": ...}`;
  read it with `ComponentProps.asString(row['value'])`. Members without a
  schema, as in `Schema.object(additionalProperties: true)`, are passed
  through unchanged as deep-frozen snapshots (`props.value(key)` returns an
  unmodifiable `Map` or `List`); use pattern matching (`switch (props.value('params')) { final Map<String, dynamic> m => m, _ => const <String, dynamic>{} }`)
  rather than an unchecked `as Map<String, dynamic>?` cast so an unexpected
  payload shape does not throw a `TypeError` during build.
- A dynamic property the agent omitted is still in `props`, as
  `const ResolvedBinding(null)`, also inside nested objects and list items.
  A ported presence check such as `if (props['summary'] != null)` is then
  always true. `props.value(key) != null` fixes that but also hides a bound
  value whose data has not arrived, which genui drew as empty; the faithful
  port is `value is WritableBinding || ComponentProps.unwrap(value) != null`.
- A factory constructor can be passed directly as `builder` when it matches
  `ComponentWidgetBuilder`:
  `factory MyWidget.fromNode(BuildContext context, ComponentNode<ComponentImplementation> node, ComponentProps props, ChildWidgetBuilder buildChild)`
  (replacing `widgetBuilder: MyWidget.fromContext`).
- Write through `props.writable(key)`, which is null when the agent gave a
  literal. genui then wrote to `<id>.value`, one key relative to the
  component's data scope, and
  `node.context?.dataContext.set('<id>.value', value)` does the same. The
  other consistent choice is what the basic inputs other than `TextField` do:
  render a literal value read-only.
- Call `props.action(key)` synchronously in the gesture handler; it resolves
  the action context and runs as a user activation.
- Child references must be top-level properties, or properties of the
  objects in a top-level array (like `Tabs`'s `tabs[].child`), declared with
  `CommonSchemas.componentId` / `childList` (v0.9) or a `$ref` to
  `common_types.json#/$defs/Child` / `ChildList` (v1.0). Otherwise the
  builder receives id strings, except for a plain string `child` or a plain
  string-array `children`, which are resolved by name. Wrap each child you decorate in
  `KeyedSubtree(key: NodeKey(child.instanceId), ...)`.
- `isImplicitlyFlexible` and `exampleData` have no equivalent. Give widgets a
  bound with `LimitedBox`. genui never put `exampleData` into prompts, so
  moving examples into `CatalogImplementation(instructions:)` changes what the
  model reads; tooling that renders examples (a code generator's tests, for
  example) can keep its own `CatalogItem extends ComponentImplementation` that
  holds them. A component that relied on `isImplicitlyFlexible` usually
  needs nothing: in a `Row` with a bounded width, `a2ui_flutter` 0.2.0 gives
  every unweighted child a loose `Flexible` unless it keeps its own width
  (`Icon`, `Button`, `CheckBox`), and caps it at an equal share next to
  weighted siblings. Only in a `Row` whose width is unbounded can a
  component that stretches internally (`Expanded`,
  `CrossAxisAlignment.stretch`) hit `BoxConstraints forces an infinite
width`; bound it there, or have the agent send a `weight`.
- Accessibility attributes are applied by the framework; do not wrap in
  `Semantics` for them.
- `A2uiSurface.of(context)` gives the surface for `theme`, `id`,
  `dataModel` and `dispatchError`. Content shown in an overlay or a new route
  is outside the surface's subtree, where `A2uiSurface.of` finds nothing; use
  `node.context?.surface` there, for example to call `dispatchError`.
- A library with many custom `CatalogItem`s may keep a thin compatibility
  layer (its own `CatalogItem` implementing `ComponentApi`, and a
  `SurfaceController` wrapping `MessageProcessor`) to migrate in stages.
  Prefer delegating to the SDK inside it: basic components to
  `v0_9.BasicComponents`, schemas to `CommonSchemas`, basic functions to
  `BasicCatalog.v0_9(openUrl: ...).functions`, path resolution to
  `DataContext.resolvePath`, and value binding to
  `DataContext.resolveSignal`. Hand-copied versions drift from the SDK
  (missing widgets, double-evaluated function arguments, wrong `.` /
  trailing-slash handling). A delegated schema
  (`BasicCatalogItems.textField.dataSchema` →
  `v0_9.BasicComponents.textField.schema`) is the spec's, which differs from
  genui's beyond the three keys the `CatalogItem` row of the mapping lists:
  `TextField` requires `label` and has no `onSubmittedAction`, `Slider`
  requires `max`, and `ChoicePicker`'s `options` is a list, not a binding. The
  package's wire properties change with it.
- A layer that instead keeps genui's API by reimplementing `Surface`,
  `DataContext` and the basic functions on top of `a2ui_core.DataModel` is
  sometimes the accepted outcome for a large catalog, and keeps goldens stable.
  It gives up `MessageProcessor` validation and `A2uiSurface` rendering, and it
  has to replicate genui behavior the app relied on. In particular, genui's
  `Surface` wrapped every component in `A2uiAccessibility` (merged semantics
  plus replaced child labels); components that set `container: false` on their
  own `Semantics` rely on that wrap, so a replacement `Surface` must apply it
  too or accessibility tests fail. (`A2uiSurface`'s `NodeView` applies the
  attributes natively.) Port `ValidationHelper` as well if components used its
  validation stream.
- If generated code emitted genui calls (for example, templates run by the
  build to produce component bases or schema classes), change the templates
  and their tests, not the generated output. Put any compatibility layer at or
  below the lowest generated package, so a data-only generated library can
  depend on `a2ui_core` alone.

### 5. Client functions

`SynchronousClientFunction` / `AsynchronousClientFunction` become
`FunctionImplementation`s passed to `CatalogImplementation(functions:)`; see
the functions section of the mapping and recipe (k). A function that writes
the data model as a side effect (`setValue`-style) must never run in a
binding, which reevaluates whenever its inputs change. Write from the
component through `props.writable`, handle the action in the app's
`onAction` listener, or keep the function and restrict it to actions with
`requiresUserActivation: true`, writing through `context.set(...)` as recipe
(k) shows. This works on v0.9 and v1.0.

### 6. Tests

Tests that built a `SurfaceController` and pumped a `Surface`—or that called
`catalogItem.widgetBuilder(CatalogItemContext(...))` directly with a
hand-built `CatalogItemContext`—now build a
`MessageProcessor<ComponentImplementation>` with
`ValidationConfig.strict`, feed JSON with `processMessages`, and pump
`A2uiSurface(surface: processor.model.getSurface(id)!)` under
`MaterialApp(home: Scaffold(...))`. Recipe (m) has a self-contained harness.
Assert on `processor.model.onAction` events and `surface.dataModel.get('/path')`
instead of `onSubmit` and `DataModel.getValue(DataPath(...))`. Existing tests
also change in these ways:

1. `ValidationConfig.strict` requires a component with id `root`. Rename the
   root of each test surface, and the `<id>.value` paths derived from its id.
2. A test that fed schema-invalid properties to check a widget's own
   fallback now gets `VALIDATION_FAILED`, and the surface stays unchanged.
   Split it into a schema-valid but unusual case and a rejected case, and
   assert the rendered content, not only the widget type.
3. `processor.model.getSurface(id)` is null until `createSurface` is
   processed, so a test that paces its messages advances time before it pumps
   `A2uiSurface`.
4. Fixtures that nest properties under `"properties": {...}` (genui's Dart
   `Component(id, type, properties)` shape leaking into JSON) passed with
   genui, which kept the key as one unknown property; they are now rejected.
   Flatten them.
5. Component JSON that the app builds by hand (fallback trees, seeded demo
   surfaces, the app's own response schemas for a model) may use keys or
   enum values outside the catalog that genui ignored. They now reject the
   whole message, so feed each such map through a strict processor in a
   test.
6. `controller.handleUiEvent(UserActionEvent(...))` worked without a
   surface; `surface.dispatchAction({'event': {'name': ...}}, id)` needs a
   created surface, so seed one first.

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
      including aliases and genui's old basic catalog id if used.
- [ ] v0.9 catalogs built on the basic components are derived from
      `v0_9.basicCatalog(...)` or pass `functions`, `themeSchema` and
      `definitions`.
- [ ] Errors reach the agent from `processor.model.onError` only, and the
      processor uses `reportErrorsOnly: true` or a `try`/`on A2uiError`
      around `processMessages` does not send them again.
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

| genui                                                                                                            | New                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SurfaceController({required Iterable<Catalog> catalogs, pendingUpdateTimeout})`                                 | `MessageProcessor<ComponentImplementation>({required List<CatalogImplementation> catalogs, A2uiProtocolVersion? defaultVersion, ValidationConfig? validationConfig, onAction, onError, OutboundMessageListener? outboundListener})` | `a2ui_core/lib/src/processing/processor.dart`. No `pendingUpdateTimeout`: updates for a surface that does not exist yet are errors, see behavior changes. `catalogs` is unmodifiable after construction.                                                                                                                                                                                                                                                                                                                                                              |
| `controller.catalogs`                                                                                            | `processor.catalogs`                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `controller.handleMessage(A2uiMessage)`; `A2uiMessageSink`                                                       | `processor.processMessages(Object? payload)`                                                                                                                                                                                        | Takes a decoded envelope map, a list of envelopes, `{"messages": [...]}`, or parsed `AgentToRendererMessage`s. Reports a rejected message on `processor.model.onError`, then throws `A2uiError` synchronously unless the processor has `reportErrorsOnly: true`. `processMessagesWithErrors(payload)` returns the `List<ErrorMessage>` instead of throwing.                                                                                                                                                                                                           |
| `A2uiMessage` type and `A2uiMessage.fromJson(map)` (`package:genui/a2ui_core.dart`)                              | `AgentToRendererMessage` / `AgentToRendererMessage.fromJson(map)`                                                                                                                                                                   | Pass JSON directly to `processMessages` unless the app distinguishes envelope parsing (`AgentToRendererMessage.fromJson` throws only on malformed envelopes) from semantic processing (`processMessages` also throws `A2uiError` on unknown `catalogId`, missing surface, or schema failure).                                                                                                                                                                                                                                                                         |
| `CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`, `DeleteSurfaceMessage`              | Same names in `a2ui_core`                                                                                                                                                                                                           | `version` is a required constructor argument; `catalogId` is nullable (optional on v1.0 only). `toJson()` produces the same wire shape.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `controller.surfaceUpdates` (`SurfaceAdded`, `ComponentsUpdated`, `SurfaceRemoved`)                              | `processor.model.onSurfaceCreated: EventSource<SurfaceModel>`, `processor.model.onSurfaceDeleted: EventSource<String>`                                                                                                              | `subscribe(listener)` returns a `Subscription`; call `unsubscribe()` on dispose. No components-updated event; `A2uiSurface` rerenders on its own.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `controller.activeSurfaceIds`                                                                                    | `processor.model.allSurfaces.map((s) => s.id)` or a list the app keeps from the two events                                                                                                                                          | genui moved a surface to the end on each update; `allSurfaces` keeps creation order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `controller.contextFor(id)` → `SurfaceContext`                                                                   | `processor.model.getSurface(id)` → `SurfaceModel<ComponentImplementation>?`                                                                                                                                                         | Unlike `contextFor(id)` (which lazily created a `SurfaceContext` even before `createSurface` arrived), `getSurface(id)` returns `null` until `createSurface` succeeds. `SurfaceModel` has `id`, `protocolVersion`, `defaultCatalog`, `availableCatalogs`, `theme`, `sendDataModel`, `dataModel`, `componentsModel`, `onAction`, `onError`, `onWarning`.                                                                                                                                                                                                               |
| `SurfaceContext.definition` (`ValueListenable<SurfaceDefinition?>`)                                              | none needed                                                                                                                                                                                                                         | Pass the `SurfaceModel` to `A2uiSurface`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SurfaceContext.dataModel`                                                                                       | `surface.dataModel`                                                                                                                                                                                                                 | Different class; see section 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SurfaceContext.catalog`                                                                                         | `surface.defaultCatalog`                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SurfaceContext.handleUiEvent(UiEvent)` / `controller.handleUiEvent`                                             | `surface.dispatchAction(Map payload, String sourceComponentId)`                                                                                                                                                                     | Built-in and custom components dispatch through `props.action`; app code only listens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SurfaceContext.reportError(error, stack)` / `controller.reportError`                                            | `surface.dispatchError(A2uiRendererError(...))`                                                                                                                                                                                     | Typed error with `code`, `surfaceId`, `message`, `path`, `details`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `controller.onSubmit: Stream<ChatMessage>`                                                                       | `processor.model.onAction: EventSource<A2uiRendererAction>` for actions; `processor.model.onError: EventSource<A2uiRendererError>` for errors; `outboundListener` for RPC messages                                                  | The app builds the wire message: `ActionMessage(version:, action:)`, `ErrorMessage(version:, error:)`, `RendererToAgentMessagePayload.of(message).toJson()` for the `{"messages": [...]}` form.                                                                                                                                                                                                                                                                                                                                                                       |
| `ChatMessage`, `UiInteractionPart.create(json)` (from `genai_primitives`)                                        | none                                                                                                                                                                                                                                | The envelope around A2UI JSON is app-defined. The inner `{"version":"v0.9","action":{...}}` JSON is unchanged, so an app can keep its old framing.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `UiEvent`, `UserActionEvent(name, context, surfaceId, sourceComponentId)`                                        | `A2uiRendererAction(name, surfaceId, sourceComponentId, timestamp, context, userMessage, catalogId, metadata)`                                                                                                                      | `toJson()` adds a UTC ISO-8601 `timestamp` and optional `userMessage`, `catalogId`, `metadata`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DispatchEventCallback`                                                                                          | `void Function(A2uiRendererAction)`                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ActionDelegate`, `DefaultActionDelegate`, `Surface(actionDelegate:)`                                            | none                                                                                                                                                                                                                                | Branch on `action.name` in the `onAction` listener; handle locally or forward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `controller.clientCapabilities`, `A2UiClientCapabilities.fromCatalogs(catalogs, inlineHandling:)`                | `processor.getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9], includeInlineCatalogs: false))`                                                                                                        | `toJson()` gives `{"v0.9": {"supportedCatalogIds": [...]}}`, the same shape (`inlineCatalogs` on `A2uiVersionCapabilities` is a non-null `List<CatalogApi>` defaulting to `[]`, omitted from `toJson()` when empty). `InlineCatalogHandling.none/missingIds/all` collapses to the boolean.                                                                                                                                                                                                                                                                            |
| manual data-model snapshot                                                                                       | `processor.getRendererDataModel(version: A2uiProtocolVersion.v0_9)`                                                                                                                                                                 | Null until a surface with `sendDataModel: true` exists; send as `a2uiClientDataModel` (v0.9) or `a2uiRendererDataModel` (v1.0).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Surface({surfaceContext, defaultBuilder, actionDelegate})`                                                      | `A2uiSurface({Key? key, required SurfaceModel<ComponentImplementation> surface})`                                                                                                                                                   | Key it with `ObjectKey(surface)`. No `defaultBuilder`: if a wrapper widget previously relied on `defaultBuilder` before `createSurface` arrived, accept `SurfaceModel<ComponentImplementation>?` and render the fallback when `surface == null`; genui showed `defaultBuilder` only before `createSurface` and after `deleteSurface`, and nothing for a surface without a root. A wrapper built before the surface exists also follows `onSurfaceCreated` and `onSurfaceDeleted`, filtered by id. `A2uiSurface.of(context)` / `maybeOf` return the enclosing surface. |
| `FallbackWidget`                                                                                                 | none                                                                                                                                                                                                                                | Keep a copy in the app if it is shown for other reasons. To render a custom widget for unresolved or unknown children, check `child.state != NodeState.resolved` (or `child.impl == null`) before calling `buildChild(child)`. Basic `Row`, `Column` and the surface root render nothing for an unknown type; to show a visible fallback there, register a fallback `ComponentImplementation` and rename unknown `component` values (not in any `processor.catalogs` entry) to it before `processMessages`.                                                           |
| `A2uiTransportAdapter`, `A2uiParserTransformer`, `Transport`, `GenerationEvent`, `TextEvent`, `A2uiMessageEvent` | none in `a2ui_core`/`a2ui_flutter`                                                                                                                                                                                                  | Backend returns A2UI JSON: `jsonDecode` and `processMessages`. App prompts a model: `package:a2ui_agent` (`A2uiGenerator`, `A2uiRequestProcessor.openStream`, `ResponsePart` = `TextPart` or `A2uiPart`).                                                                                                                                                                                                                                                                                                                                                             |
| `Conversation`, `ConversationState`, `ConversationEvent`, `ConversationError`                                    | none                                                                                                                                                                                                                                | App-owned state; `dart/a2ui_flutter/example/lib/chat_session.dart` is a model to copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `conversation.events`, `conversation.state.value.surfaces`                                                       | the transport's text stream; `processor.model.onSurfaceCreated`; a `List<SurfaceModel>` kept from `onSurfaceCreated` and `onSurfaceDeleted`                                                                                         | `ConversationContentReceived` carried one text chunk, not the text so far. `ConversationWaiting` and `ConversationError` become the app's own code before and around the request. Nothing replaces `ConversationComponentsUpdated`: `A2uiSurface` rerenders itself.                                                                                                                                                                                                                                                                                                   |
| `PromptBuilder.chat(catalog:, systemPromptFragments:, clientDataModel:)`, `PromptBuilder.custom(...)`            | `A2uiGenerator(catalogs: [CatalogConfig(catalog)]).createProcessor(capabilities).promptSnippet` (`package:a2ui_agent`)                                                                                                              | The snippet holds the format rules, the message and catalog schemas, and each catalog's `instructions`. Put the app's fragments before it and the client data model after it. genui's chat prompt also told the model not to update the surfaces of earlier turns; keep that line in the app when it still applies.                                                                                                                                                                                                                                                   |
| `SurfaceOperations` (`createOnly`, `updateOnly`, `createAndUpdate`, `all`)                                       | `allowedMessages` of `DirectJsonFormatFactory` or `ExpressFormatFactory`, and the lifetime of the `RendererState`                                                                                                                   | `allowedMessages` prunes the message schema in the prompt. Create-only is a chat: open each reply's stream without a state, so it is checked on its own. With updates or deletes, keep one `agent.createState()` for the conversation and pass it to every stream.                                                                                                                                                                                                                                                                                                    |
| `PromptFragments` (`currentDate`, `acknowledgeUser`, ...), `TechnicalPossibilities`                              | none                                                                                                                                                                                                                                | Inline the strings the app used. `uiGenerationRestriction` asked for markdown fences, which the `a2ui_agent` formats do not use.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `InternalMessageView`, `ChatMessageView`                                                                         | none                                                                                                                                                                                                                                | App-owned widgets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `'v0.9'` literal                                                                                                 | `A2uiProtocolVersion.v0_9.jsonValue`                                                                                                                                                                                                | Values: `v0_9` (`'v0.9'`), `v0_9_1` (`'v0.9.1'`), `v1_0` (`'1.0'`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `controller.dispose()`                                                                                           | unsubscribe `Subscription`s, then `processor.dispose()`                                                                                                                                                                             | Disposing fires `onSurfaceDeleted` for each surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 2. Catalogs and components

| genui                                                                                  | New                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Catalog(items, catalogId:, catalogIdAliases:, functions:, systemPromptFragments:)`    | `CatalogImplementation(id:, components:, functions:, protocolVersion:, themeSchema:, definitions:, instructions:, title:, description:)`                             | `CatalogImplementation` = `Catalog<ComponentImplementation, FunctionImplementation>`. `id` is required. `protocolVersion` null means pre-1.0. `systemPromptFragments` become the `instructions` string, which `a2ui_agent`'s prompts include.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `catalog.copyWith(newItems:, newFunctions:, catalogId:)`                               | `catalog.derive(catalogId:, addComponents:, addFunctions:, instructions:)`                                                                                           | `derive` replaces entries of the same name and keeps the functions, `protocolVersion`, `themeSchema` and referenced `definitions`, but not `instructions`. Constructing `CatalogImplementation` directly throws `A2uiCatalogError` on duplicate names; filter before overriding: `BasicComponents.all.where((c) => c.name != 'Text')`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `catalog.copyWithout(itemsToRemove:)`                                                  | `catalog.derive(catalogId:, components: [...namesToKeep])` or `catalog.copyWith(components: ...)` (same id)                                                          | `copyWith(components:)` takes the full new component list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `catalog.catalogIdAliases`, `matchesId`                                                | `catalog.derive(catalogId: alias, instructions: ...)`, registered beside the original                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `catalog.items`, `catalog.functions` (iterables)                                       | `catalog.components`, `catalog.functions` (`Map<String, ...>`)                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `catalog.fullSchema`, `catalog.definition`                                             | `catalog.toJson()` (the catalog document, with `common_types.json` references), `catalog.validationSchema` (bundled and closed)                                      |
| `toCapabilitiesJson()`                                                                 | `catalog.toV09InlineCatalog()`, the v0.9 inline catalog; `A2uiRendererCapabilities.forCatalogIds([id], inlineCatalogs: [catalog]).toJson()` for the whole object     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `BasicCatalogItems.asCatalog()`                                                        | `v0_9.basicCatalog(openUrl:, locale:)` (v0.9) or `basicCatalog(openUrl:, locale:)` (v1.0)                                                                            | Ids: `BasicCatalog.v0_9Id`, `BasicCatalog.v1_0Id`. genui's old alias `https://a2ui.org/specification/v0_9/basic_catalog.json` is not registered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `BasicCatalogItems.asNoAssetCatalog()`                                                 | `v0_9.basicCatalog(openUrl:, locale:).copyWith(components: v0_9.BasicComponents.all.where((c) => !{'Image', 'Video', 'AudioPlayer'}.contains(c.name)))`              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `BasicCatalogItems.text`, `.row`, ... (static `CatalogItem`s)                          | `BasicComponents.text`, `.row`, ... (static `ComponentImplementation`s); `BasicComponents.all`; `BasicComponents.api` (`themeSchema`, `definitions`, `instructions`) | In the version-specific library. `AvailableIcons` (`AvailableIcons.fromName`, `allAvailable`) is no longer exported; define your own icon map if custom components referenced it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `basicCatalogId`, `legacyBasicCatalogId`, `commonTypesSchemaId`                        | `BasicCatalog.v0_9Id`, `BasicCatalog.v1_0Id`; no legacy or common-types constant                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `BasicCatalogItems.basicCatalogRules`                                                  | v1.0: `BasicComponents.api.instructions`; none on v0.9                                                                                                               | `v0_9.BasicComponents.api.instructions` is null, so genui's rules leave v0.9 prompts; see behavior changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CatalogItem(name:, dataSchema:, widgetBuilder:, exampleData:, isImplicitlyFlexible:)` | `ComponentImplementation(name:, schema:, builder:)`                                                                                                                  | `exampleData` and `isImplicitlyFlexible` have no equivalent. genui's `CatalogItem.dataSchema` added `'component': {'type': 'string', 'enum': [name]}` to `properties`, put `'component'` first in `required` and set `'additionalProperties': true`; `ComponentImplementation.schema` is used as written, so a test that compares a generated catalog JSON with a stored copy needs the stored copy regenerated or those keys added. If porting `genui`'s built-in `BasicCatalogItems` example JSON for v0.9 tests, fix three old keys rejected by `a2ui_core`'s strict schemas: `Button` (`"primary": true` -> `"variant": "primary"`), `DateTimeInput` (`"variant": "date"`/`"time"` -> `"enableDate": true`/`"enableTime": true`), and `Tabs` (`tabItems[].label`/`content` -> `title`/`child`, remove `"activeTab"`). |
| `widgetBuilder: (CatalogItemContext itemContext) => ...`                               | `builder: (BuildContext context, ComponentNode<ComponentImplementation> node, ComponentProps props, ChildWidgetBuilder buildChild) => ...`                           | `a2ui_flutter/lib/src/component_implementation.dart`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `itemContext.data` (raw JSON)                                                          | `props` (resolved values)                                                                                                                                            | To pass all resolved properties as a `Map<String, Object?>` to an existing `fromJson` or transformer helper, build `{...?node.context?.componentModel.properties, for (final key in props.keys) key: props.value(key)}` (preferring `node.context?.` over `node.context!`). Reading `componentModel.properties` alone leaves `{"path": "..."}` bindings unresolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `itemContext.id`                                                                       | `node.componentId`; `node.instanceId` for keys                                                                                                                       | `instanceId` is unique per tree position (template children get a suffix).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `itemContext.type`                                                                     | `node.type`                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `itemContext.buildChild(childId, [dataContext])`                                       | `buildChild(props.child('key')!)` / `for (final c in props.children('key')) buildChild(c)`                                                                           | Template children are already expanded into nodes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `itemContext.dispatchEvent(UserActionEvent(...))` after `resolveContext(...)`          | `unawaited(props.action('key')?.call())`                                                                                                                             | Call synchronously from the gesture handler. Ad hoc action not in the schema: `node.context!.dispatchAction({'event': {'name': ..., 'context': {...}}})`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `itemContext.buildContext`                                                             | `context`                                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `itemContext.dataContext`                                                              | `node.context!.dataContext`                                                                                                                                          | Rarely needed; `props` covers declared properties.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `itemContext.getComponent(id)`                                                         | `A2uiSurface.of(context).componentsModel.get(id)`                                                                                                                    | `props.children(key)` / `props.child(key)` include placeholder nodes (`state == NodeState.pending`, `NodeState.unknownType` or `NodeState.cyclic`, `impl == null`); `child.state != NodeState.resolved` replaces `getComponent(id) == null \|\| getCatalogItem(type) == null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `itemContext.getCatalogItem(type)`                                                     | `child.impl`; `A2uiSurface.of(context).defaultCatalog?.components[type]`                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `itemContext.surfaceId`                                                                | `A2uiSurface.of(context).id`                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `itemContext.reportError(error, stack)`                                                | `unawaited(surface.dispatchError(A2uiRendererError(code:, surfaceId: surface.id, message:)))`                                                                        | `surface.dispatchWarning(A2uiWarning(...))` for non-fatal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BoundString(dataContext:, value:, builder:)`                                          | `props.string('key')`                                                                                                                                                | Numbers and booleans are stringified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `BoundNumber`, `BoundBool`, `BoundList`, `BoundObject`, `BoundValue<T>`                | `props.number('key')`, `props.boolean('key')`, `props.list('key')`, `props.value('key')`                                                                             | Null or empty when absent or of another shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `OptionalValueBuilder`                                                                 | none                                                                                                                                                                 | `if (value == null) return const SizedBox.shrink();`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dataContext.subscribe<T>(DataPath)`, `subscribeStream<T>`                             | `props` for declared properties; `A2uiSurface.of(context).dataModel.watch<T>('/abs/path')` → `ReadonlySignal<T?>` for anything else                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dataContext.getValue<T>(DataPath)`                                                    | `surface.dataModel.get('/abs/path')`                                                                                                                                 | Returns `Object?`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `dataContext.update(DataPath(path), value)`                                            | `props.writable('key')?.set(value)`                                                                                                                                  | Null when the agent gave a literal. `set` throws `A2uiDataError` for an unwritable path. Arbitrary path: `node.context!.dataContext.set(relativePath, value)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| genui's implicit write path `<componentId>.value`                                      | `node.context?.dataContext.set('<componentId>.value', value)`                                                                                                        | One key relative to the component's data scope, as genui wrote it. Or render a literal read-only, as the basic inputs other than `TextField` do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dataContext.resolve(value)` (`Stream`)                                                | `node.context!.dataContext.resolveDynamicValue(value)` (one-shot) / `resolveSignal(value)` (reactive)                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ValidationHelper.validateStream(checks, ctx)`, `evaluateConditionStream`              | `props.isValid`, `props.validationErrors`, `props.validationResults`                                                                                                 | The schema must declare `checks`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `resolveContext(dataContext, contextDefinition)`                                       | done by `NodeAction`; manual: `node.context!.dataContext.resolveActionAsync(actionMap)`                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DataContext.nested(DataPath)`, `resolvePath(DataPath)`                                | `dataContext.childContext(relativePath)`, `dataContext.resolvePath(relativePath)`                                                                                    | Paths are JSON Pointer strings. Direct construction is `DataContext(DataModel, FunctionInvoker, String basePath)` (3 positional arguments); prefer `node.context!.dataContext`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `buildWeightedChild(...)`, `ComponentChildrenBuilder`                                  | none                                                                                                                                                                 | `for (final c in props.children('children')) KeyedSubtree(key: NodeKey(c.instanceId), child: Flexible(flex: ..., child: buildChild(c)))`; read a child's weight with `ComponentProps(c.props.peek()).number('weight')`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `A2uiAccessibility`                                                                    | automatic                                                                                                                                                            | `NodeView` applies `accessibility.label/description/live/hidden`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Component(id, type, properties)`, `SurfaceDefinition`                                 | `ComponentModel`, `SurfaceModel`                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `JsonMap`                                                                              | `Map<String, Object?>`                                                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `CatalogItemNotFoundException`                                                         | none                                                                                                                                                                 | Unknown type renders nothing and reports `UNKNOWN_COMPONENT_TYPE` on `surface.onError`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| surface theme (`SurfaceDefinition.theme`)                                              | `A2uiSurface.of(context).theme` (`Map`)                                                                                                                              | v0.9 basic components apply `primaryColor`; custom ones apply their own `Theme`. v1.0 has no theme.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| built-in Markdown in Text                                                              | `A2uiMarkdown(builder: (context, markdown, style) => MarkdownBody(data: markdown), child: A2uiSurface(...))`                                                         | Without it Text strips common Markdown markers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

#### Schemas: `A2uiSchemas` → `CommonSchemas` (v0.9) / `CommonSchemasV1` (v1.0)

| `A2uiSchemas.`                   | v0.9 `CommonSchemas.`                                                             | v1.0                                                               |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `stringReference()`              | `dynamicString`                                                                   | `CommonSchemasV1.dynamicString`                                    |
| `stringReference(enumValues:)`   | `Schema.string(enumValues:)` for literal-only, or an `allOf` with `dynamicString` | same                                                               |
| `numberReference()`              | `dynamicNumber`                                                                   | `CommonSchemasV1.dynamicNumber`                                    |
| `booleanReference()`             | `dynamicBoolean`                                                                  | `CommonSchemasV1.dynamicBoolean`                                   |
| `stringArrayReference()`         | `dynamicStringList`                                                               | `CommonSchemasV1.dynamicStringList`                                |
| `propertyReference()`            | `dynamicValue`                                                                    | `CommonSchemasV1.dynamicValue`                                     |
| `listOrReference(items: X)`      | `Schema.combined(anyOf: [Schema.list(items: X), dataBinding, functionCall])`      | same, from `CommonSchemasV1`                                       |
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
not resolved to a node and the builder receives the id string. Note that
`A2uiSchemas.checkable()` returned `S.list(items: validationCheck())` for the
`'checks'` property itself, whereas `CommonSchemas.checkable` is an enclosing
`Schema.object(properties: {'checks': ...})`; for a `'checks'` entry in a
component's `properties:` map, use `Schema.list(items: CommonSchemas.checkRule)`.
`CommonSchemas.*` are static `Schema` constants (carrying `'commonTypesRef'`
metadata used by `ComponentRefMap`) rather than factory functions; to preserve a
property `description` from `A2uiSchemas.*(description: '...')`, use
`Schema.fromMap({...CommonSchemas.dynamicString.value, 'description': '...'})`,
and for `A2uiSchemas.stringReference(enumValues: [...])` that must also accept
data bindings, use `Schema.combined(anyOf: [Schema.string(enumValues: [...]), CommonSchemas.dataBinding, CommonSchemas.functionCall])`.

Write such unions with `anyOf`. A genui-style
`oneOf: [literal, dataBinding, functionCall]` whose literal branch is an
object without required keys (or `S.any()`) rejects a `{"path": ...}`
binding, because the binding matches two branches, and the whole
`updateComponents` fails.

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
| `Catalog(items, functions: [MyFn()])`                                                                                  | `v0_9.basicCatalog(openUrl:).derive(catalogId:, addComponents: [...], addFunctions: [MyFn()])`                                                                                                                                                                                                                                                                  |                                                                                                                                                                               |
| `BasicFunctions.all`                                                                                                   | `BasicCatalog.v0_9(locale:, openUrl:).functions.values` or `BasicCatalog.v1_0(...)`; `basicCatalog()` in `a2ui_flutter` bundles them                                                                                                                                                                                                                            | Same 14 names: `required`, `regex`, `length`, `numeric`, `email`, `formatString`, `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`, `openUrl`, `and`, `or`, `not`. |
| `RequiredFunction()`, `RegexFunction()`, `OpenUrlFunction()`, ... (public classes)                                     | `BasicCatalog.v0_9().functions['required']!` and so on                                                                                                                                                                                                                                                                                                          | No public per-function classes.                                                                                                                                               |
| `OpenUrlFunction` (launches through `url_launcher` itself)                                                             | `openUrl: (Uri url) => launchUrl(url)` passed to `basicCatalog()`                                                                                                                                                                                                                                                                                               | Throws `A2uiExpressionError` without a callback; only `http`, `https`, `mailto`, `tel`. The app owns the `url_launcher` dependency.                                           |
| `formatNumber(value, decimalPlaces, useGrouping)`, `formatCurrency(value, currencyCode)`, `formatDate(value, pattern)` | `formatNumber(value, decimals, grouping)`, `formatCurrency(value, currency, decimals, grouping)`, `formatDate(value, format)`                                                                                                                                                                                                                                   | Argument names changed; update prompts and fixtures.                                                                                                                          |
| (none)                                                                                                                 | `allowedCallers` (`AllowedCallers.rendererOnly`, `agentOnly`, `rendererOrAgent`), `requiresUserActivation`                                                                                                                                                                                                                                                      | Enforced locally on every version.                                                                                                                                            |
| (none)                                                                                                                 | `processor.callAgentFunction(surfaceId, FunctionCall(call:, args:), options: CallOptions(...))`                                                                                                                                                                                                                                                                 | v1.0 only; needs an `outboundListener`.                                                                                                                                       |

### 4. Data model, errors, logging, other re-exports

| genui                                                                                                                                                                                                          | New                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataModel` (interface), `InMemoryDataModel()`, `InMemoryDataModel.wrap`                                                                                                                                       | `DataModel([Object? initialData])` (concrete)                                                                                                                                              | `a2ui_core/lib/src/core/data_model.dart`. Surfaces own one at `surface.dataModel`. A subclass or wrapper must handle `watch` (and `has`, `delete`) as well as `get`, `set` and `subscribe`: `DataContext.resolveSignal`, which binds every property, reads through `watch`.                                                                                                                                                                                                                                                                           |
| `DataPath('/a/b')`, `.segments`, `.join`, `.basename`, `.dirname`                                                                                                                                              | `String` JSON Pointer; `DataModel.resolvePath(path, basePath)`                                                                                                                             | No `DataPath` class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dataModel.update(DataPath, value)`                                                                                                                                                                            | `dataModel.set(path, value)`                                                                                                                                                               | `set(path, null)` deletes; `set('/', map)` replaces the root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dataModel.getValue<T>(DataPath)` (throws `DataModelTypeException`)                                                                                                                                            | `dataModel.get(path)` → `Object?`; `dataModel.has(path)`                                                                                                                                   | Cast yourself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `dataModel.subscribe<T>(DataPath)` → `ValueNotifier<T?>`                                                                                                                                                       | `dataModel.watch<T>(path)` → `ReadonlySignal<T?>`; `dataModel.subscribe<T>(path, onChange)` → `DataSubscription<T>`                                                                        | `subscribe` does not fire for the current value; read it from `DataSubscription.value`. `effect`, `computed`, `signal` are re-exported from `preact_signals`. Because `DataModel.watch<T>(path)` caches signals via `WeakReference`, a custom `ValueNotifier` adapter built on `watch` must retain active notifiers or subscriptions until `dispose()` (or use `DataModel.subscribe`) so the signal is not garbage-collected while listeners are attached.                                                                                            |
| `dataModel.bindExternalState({path, source, twoWay})`                                                                                                                                                          | none                                                                                                                                                                                       | A listener on the source that calls `set`, and an `effect` on `watch` the other way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `A2uiValidationException(message, {surfaceId, path, json, cause})`                                                                                                                                             | `A2uiValidationError(message, {path, errors, cause, surfaceId})` (code `VALIDATION_FAILED`); subclasses `A2uiIntegrityError` (`INTEGRITY_ERROR`), `A2uiRecursionError` (`RECURSION_ERROR`) | Base class `A2uiError(message, {code, cause, surfaceId, functionCallId})`; `path` exists only on `A2uiValidationError` and `A2uiDataError`, so pattern-match before reading `error.path`.                                                                                                                                                                                                                                                                                                                                                             |
| `A2uiFunctionException(message, {functionName, argumentKey})`                                                                                                                                                  | `A2uiExpressionError(message, {expression, details})` (`EXPRESSION_ERROR`); failures at run time arrive as `A2uiRendererError` with code `EXECUTION_ERROR`                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DataModelTypeException`                                                                                                                                                                                       | `A2uiDataError(message, {path})` (`DATA_ERROR`)                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| (none)                                                                                                                                                                                                         | `A2uiCatalogError(message, {catalogId})` (`CATALOG_ERROR`), `A2uiCatalogResolutionError(message, {catalogId, functionName})`                                                               | `A2uiCatalogError` is thrown for an unknown `catalogId` on `createSurface` (`CATALOG_NOT_FOUND` on the wire). genui's `CatalogItemNotFoundException`, an unknown component type, maps to `UNKNOWN_COMPONENT_TYPE` on `surface.onError`; see the catalogs table.                                                                                                                                                                                                                                                                                       |
| parse failures in the transport                                                                                                                                                                                | `A2uiParseError(message, {rawContent})` (`PARSE_ERROR`)                                                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| (none)                                                                                                                                                                                                         | `A2uiStateError` (`STATE_ERROR`), `A2uiRpcError(message, RpcErrorCode rpcCode)`                                                                                                            | `RpcErrorCode`: `invalidFunctionCall`, `executionError`, `unknownFunction`, `unknownError`, `timeout`, `cancelled`, `disposed`, `duplicate`, `tooManyPending`, `noListener`.                                                                                                                                                                                                                                                                                                                                                                          |
| `ValidationError`, `ValidationHelper`                                                                                                                                                                          | `ValidationResult({valid, message, code, severity})`, `coerceDynamicBoolean`                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CancellationSignal`, `CancellationException`                                                                                                                                                                  | same names                                                                                                                                                                                 | `throwIfCancelled()` added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `genUiLogger` (`Logger('GenUI')`), `configureLogging(...)`                                                                                                                                                     | none                                                                                                                                                                                       | `a2ui_core` logs under `a2ui_core.*` and `a2ui.*` through `package:logging`; attach a `Logger.root.onRecord` listener. Use your own `Logger` for app messages.                                                                                                                                                                                                                                                                                                                                                                                        |
| `JsonBlockParser.parseFirstJsonBlock`, `parseJsonBlocks`, `stripJsonBlock` (`package:genui/parsing.dart`)                                                                                                      | `package:a2ui_agent`: `Parser` (`DirectJsonParser`, `ExpressParser`) with `unwrap`, `compile`, `parseResponse`; `ResponseStream`                                                           | `a2ui_agent` also defines a `TextPart`; alias the import if `genai_primitives` is also imported.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `DebugCatalogView`                                                                                                                                                                                             | none                                                                                                                                                                                       | `dart/a2ui_flutter/a2ui_explorer` is the gallery app; render examples with `A2uiSurface` in a test or dev screen.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `package:genui/test.dart` (`validateCatalogItemExamples`, `createSchemaRegistryWithCommonTypes`)                                                                                                               | none                                                                                                                                                                                       | Use `MessageProcessor(validationConfig: ValidationConfig.strict)` and feed example payloads in a test; see recipe (m). To call `Schema.validate` offline on a `BasicComponents.all` schema (which wraps properties in `allOf` with `$ref`s to `common_types.json` and `#/$defs/CatalogComponentCommon`, whereas `CommonSchemas.*` are already inline `Schema` objects), resolve refs first with `resolveSchemaRefs(schema, {'$defs': v0_9.BasicComponents.api.definitions}, commonTypes: PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9))`. |
| `export 'package:genai_primitives/...'` (`ChatMessage`, `ChatMessageRole`, `TextPart`, `DataPart`, `StandardPart`), `UiPart`, `UiInteractionPart`, `UiPartConstants`, `UiPartExtension`, `UiPartListExtension` | not re-exported                                                                                                                                                                            | Depend on `genai_primitives` directly to keep the chat types, or replace them with `ActionMessage` / `ErrorMessage` JSON and an app-defined envelope.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `export 'package:preact_signals/...'`                                                                                                                                                                          | still available through `a2ui_core` (`signal`, `computed`, `effect`, `batch`, `Signal`, `ReadonlySignal`)                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
  validationConfig: ValidationConfig.relaxed, // what a streamed surface needs
  reportErrorsOnly: true, // bad messages go to processor.model.onError, see recipe (e)
);

void onAgentJson(Object? json) {
  processor.processMessages(json); // a map, a list of maps, or {"messages": [...]}
}

onAgentJson(jsonDecode(body));
```

With `reportErrorsOnly: true`, each message of a batch is parsed and applied
on its own: a rejected one is reported on `processor.model.onError` and the
others still apply, as with genui's one `transport.addChunk` per item.
Without it, `processMessages` reports the error and then throws `A2uiError`,
and a batch fails as a whole: a malformed envelope anywhere rejects the batch
before any message is applied, and a message that fails while being applied
stops the ones after it. An app on the throwing form that wants per-message
failures calls `processMessages(item)` in a loop. `A2uiError implements
Exception`, so place `on A2uiError` _before_ any general `on Exception`
clause (otherwise the analyzer reports `#dead_code_on_catch_subtype`), and
avoid bare `catch (_)` blocks around message ingestion so genuine
`TypeError`s in builders or handlers are not silently swallowed.

`MessageProcessor`'s optional `defaultVersion` parameter does not fill in a
missing `"version"` on message envelopes. It is cross-checked against
`ValidationConfig.targetVersion` and is the version of the `ErrorMessage`
reported for an envelope without a valid `"version"`. Every envelope must
carry `"version"` (`"v0.9"`, `"v0.9.1"` or `"1.0"`). There is no text parser in
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
framing, a `genai_primitives` `DataPart` with genui's MIME type:

```dart
import 'package:genai_primitives/genai_primitives.dart';

const String interactionMimeType = 'application/vnd.genui.interaction+json';

// Was UiInteractionPart.create(jsonEncode(envelope)):
final DataPart part = DataPart(
  utf8.encode(jsonEncode({'interaction': jsonEncode(envelope)})),
  mimeType: interactionMimeType,
);

// Was parts.uiInteractionParts, read as interaction strings:
final Iterable<String> interactions = parts
    .whereType<DataPart>()
    .where((p) => p.mimeType == interactionMimeType)
    .map((p) => (jsonDecode(utf8.decode(p.bytes)) as Map)['interaction'] as String);
```

The batch form
`RendererToAgentMessagePayload.of(message).toJson()` gives
`{"messages": [envelope]}`. When v0.9 and v1.0 surfaces are both live, use
`processor.model.getSurface(action.surfaceId)?.protocolVersion ?? version`
as the version so each surface answers in its own version.

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

`getRendererCapabilities` lists every registered catalog under each
requested version, whatever the catalog's `protocolVersion`. While v0.9 and
v1.0 catalogs are registered together, build each version's capabilities
from its own catalogs, so a v0.9 agent is not offered a v1.0 catalog id:

```dart
final Map<String, Object?> capabilitiesV09 = A2uiRendererCapabilities.forCatalogIds([
  for (final catalog in processor.catalogs)
    // v0.9 catalogs: protocolVersion v0_9, or null for an unversioned one.
    if (!(catalog.protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false)) catalog.id,
]).toJson();
```

#### (e) Report errors to the agent

Before:

```dart
// genui reported everything through onSubmit as
// {"version":"v0.9","error":{"code":"VALIDATION_FAILED"|"INTERNAL_ERROR","surfaceId"?,"path"?,"message"}}
controller.reportError(error, stackTrace);
```

After, one channel:

```dart
// The processor from recipe (a), created with reportErrorsOnly: true.
final Subscription errors = processor.model.onError.subscribe((A2uiRendererError error) {
  final String errorVersion =
      processor.model.getSurface(error.surfaceId ?? '')?.protocolVersion ?? version;
  sendToBackend(ErrorMessage(version: errorVersion, error: error).toJson());
  // {"version":"v0.9","error":{"code":...,"surfaceId":...,"message":...,"path"?:...}}
});
```

`processor.model.onError` receives the errors every surface reports while
rendering or binding (forwarded from `surface.onError`) and the errors
`processMessages` meets for a bad message. `processMessages` maps the latter
with `MessageErrorMapper.map`: wire codes (`CATALOG_ERROR` becomes
`CATALOG_NOT_FOUND`, `RECURSION_ERROR` becomes `RECURSION_LIMIT_EXCEEDED`),
the `surfaceId` taken from the envelope, or `''` when there is none, since
v0.9 requires one. So subscribe there only, and do not build
`A2uiRendererError`s from caught exceptions by hand. Two more places see the
same errors, and an app that forwards from them too sends each error twice:

1. `processMessages` without `reportErrorsOnly` throws the `A2uiError` after
   reporting it. Catch it to stop, not to send it.
2. An `outboundListener` passed to `MessageProcessor` receives the
   `ErrorMessage` of every message `processMessages` rejects (not the
   surfaces' rendering errors).

`processMessagesWithErrors(payload)` also returns the `ErrorMessage`s of
one call, for a caller that wants them inline.

An error for a message with no live surface (an unknown `catalogId`, an
update before `createSurface`) reaches `onError` synchronously, inside
`processMessages`; an error on an existing surface arrives a microtask later.
A listener that starts new work from an error, such as the next model turn,
defers it, for example with `scheduleMicrotask`. `A2uiRendererError` has no
`toString`: log `error.code` and `error.message`, or
`jsonEncode(error.toJson())`.

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

If the backend prompts the model itself and returns its text with A2UI JSON
embedded (what `A2uiTransportAdapter.addChunk(body)` used to pick apart), the
body is not plain JSON. For blocks in `<a2ui-json>` tags,
`DirectJsonParser([myCatalog]).unwrap(body)` from `package:a2ui_agent` splits
it into `TextPart`s and `RawA2uiPart`s; `jsonDecode` each `a2uiRaw` and pass
it to `onAgentJson`. For other wrappers (Markdown fences, custom tags) extract
the blocks in the app, as genui's `JsonBlockParser` did.

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
        // Does not throw: the processor from recipe (a) has reportErrorsOnly: true.
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
  // The model's reply was rejected and the stream has ended.
  read(error.partialResults); // the parts made ready before the failure
}
```

Only the stream's own errors reach the `catch`. A processor that throws
would end the whole reply at the first message it rejects, from inside
`read`; with `reportErrorsOnly: true` the rejection goes to
`processor.model.onError` and the stream goes on. The agent's `state` has
then accepted a message the processor rejected, so the two disagree about
the surface. `RendererState.of(processor)` avoids that for an app that is
both agent and renderer: that state applies each accepted message to the
processor itself, so the `A2uiPart` branch does nothing and the processor
must receive no messages from anywhere else.
`dart/a2ui_flutter/example_v0_9/lib/chat_session.dart` is a complete
`ChangeNotifier` that replaces `Conversation` for this case. Points to check:

1. With `RendererState.of`, the stream applies a reply's messages during
   `feed()`, before the caller handles the parts it returns, so a surface the
   app appends from `onSurfaceCreated` shows before the text the model wrote
   ahead of it. When that order matters, use `agent.createState()` and call
   `processMessages` for each `A2uiPart`, as above.
2. Apply each message once. Code that both streamed a reply through
   `A2uiTransportAdapter` and parsed the whole reply again (or passed one
   message to `handleMessage` and to `addChunk`) relied on genui's
   duplicate-`createSurface` errors going unnoticed. If the app has a
   fallback parser of its own, run it only on the text outside the
   `<a2ui-json>` blocks (the `TextPart`s): a regex over the tagged text also
   matches the components inside them.
3. `partialResults` is an extension, `A2uiErrorPartialResults`, so a `show`
   list on the `package:a2ui_agent/a2ui_agent.dart` import must name it.

Case 3, a package implements genui's `Transport` for one or more model
providers, so that apps pass it to `Conversation`. Keep the package's class
and the shape of its `incomingText` and `incomingMessages` streams, drop
`implements Transport`, and replace genui inside it. Take an `a2ui_core`
`CatalogApi`, which an app's `CatalogImplementation` is, so the package does
not depend on a Flutter renderer:

```dart
import 'dart:async';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

final A2uiRequestProcessor agent = A2uiGenerator(
  catalogs: [CatalogConfig(catalog)],
  inferenceFormatFactory: const DirectJsonFormatFactory(
    allowedMessages: ['createSurface', 'updateComponents'], // was SurfaceOperations.createOnly
    bufferIncompleteComponents: true, // emit whole components, as genui did
  ),
).createProcessor(
  A2uiRendererCapabilities.forCatalogIds(
    [catalog.id],
    version: catalog.protocolVersion ?? A2uiProtocolVersion.v0_9,
  ),
);
final String systemPrompt = [...appFragments, agent.promptSnippet].join('\n\n');

final texts = StreamController<String>.broadcast(); // incomingText
final messages = StreamController<AgentToRendererMessage>.broadcast(); // incomingMessages

// For each reply. A canvas passes the RendererState it keeps.
final ContinuingResponseStream reply = agent.openContinuingStream();
void deliver(List<StreamPart> parts) {
  for (final StreamPart part in parts) {
    switch (part) {
      case TextPart(:final text):
        texts.add(text);
      case A2uiPart(:final a2ui):
        a2ui.forEach(messages.add);
      case ErrorPart(:final error): // a rejected block; the reply reads on
        messages.addError(error);
    }
  }
}
await for (final String chunk in modelChunks) {
  deliver(reply.feed(chunk));
}
deliver(reply.close());
```

The app then feeds each message to its renderer with
`processor.processMessages(AgentToRendererMessagePayload.of(message))`.
Points to check in such a package:

1. `feed` and `close` throw only for an error other than a rejected block,
   and the reply ends there: deliver the error's `partialResults`, send the
   error, and feed that reply nothing more.
2. genui's prompt asked for markdown-fenced JSON, and its parser read any
   balanced JSON object in the text, fenced or bare. The direct JSON format
   asks for a JSON array in `<a2ui-json>` tags and reads a bare JSON object as
   text. An option that pins the reply to one JSON object, such as OpenAI's
   `response_format: {"type": "json_object"}`, leaves no room for the tags:
   turn it off in the package's examples, and say so in the change
   description.
3. `sendRequest(ChatMessage)` becomes `sendRequest(String)` for the user's
   turn. genui sent actions and renderer errors through `onSubmit` as
   `ChatMessage`s with empty text and the JSON in a `UiInteractionPart`, and
   `Conversation` passed them on. A transport or `A2uiTransportAdapter(onSend:)`
   callback that sent `message.text` therefore sent empty turns or dropped
   them. Check what the old code sent before adding forwarding of actions or
   errors. A transport that did read actions out of the parts needs its own
   method taking an `A2uiRendererAction`; `action.toJson()` gives the object
   genui put under `"action"`.
4. A package that only builds the prompt and returns the model's raw text,
   which apps parsed with `A2uiTransportAdapter`, exposes its
   `A2uiRequestProcessor`: the reply has to be read by a stream of the same
   processor, with the same format and catalogs.
5. No SDK reads genui's reply format (fenced or bare JSON). A transport that
   never calls a model, such as a mock or a replay of text recorded with
   genui, keeps a copy of genui's parser with genui's BSD license notice, or
   replays recordings made in an `a2ui_agent` format through the app's
   `ResponseStream`.
6. `a2ui_agent` trims the whitespace around a block, so text parts joined
   across a block run together.
7. Output-format rules the app wrote into its prompt (for example "two bare
   JSON objects, one per line") contradict the `<a2ui-json>` format; rewrite
   them. `PromptBuilder.chat` amounted to create-only `allowedMessages`, the
   line against updating earlier surfaces, and the `TechnicalPossibilities`
   defaults (no code execution, tool calls or function calls).
   `DirectJsonPromptGenerator([catalog], allowedMessages: [...]).generate()`
   gives the snippet alone. A package that must keep markdown-fenced replies
   can convert the tagged blocks it gets with
   `DirectJsonParser(const []).unwrap(text)`.
8. A transport that took the system prompt as a string, built by a helper
   from the catalog, now needs the catalog as well, because the parser must
   use the same catalogs and format as the prompt. Build both from one
   factory so they cannot drift. A transport built around
   `A2uiTransportAdapter(onSend:)` rather than `implements Transport`
   replaces its `transport` getter with `sendRequest`, `incomingText` and
   `incomingMessages` on its own class.
9. A transport that JSON-encoded the message parts sent actions and errors
   as base64 data URIs, because that is what `DataPart.toJson()` writes.
   Rebuild the same `DataPart` (recipe (c)) if the bytes the model sees must
   not change.
10. A stream-level repair layer written for genui's format (one that finds
    fenced or bare JSON and fixes it) must follow the `<a2ui-json>`
    delimiter, or it strips the tags from a fenced block and never closes a
    truncated one. `a2ui_agent` 0.2.0 already repairs trailing commas, raw
    line breaks and curly quotes in strings, and strips a fence inside the
    tags; it rejects single quotes and comments, and keeps a fence around
    the tags as text.
11. Send `a2ui_agent`'s rejected blocks (`ErrorPart` holding an
    `A2uiError`) back to the model with `MessageErrorMapper.map(error)`,
    which returns the wire `ErrorMessage`.

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

An input whose `value` is a literal has no binding to write to; step 4 lists
the choices. An action that is not in the schema can still be sent, though
declaring it is better because the agent then sees it in the catalog:

```dart
// Before:
itemContext.dispatchEvent(UserActionEvent(
  name: 'rated',
  sourceComponentId: itemContext.id,
  context: {'stars': stars},
));

// After: the values must already be resolved. The action reaches onAction
// synchronously, with sourceComponentId set to the component's id.
unawaited(node.context?.dispatchAction({'event': {'name': 'rated', 'context': {'stars': stars}}}));
```

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
      // Child references: top-level properties of the common types, or such
      // properties of the objects in a top-level array (like Tabs's tabs[].child).
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
final CatalogImplementation baseCatalog = v0_9.basicCatalog(openUrl: launchUrl);

// A v0.9 surface has one catalog, so each keeps the basic functions, theme
// schema and definitions; derive keeps them and replaces 'Text' by name.
CatalogImplementation myCatalog(String id) => baseCatalog.derive(
  catalogId: id,
  addComponents: [myText, rating, panel],
  instructions: myInstructions, // derive drops them; the v0.9 basic catalog has none
);

final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [
    myCatalog('https://example.com/catalog.json'),
    myCatalog('https://example.com/legacy.json'), // the alias
    baseCatalog,                                  // if the agent also sends the basic id
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
            // Checked before they are resolved: Schema.number() would reject {"path": ...}.
            properties: {'price': CommonSchemas.dynamicNumber, 'rate': CommonSchemas.dynamicNumber},
            required: ['price', 'rate'],
          ),
        );

  @override
  Object? execute(Map<String, dynamic> args, DataContext context, [CancellationSignal? signal]) =>
      (args['price'] as num) * (1 + (args['rate'] as num)); // args are resolved and schema-checked
}

final catalog = v0_9.basicCatalog(openUrl: launchUrl).derive(
  catalogId: myId,
  addComponents: [rating, panel],
  addFunctions: [AddTaxFunction()], // kept beside the basic functions
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
// {"functionCall": {"@call": "selectTab", "args": {"tab": "x"}}} on v1.0.
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

CatalogImplementation _catalog() => v0_9.basicCatalog().derive(
  catalogId: _catalogId,
  components: ['Column', 'Text'], // the basic components the test uses
  addComponents: [rating],
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
  processor.model.onError.subscribe(errors.add);
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
through `SurfaceModel` and `NodeResolver`. This works only for a component
that does not call `A2uiSurface.of(context)` (`Rating` from recipe (h) does);
test such a component with the harness above. Dispose the resolver before
the surface: teardowns run in reverse order of registration.

```dart
final surface = SurfaceModel<ComponentImplementation>(
  's1',
  defaultCatalog: myCatalog,
  rootId: 'root',
);
final resolver = NodeResolver<ComponentImplementation>(surface);
addTearDown(surface.dispose);
addTearDown(resolver.dispose);
surface.componentsModel.addComponent(ComponentModel('root', 'Rating', data));
final node = resolver.rootNode.peek()!;
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

Unsubscribe first. `processor.dispose()` fires `onSurfaceDeleted`
synchronously for every surface, so a listener that calls `setState` and is
still subscribed when `State.dispose()` runs trips the
`setState() called after dispose()` assertion.

## Behavior changes

Each row names what `genui`'s
`SurfaceController` and `Surface` did, what `a2ui_core`'s `MessageProcessor`
and `a2ui_flutter`'s `A2uiSurface` do instead, and what the app has to do
about it. Check every row against the app during step 2 and step 3 of the
guide.

### Message processing

| Topic                                                          | genui                                                                                                                                                                                                                               | a2ui_core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing or unknown `catalogId` on `createSurface`              | An unknown `catalogId` got an empty stub catalog and the surface was created; `Surface` then showed `FallbackWidget`. A missing one failed in `A2uiMessage.fromJson`.                                                               | On v0.9, a missing `catalogId` throws `A2uiValidationError` in `AgentToRendererMessage.fromJson` and an unknown `catalogId` throws `A2uiCatalogError` (code `CATALOG_ERROR`); in both cases the surface is not created. `processor.catalogs` cannot be extended afterwards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Register every id the agent may send, including aliases and the legacy basic catalog id. Catch the error and send an `ErrorMessage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Catalog version mismatch                                       | n/a                                                                                                                                                                                                                                 | A catalog with `protocolVersion: v1_0` rejects a v0.9 `createSurface`, and a catalog with no `protocolVersion` rejects a v1.0 one (`A2uiCatalogError`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Register a catalog per protocol version the agent uses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Update before create / duplicate `createSurface`               | Buffered `updateComponents` / `updateDataModel` for an unknown surface and replayed them when it appeared (dropped after `pendingUpdateTimeout`). A duplicate `createSurface` threw `A2uiStateError`, which was sent on `onSubmit`. | Updating an unknown surface and a duplicate `createSurface` for an existing `surfaceId` both throw `A2uiIntegrityError` (`INTEGRITY_ERROR`, a subclass of `A2uiValidationError`); the message is dropped and, unless the processor has `reportErrorsOnly: true`, the rest of that `processMessages` batch is not applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | If the backend can reorder messages or reuse a `surfaceId`, buffer updates keyed by surface id until `createSurface` arrives, delete an existing surface before processing a duplicate `createSurface`, and use `reportErrorsOnly: true` (or process messages one at a time) so one failure does not stop the others.                                                                                                                                                                                                                                                                                                                      |
| `deleteSurface` for an unknown id                              | Error reported.                                                                                                                                                                                                                     | Silent no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `version` field                                                | Required and had to be exactly `"v0.9"`.                                                                                                                                                                                            | Required on every envelope; accepted values are `"v0.9"`, `"v0.9.1"` and `"1.0"`. `defaultVersion` does not fill a missing one. An envelope with a key other than `version` and one message body is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing for well-formed traffic. An app that added `"version"` itself keeps doing so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Empty `surfaceId`                                              | Rejected with `VALIDATION_FAILED`.                                                                                                                                                                                                  | Not rejected; a surface with id `""` is created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Validate in the app if it mattered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Empty `updateComponents.components` / component `metadata` key | Accepted `"components": []` as a no-op; treated `'metadata'` on a component as a normal property in `itemContext.data`.                                                                                                             | `AgentToRendererMessage.fromJson` rejects `"components": []` with `A2uiValidationError`. `MessageProcessor` treats `'id'`, `'component'`, `'catalogId'`, and `'metadata'` as component envelope fields on all versions, validating `'metadata'` as component metadata, in which only the key `extensions` is allowed, and stripping it from `ComponentModel.properties` (`props`) into `ComponentModel.metadata`. On v0.9 too, a catalog property named `metadata` therefore cannot be received: `{"metadata": {"source": "crm"}}` rejects the whole component (`a2ui_core` 0.6.0; a bug, [#4137](https://github.com/a2ui-project/a2ui/issues/4137)).                                                                                                                      | Skip `"updateComponents"` messages with an empty `"components"` list before `fromJson` / `processMessages`. If a v0.9 custom component uses a property named `'metadata'` (such as a string subtitle or arbitrary map), rename that key on the decoded component map before `processMessages` and read the renamed key in the builder. A package whose property names come from its users, such as a catalog compiler, cannot rename; document `metadata` as reserved.                                                                                                                                                                     |
| Validation of components                                       | Asynchronous JSON Schema validation after each `updateComponents`; failures reported but the update stayed applied. Unknown component types rendered `FallbackWidget`.                                                              | Synchronous, before the update applies; a failing component rejects the whole message. Duplicate ids and declared properties are always checked against every keyword of their schema (type, enum, `required`, `minimum`/`maximum`, and `null` against a `type`). `ValidationConfig.strict` (`allowUnknownElements: false`) also rejects unknown types and undeclared properties, unless the schema sets `additionalProperties: true`, and requires a root, resolvable references and reachability. `relaxed` and no config accept unknown types, and undeclared properties only on open schemas: the v0.9 basic catalog components are closed, and an authored `additionalProperties: false` is enforced (genui 0.10's `CatalogItem.dataSchema` replaced it with `true`). | Use `ValidationConfig.relaxed` in the app (a surface streamed in pieces fails `strict`) and `ValidationConfig.strict` in tests of your own components. genui 0.10's `CatalogItem.dataSchema` added `additionalProperties: true` (0.9's did not): code or tests that send extra properties under `strict` set it on `ComponentImplementation.schema` or declare them, for example `weight` and `accessibility` (`CommonSchemas.componentCommon` declares the latter). `a2ui_agent` rejects undeclared properties as `strict` does. Search the schemas for `additionalProperties: false`, which genui ignored and every config now enforces. |
| Reply format                                                   | The prompt asked for markdown-fenced JSON; the parser read any balanced JSON object in the reply, fenced or bare.                                                                                                                   | `a2ui_agent` writes the Express format unless given another. `DirectJsonFormatFactory` asks for a JSON array in `<a2ui-json>` tags, and reads a bare JSON object as text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Use `DirectJsonFormatFactory` to stay with JSON. Turn off options that pin the reply to one JSON object (recipe (f), case 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Basic catalog rules in prompts                                 | `BasicCatalogItems.asCatalog()` put `basicCatalogRules` in the catalog's `systemPromptFragments`, so `PromptBuilder` added them to every prompt.                                                                                    | The v0.9 basic catalog has no `instructions`: `v0_9.BasicComponents.api.instructions` and `v0_9.basicCatalog().instructions` are null (`a2ui_core` 0.5.0 and 0.6.0, `a2ui_flutter` 0.1.0 and 0.2.0). Only the v1.0 basic catalog has them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Expect the rules to leave the prompt, also where code passes `instructions: v0_9.BasicComponents.api.instructions`. Write the app's own `instructions` if the agent needs rules; do not copy genui's, whose markdown-fenced JSON examples contradict the `<a2ui-json>` format.                                                                                                                                                                                                                                                                                                                                                             |
| Unreachable components                                         | Components not reachable from `root` were kept and never drawn.                                                                                                                                                                     | `a2ui_agent`'s stream checks the tree when a block closes and reports the components not reachable from `root` as one `INTEGRITY_ERROR`; the messages it already emitted stay applied. A renderer with `ValidationConfig.relaxed` does not check reachability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Expect new errors from prompts or catalog instructions that list components without a parent; give the root a child list, or drop the extra components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Theme                                                          | Stored and applied.                                                                                                                                                                                                                 | On v0.9 the `theme` of `createSurface` is validated against the catalog's `themeSchema` and an invalid theme rejects the message: the basic catalog requires `primaryColor` to match `^#[0-9a-fA-F]{6}$` and `iconUrl` to be a URI. v1.0 has no theme.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass `themeSchema` from `v0_9.BasicComponents.api` to a v0.9 catalog that the agent themes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Multiple protocol versions                                     | v0.9 only.                                                                                                                                                                                                                          | One processor routes each envelope by its `version`. Each surface records its `protocolVersion`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Use `processor.model.getSurface(surfaceId)?.protocolVersion ?? version` as the version of `ActionMessage` and `ErrorMessage` when both versions are live (recipes (c) and (e)).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Actions and errors

| Topic                     | genui                                                                                                                                 | a2ui_core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where actions arrive      | `onSubmit`, as a `ChatMessage` with a `UiInteractionPart` holding `{"version":"v0.9","action":{...}}`.                                | `processor.model.onAction` (or `MessageProcessor(onAction: ...)` / `surface.onAction`) as `A2uiRendererAction`. `ActionMessage(version:, action:).toJson()` gives the same inner JSON, with a UTC `timestamp` and optional `userMessage`, `catalogId`, `metadata`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Subscribe, build the envelope, send it with the framing the backend expects. If a strict v0.9 backend or relay rejects v1.0 keys (`catalogId`, `userMessage`, `metadata`), serialize only `name`, `surfaceId`, `sourceComponentId`, `timestamp`, and `context`.                                                                                                                                                                                                 |
| Local handling of actions | `ActionDelegate.handleEvent` returned `true` to swallow an event.                                                                     | No delegate; nothing is sent unless the app sends it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Branch on `action.name` (and `action.surfaceId` for per-surface policies such as suppressing events from inactive turns or overlays) in the listener. No `BuildContext` is passed; capture what the handler needs.                                                                                                                                                                                                                                              |
| Malformed actions         | Non-action `UiEvent`s were dropped.                                                                                                   | A `functionCall` action or a missing `name` dispatched through `surface.dispatchAction` is reported as an `INVALID_ACTION` error, not an action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing for components written against `props.action`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Where errors arrive       | `onSubmit`, with codes `VALIDATION_FAILED`, `INTERNAL_ERROR` or `FUNCTION_EXECUTION_FAILED` and an optional `functionName`.           | `processor.model.onError`, as `A2uiRendererError` with wire codes, in a microtask after the failure, or synchronously for a message without a live surface (recipe (e)). It carries the errors surfaces report while rendering (also on `surface.onError`), such as `UNKNOWN_COMPONENT_TYPE`, `UNKNOWN_CATALOG`, `CYCLIC_REFERENCE`, `INVALID_ACTION`, `EXECUTION_ERROR` and `EXPRESSION_ERROR`, and the errors of messages `processMessages` rejects: `VALIDATION_FAILED` (with a path), `SCHEMA_VALIDATION_FAILED` (without one), `CATALOG_NOT_FOUND`, `INTEGRITY_ERROR`, `RECURSION_LIMIT_EXCEEDED`, `STATE_ERROR`, `DATA_ERROR`. Without `reportErrorsOnly: true`, `processMessages` then also throws the `A2uiError`. No `functionName`. | Forward errors from `processor.model.onError` alone (recipe (e)). Schema validation, which `genui` ran asynchronously after `handleMessage`, now runs inside `processMessages`, so its failures arrive before the surface changes. A listener that starts new work, such as a model turn, defers it. A second listener on `surface.onError`, an `outboundListener` that also sends errors, or a `catch` that reports the thrown `A2uiError` sends errors twice. |
| `A2uiRendererError` shape | Any fields.                                                                                                                           | The constructor throws for code `VALIDATION_FAILED` without a non-empty `path` and a `surfaceId`, or with `details`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Errors from `processor.model.onError` already satisfy this. Only an error the app builds itself (for `surface.dispatchError`) needs a path and a surface id for `VALIDATION_FAILED`, or another code.                                                                                                                                                                                                                                                           |
| Error from a function     | `A2uiFunctionException` → `FUNCTION_EXECUTION_FAILED`.                                                                                | `A2uiExpressionError` for bad arguments; a function that throws at run time is reported as `EXECUTION_ERROR` on `surface.onError`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing beyond re-wiring.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Listener exceptions       | Propagated.                                                                                                                           | Logged at `severe` under `a2ui.EventNotifier` and swallowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Watch the log while migrating.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Builder exceptions        | `Surface` caught an exception thrown by a `widgetBuilder`, reported it as `INTERNAL_ERROR` on `onSubmit` and showed `FallbackWidget`. | `NodeView` calls the builder without a `catch`, so the exception is a Flutter build error and the agent is not told.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Catch in builders that can throw, and report through `A2uiSurface.of(context).dispatchError` if the agent should hear about it.                                                                                                                                                                                                                                                                                                                                 |

### Rendering

| Topic                                 | genui                                                                                                                                                                                                                            | a2ui_flutter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the root arrives               | `defaultBuilder`, else nothing.                                                                                                                                                                                                  | Since `a2ui_flutter` 0.1.0 the surface renders nothing until its root arrives, and pending, unknown-type and cyclic children render nothing and take no layout space (`Row`, `Column` and `List` skip them); unknown types and cycles are reported as `UNKNOWN_COMPONENT_TYPE` and `CYCLIC_REFERENCE` on `surface.onError`. Earlier releases showed a `LoadingPlaceholder` (an indeterminate `CircularProgressIndicator`) for the missing root and pending children, and a red diagnostic `Text` for unknown or cyclic ones.                                                                                                                                                                                    | Wrap `A2uiSurface` in the app's own placeholder logic if needed (see the `Surface` row of the API mapping). On a release that still shows `LoadingPlaceholder`, `tester.pumpAndSettle()` times out when a surface has no `root` (including when `updateComponents` failed schema validation), so guard the widget until the root exists or send a root in the test.                                                                                                                           |
| Markdown                              | Rendered by the Text component.                                                                                                                                                                                                  | Rendered only inside `A2uiMarkdown(builder: ...)`; otherwise body Text strips common markers and heading or caption Text never uses the builder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Wrap the surface in `A2uiMarkdown` with a Markdown widget.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `openUrl`                             | The package launched the URL itself.                                                                                                                                                                                             | Fails unless the app passes `openUrl:` to `basicCatalog()`; only `http`, `https`, `mailto`, `tel`. On v0.9 a bound `openUrl` call runs whenever it resolves; on v1.0 only from an action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass `openUrl: launchUrl` for an agent you trust; depend on `url_launcher` directly.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Theme and Material sub-themes         | `Surface` did not apply `createSurface.theme.primaryColor` unless the host read it; `Card` passed `color: colorScheme.surface`; `Button` used `ElevatedButton` for both `primary` and default; `ChoicePicker` used `ChoiceChip`. | v0.9 basic components wrap their subtree in `BasicTheme`, which seeds `ColorScheme.fromSeed(seedColor: primaryColor)` whenever `createSurface.theme.primaryColor` is set; a custom component gets the surface theme through `A2uiSurface.of(context).theme`. `Card` omits `color:` and relies on `cardTheme.color` (`surfaceContainerLow` in M3); `Button` uses `FilledButton` (`filledButtonTheme`) for `variant: 'primary'`, `OutlinedButton` (`outlinedButtonTheme`) for default, and `TextButton` (`textButtonTheme`) for `variant: 'borderless'`; `ChoicePicker` with `displayStyle: 'chips'` uses `FilterChip` (`chipTheme`) for `variant: 'multipleSelection'` and `ChoiceChip` for `mutuallyExclusive`. | Strip `createSurface.theme.primaryColor` before `processMessages` if the host enforces its own `ColorScheme`, and configure `cardTheme`, `filledButtonTheme`, `outlinedButtonTheme`, `textButtonTheme`, and `chipTheme` in the host `ThemeData` to preserve visual styling.                                                                                                                                                                                                                   |
| Flexible children                     | A `CatalogItem` with `isImplicitlyFlexible` received `weight: 1` from `Row` and `Column`.                                                                                                                                        | `BasicComponents.row` and `.column` build a `Flex` widget (`direction: Axis.horizontal` / `Axis.vertical`, spacing `8.0` vs `genui`'s `16.0` on `Row`), not `Row` or `Column` subclasses, and wrap every child in `Flexible` (`flex: 0` when unweighted in a `Column` or when keeping its own width in a `Row`; `flex: 1, fit: FlexFit.loose` for unweighted children in a bounded `Row` without weighted siblings; and `flex: (weight * 100).round(), fit: FlexFit.tight` when `weight` is set). `TextField` is wrapped in a `LimitedBox`.                                                                                                                                                                     | Give widgets that need a bound a `LimitedBox` or `ConstrainedBox`; never use `Expanded` under an unbounded axis. In widget tests, match `Flex` with a `direction` predicate instead of `find.byType(Row)` / `find.byType(Column)`, use `.first` when finding the nearest `Flexible` ancestor, expect `flex: 100` for `weight: 1`, and note that `find.byKey(NodeKey(childId))` matches two widgets in `Row`/`Column` (the outer `KeyedSubtree` wrapping `Flexible` and the inner `NodeView`). |
| `Column` alignment and `Text` padding | `Column` defaulted `align` to `start`; `Text` with a heading `variant` (`h1`–`h5`) was wrapped in `EdgeInsets.symmetric(vertical: 8.0)`.                                                                                         | v0.9 `BasicComponents.column` defaults `align` to `stretch` when the cross axis is bounded, so children such as a `Card` fill the available width; heading `Text` has no extra vertical padding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Expect visible layout changes and golden diffs (wider cards, shorter heading blocks). To keep the old look, have the agent send `align: "start"` or wrap the component in the app; otherwise regenerate goldens and tell reviewers it is a visual change.                                                                                                                                                                                                                                     |
| `Image` variants and assets           | `icon` and `avatar` were `32×32`, `smallFeature` `50×50`, `mediumFeature`/default `150×150`, `largeFeature` `400×400`, `header` `width: double.infinity`; non-`http` URLs used `Image.asset`.                                    | `icon` is `24×24`, `avatar` is `40×40` (`ClipOval`), `smallFeature` is `maxWidth: 100`, `largeFeature` is `maxHeight: 400`, `header` is `height: 200`, and `mediumFeature`/default is unconstrained. Only `http://` and `https://` URLs are loaded; any other URL renders `Icon(Icons.broken_image)`.                                                                                                                                                                                                                                                                                                                                                                                                           | Update widget size expectations and goldens; provide a custom `Image` component if the app loads bundled `assets/...` paths.                                                                                                                                                                                                                                                                                                                                                                  |
| Accessibility                         | `A2uiAccessibility` applied by each item.                                                                                                                                                                                        | `NodeView` applies `accessibility.label`, `description`, `live`, `hidden` around every component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Remove `Semantics` wrappers added for those attributes.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rebuild granularity                   | `ValueListenableBuilder` per binding.                                                                                                                                                                                            | A builder reruns when its own node's props change, not when a child's do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A layout that depends on child props subscribes to `child.props`, as the basic `Row` and `Column` do.                                                                                                                                                                                                                                                                                                                                                                                         |
| Surface order                         | `activeSurfaceIds` moved an updated surface to the end.                                                                                                                                                                          | `allSurfaces` keeps creation order; there is no update event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Keep an ordered list in the app if the ordering mattered.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Modal` overlay and dismissal         | Used `showModalBottomSheet` (dismissible via downward drag / `tester.fling`).                                                                                                                                                    | Uses `OverlayPortal` and `BottomSheet(enableDrag: false)` with a `CloseButton` and barrier tap handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | In widget tests, dismiss an open `Modal` by tapping `find.byType(CloseButton)` instead of `tester.fling`. To suppress actions while a turn is non-interactive (including inside an open `Modal` overlay), gate `SurfaceModel.dispatchAction` (and wrap catalog `FunctionImplementation`s if local `functionCall` actions must also be gated) or filter in `onAction`.                                                                                                                         |
| Material                              | Same.                                                                                                                                                                                                                            | `A2uiSurface` and the basic layout components (`Row`, `Column`, `List`) render without Material; the basic input components need a `Material` ancestor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tests pump `MaterialApp(home: Scaffold(body: ...))`. An app on another design system puts a `Material` (from `package:flutter/material.dart`) above surfaces that use the basic inputs.                                                                                                                                                                                                                                                                                                       |

### Data model and functions

| Topic                            | genui                                                                                                               | a2ui_core                                                                                                                                       | What to do                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Paths                            | `DataPath`, slash separated; a `.` was part of a key.                                                               | JSON Pointer strings (`/a/b`). Invalid escapes and prototype-like keys throw `A2uiDataError`.                                                   | Rewrite paths; relative paths resolve through `DataContext.resolvePath`.                                          |
| Unbound input value              | Written to `<componentId>.value`.                                                                                   | Not written anywhere; `props.writable` is null.                                                                                                 | Keep local state in the widget; bind the value in the agent if it must reach the data model or an action context. |
| Typed reads                      | `getValue<T>` threw `DataModelTypeException`.                                                                       | `get` returns `Object?`; `ComponentProps` accessors return null on a type mismatch.                                                             | Cast and null-check.                                                                                              |
| `subscribe`                      | `ValueNotifier` that fired on subscribe.                                                                            | `DataModel.subscribe(path, onChange)` does not fire for the current value; `watch(path)` returns a signal.                                      | Read `.value` once after subscribing if the first value is needed.                                                |
| Function arguments               | Raw `JsonMap`; functions validated themselves.                                                                      | Checked against `argumentSchema` as sent, so a `{"path": ...}` fails `Schema.string()`; resolved and checked again before `execute`.            | Declare bindable arguments with `CommonSchemas.dynamicString` and the like (recipe (k)).                          |
| Asynchronous functions           | `AsynchronousClientFunction` awaited everywhere.                                                                    | A returned `Future` is awaited only when the function runs from an action or an RPC; in a binding the `Future` object itself becomes the value. | Keep binding functions synchronous or reactive (`computed`).                                                      |
| Side effects in functions        | Common pattern (`setValue`, `navigate`).                                                                            | A function in a binding reruns whenever it resolves; `requiresUserActivation: true` makes it fail outside an action.                            | Invoke side-effect functions from actions only, or handle the action in the app.                                  |
| Calls to undeclared functions    | Basic `Button` and `TextField` ran `closeModal` without the catalog declaring it.                                   | Rejected under `ValidationConfig.strict` and by `a2ui_agent`, failing the whole `updateComponents`; otherwise the call fails when it runs.      | Declare a `FunctionImplementation` for each function the agent calls, such as `closeModal`.                       |
| Built-in function argument names | `formatNumber(decimalPlaces, useGrouping)`, `formatCurrency(currencyCode)`, `formatDate(pattern)`                   | `formatNumber(decimals, grouping)`, `formatCurrency(currency, decimals, grouping)`, `formatDate(format)`.                                       | Update prompts, fixtures and goldens.                                                                             |
| Locale                           | Implicit.                                                                                                           | `basicCatalog(locale:)`, default `en-US`.                                                                                                       | Pass the app locale.                                                                                              |
| Logging                          | `genUiLogger`, `configureLogging`.                                                                                  | `package:logging` loggers under `a2ui_core.*` and `a2ui.*`; no configuration helper.                                                            | Listen on `Logger.root.onRecord`.                                                                                 |
| Stored values                    | `updateDataModel` values were kept by reference and mutated in place by later sub-path updates.                     | `DataModel.set` deep-copies the value it stores.                                                                                                | Remove workarounds and test preconditions that relied on the in-place mutation.                                   |
| Schema documents                 | Validation used `json_schema_builder`'s asynchronous `validate`, which can fetch remote schema documents over HTTP. | Validation never does I/O.                                                                                                                      | Remove HTTP clients or bundled meta-schemas kept only for genui's validation.                                     |

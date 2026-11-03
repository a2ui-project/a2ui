# Recipes: before (`genui`) and after (`a2ui_core` + `a2ui_flutter`)

Companion to [`INDEX.md`](INDEX.md). Each recipe shows the genui code and
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

## Renderer wiring

### (a) Create the processor and feed it messages

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

`defaultVersion` does not fill in a missing `"version"`; every envelope must
carry one (`"v0.9"`, `"v0.9.1"` or `"1.0"`). There is no text parser in
`a2ui_core`: an app that extracted JSON from model text with
`A2uiTransportAdapter` moves to `a2ui_agent`, recipe (f).

### (b) Track surfaces and render them

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

### (c) Send actions to the agent

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

### (d) Capabilities and data model in request metadata

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

### (e) Report errors to the agent

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

### (f) Replace `A2uiTransportAdapter` and `Conversation`

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

## Catalogs and components

### (g) Display component

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

### (h) Input component: write-back, action, validation

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

### (i) Container component with children

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

### (j) Custom catalogs

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

## Functions, data model, tests

### (k) Client functions

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

### (l) Read and write a surface's data model from app code

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

### (m) Widget test for a custom component

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

### (n) Dispose

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

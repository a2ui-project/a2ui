# A2UI Flutter

Flutter renderer for [A2UI](https://a2ui.org/) protocol v0.9. It renders the
surfaces of an `a2ui_core` `MessageProcessor` as widget trees, following the
[framework adapter blueprint](../../blueprints/modules/a2ui_framework_adapter.blueprint.md).

A component pairs a schema with a widget builder, and goes in a catalog of
the app's own.

## Installation

`a2ui_flutter` is not published yet, and it needs the node layer of
`a2ui_core`, which no release on pub.dev has. Depend on both from git at the
same commit, and keep the override:

```yaml
dependencies:
  a2ui_core: ^0.2.2
  a2ui_flutter:
    git:
      url: https://github.com/a2ui-project/a2ui.git
      path: dart/a2ui_flutter
      ref: <commit>
  json_schema_builder: ^0.1.7 # for custom component schemas

dependency_overrides:
  a2ui_core:
    git:
      url: https://github.com/a2ui-project/a2ui.git
      path: dart/a2ui_core
      ref: <commit>
```

## Quick Start

The app owns a `MessageProcessor`, feeds it the agent's messages, and renders
each surface the processor creates in an `A2uiSurface`. Actions and errors on
a surface go back to the agent.

```dart
final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [demoCatalog],
  defaultVersion: A2uiProtocolVersion.v0_9,
);
final String version = A2uiProtocolVersion.v0_9.jsonValue;
final surfaces = ValueNotifier<List<SurfaceModel<ComponentImplementation>>>(
  const [],
);

void sendToAgent(RendererToAgentMessage message) => send(
  RendererToAgentMessagePayload.of(message).toJson(),
  metadata: {'a2uiClientDataModel': ?processor.getClientDataModel()},
);

processor.groupModel.onAction.addListener(
  (action) => sendToAgent(ActionMessage(version: version, action: action)),
);
processor.groupModel.onSurfaceCreated.addListener((surface) {
  surface.onError.addListener(
    (error) => sendToAgent(ErrorMessage(version: version, error: error)),
  );
  surfaces.value = [...surfaces.value, surface];
});
processor.groupModel.onSurfaceDeleted.addListener((id) {
  surfaces.value = [
    for (final surface in surfaces.value)
      if (surface.id != id) surface,
  ];
});

void onAgentMessages(Object? json) {
  try {
    processor.processMessages(
      AgentToRendererMessagePayload.fromJson(
        json,
        protocolVersion: A2uiProtocolVersion.v0_9,
      ),
    );
  } on A2uiError catch (error) {
    log('${error.code}: ${error.message}');
  }
}

// In build:
ValueListenableBuilder(
  valueListenable: surfaces,
  builder: (context, surfaces, _) => Column(
    children: [
      for (final surface in surfaces)
        A2uiSurface(key: ObjectKey(surface), surface: surface),
    ],
  ),
);

// On shutdown:
processor.groupModel.dispose();
```

- Send `processor.getClientDataModel()` as `a2uiClientDataModel` in the
  transport metadata of each message to the agent, when it is not null.
- Key each surface's widget by `ObjectKey(surface)`, and remove it when the
  surface is deleted.
- An `onError` listener can run while an `A2uiSurface` builds, so a
  `setState` it causes must wait for the next frame.

## Defining Custom Components

List your components in a `WidgetCatalog` under your own catalog id:

```dart
final rating = ComponentImplementation(
  name: 'Rating',
  schema: Schema.object(
    properties: {
      'label': CommonSchemas.dynamicString,
      'value': Schema.fromMap({
        r'$ref':
            'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/DynamicNumber',
      }),
      'onChanged': CommonSchemas.action,
    },
    required: ['value'],
  ),
  builder: (context, node, props, buildChild) {
    final WritableBinding<Object?>? value = props.writable('value');
    return StarRating(
      label: props.string('label') ?? '',
      value: props.number('value') ?? 0,
      onChanged: value == null
          ? null
          : (stars) {
              try {
                value.set(stars);
                unawaited(props.action('onChanged')?.call());
              } on A2uiDataError catch (error) {
                log('${error.code}: ${error.message}');
              }
            },
    );
  },
);

final demoCatalog = WidgetCatalog(
  id: 'https://example.com/demo/catalog.json',
  components: [rating],
);
```

Declare dynamic values with `CommonSchemas`, or with a `$ref` to a type in
`common_types.json` such as `DynamicNumber` above. Declare child references
(`ComponentId`, `ChildList`) as top-level properties. Advertise the catalog by
its id. An agent that does not use `a2ui_core` can be given its document,
`jsonEncode(demoCatalog.catalogSchema)`.

### Writing a builder

A builder receives the node, its resolved properties as `ComponentProps`, and
a `ChildWidgetBuilder`:

- Read a value with `props.string`, `number`, `boolean` or `value`, whether
  the agent gave a literal or a binding.
- Write a value back through `props.writable(key)`, which is null unless the
  property is bound to a data path. Its `set` throws `A2uiDataError` for a
  path the data model cannot write.
- Run an action with `props.action(key)`. Enable a control only while its
  checks pass, with `props.isValid`, and show `props.validationErrors`.
- Render children with `buildChild`. A builder that wraps each child puts
  `KeyedSubtree(key: NodeKey(child.instanceId), ...)` outermost, so children
  keep their state when the list changes.
- Expect an unbounded height or width, as in a scroll view. Give a widget
  that needs a bound, such as a `TextField`, one with a `LimitedBox`.

## Security

> [!IMPORTANT]
> Treat any agent outside your direct control as untrusted. Its messages and
> UI definitions are untrusted input: a malicious agent could imitate a
> legitimate interface to deceive users, or send layouts heavy enough to
> degrade the app.

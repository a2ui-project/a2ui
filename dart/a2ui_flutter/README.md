# A2UI Flutter

Flutter renderer for [A2UI](https://a2ui.org/) protocol v1.0 and v0.9. It
renders the surfaces of an `a2ui_core` `MessageProcessor` as widget trees,
following the
[framework adapter blueprint](../../blueprints/modules/a2ui_framework_adapter.blueprint.md).

The basic catalog is included. A custom component pairs a schema with a
widget builder, and goes in a catalog of the app's own.

## Installation

`a2ui_flutter` is not published yet, and it needs the node layer of
`a2ui_core`, which no release on pub.dev has. Depend on both from git at the
same commit, and keep the override:

```yaml
dependencies:
  a2ui_core: ^0.4.0
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
each surface the processor creates in an `A2uiSurface`. Actions and errors
on a surface go back to the agent, and so do the function calls and answers
the processor makes.

```dart
late final MessageProcessor<ComponentImplementation> processor;
final String version = A2uiProtocolVersion.v1_0.jsonValue;
final surfaces = ValueNotifier<List<SurfaceModel<ComponentImplementation>>>(
  const [],
);

void sendToAgent(RendererToAgentMessage message) => send(
  RendererToAgentMessagePayload.of(message).toJson(),
  metadata: {'a2uiRendererDataModel': ?processor.getRendererDataModel()},
);

processor = MessageProcessor<ComponentImplementation>(
  catalogs: [basicCatalog()],
  outboundListener: sendToAgent,
);

processor.model.onAction.subscribe(
  (action) => sendToAgent(ActionMessage(version: version, action: action)),
);
processor.model.onSurfaceCreated.subscribe((surface) {
  surface.onError.subscribe(
    (error) => sendToAgent(ErrorMessage(version: version, error: error)),
  );
  surfaces.value = [...surfaces.value, surface];
});
processor.model.onSurfaceDeleted.subscribe((id) {
  surfaces.value = [
    for (final surface in surfaces.value)
      if (surface.id != id) surface,
  ];
});

void onAgentMessages(Object? json) {
  try {
    processor.processMessages(json);
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
processor.dispose();
```

- The basic components are Material widgets. Render surfaces under a
  `MaterialApp` and inside a `Material`, such as a `Scaffold` body.
- Advertise the catalogs by sending
  `processor.getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v1_0])).toJson()`
  as `a2uiRendererCapabilities` in the transport metadata.
- Send `processor.getRendererDataModel()` as `a2uiRendererDataModel` in the
  transport metadata of each message to the agent, when it is not null.
- `outboundListener` receives the `rendererFunctionResponse` answering each
  `callRendererFunction`, and each `callAgentFunction` the processor makes.
- Key each surface's widget by `ObjectKey(surface)`, and remove it when the
  surface is deleted.
- Error listeners may call `setState` directly.
- On macOS, network images and media need the
  `com.apple.security.network.client` entitlement.

Models often write Markdown in Text. To render it, wrap the surface in an
`A2uiMarkdown` with a Markdown package's widget, such as `MarkdownBody` from
`flutter_markdown_plus`:

```dart
A2uiMarkdown(
  builder: (context, markdown, style) => MarkdownBody(data: markdown),
  child: A2uiSurface(surface: surface),
);
```

A Text that no `A2uiMarkdown` renders, which includes every heading and
caption Text, shows its text without common Markdown markers. A body Text
that is one heading line, such as `## Summary`, also takes the style of that
heading level.

## Defining Custom Components

A v1.0 surface draws on several catalogs, so put your components in a catalog
of their own and register it next to the basic catalog. The agent names it in
each component's `catalogId`:

```dart
final rating = ComponentImplementation(
  name: 'Rating',
  schema: Schema.object(
    properties: {
      'label': CommonSchemasV1.dynamicString,
      'value': CommonSchemasV1.dynamicNumber,
      'onChanged': Schema.fromMap({r'$ref': r'common_types.json#/$defs/Action'}),
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

final demoCatalog = CatalogImplementation(
  id: 'https://example.com/demo/catalog.json',
  protocolVersion: A2uiProtocolVersion.v1_0,
  components: [rating],
);

final processor = MessageProcessor<ComponentImplementation>(
  catalogs: [basicCatalog(), demoCatalog],
);
```

Declare dynamic values with `CommonSchemasV1`, and other shared types, such
as `Action` above, with a `$ref` to `common_types.json`. Declare child references
(`ComponentId`, `ChildList`) as top-level properties. Advertise the catalog by
its id. An agent that does not use `a2ui_core` can be given its document,
`jsonEncode(demoCatalog.toJson())`.

### Writing a builder

A builder receives the node, its resolved properties as `ComponentProps`, and
a `ChildWidgetBuilder`:

- Read a value with `props.string`, `number`, `boolean` or `value`, whether
  the agent gave a literal or a binding.
- Write a value back through `props.writable(key)`, which is null unless the
  property is bound to a data path. Its `set` throws `A2uiDataError` for a
  path the data model cannot write.
- Run an action with `props.action(key)`. Each call runs as a user
  activation, which a function such as `openUrl` needs, so call it only from
  a gesture handler, synchronously.
- Enable a control only while its checks pass, with `props.isValid`, and
  show `props.validationErrors`. `props.validationResults` also holds the
  failing checks of `warning` and `info` severity, which leave the control
  valid. Its `ValidationResult` is `a2ui_core`'s, so hide
  `json_schema_builder`'s type of the same name.
- Render children with `buildChild`. A builder that wraps each child puts
  `KeyedSubtree(key: NodeKey(child.instanceId), ...)` outermost, so children
  keep their state when the list changes.
- Expect an unbounded height or width, as in a scroll view. Give a widget
  that needs a bound, such as a `TextField`, one with a `LimitedBox`.

## Basic Catalog Components

`package:a2ui_flutter/basic_catalog.dart` implements the
[v1.0 basic catalog](../../catalogs/basic/v1/catalog.json) with Material
widgets. `basicCatalog()` builds all of it, and `BasicComponents` holds each
component for a catalog of your own.

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`,
  `DateTimeInput`

The functions format for the `locale` passed to `basicCatalog()`, `en-US` by
default. Inputs other than Button show a failing check of `warning` or `info`
severity as a hint under them. A component with an `accessibility.live` of
`polite` or `assertive` is a live region, which announces changes to its own
label: a Text's text, a TextField's label, a Slider's label and value, or
the check message under a CheckBox, ChoicePicker or Slider, but not a
Button's child text, a CheckBox's label or a TextField's value.

Not supported yet:

- A literal `min` or `max` on DateTimeInput, which the `a2ui_core` validator
  rejects.
- Measuring a surface's intrinsic size, as `IntrinsicWidth` and an
  `AlertDialog`'s content do. Give the surface a fixed width there, or use a
  `Dialog`.
- Leaving `video_player` out of an app. Video and AudioPlayer play through
  it.
- An explicit `accessibility.label` in place of the label a control takes
  from its own text. On a Button, CheckBox or Slider the `accessibility`
  attributes go on a node around the control, and on a TextField or Text an
  explicit label is joined to the widget's own label.

## Security

> [!IMPORTANT]
> Treat any agent outside your direct control as untrusted. Its messages and
> UI definitions are untrusted input: a malicious agent could imitate a
> legitimate interface to deceive users, or send layouts heavy enough to
> degrade the app.

`openUrl` fails unless the app passes a callback, such as `url_launcher`'s
`launchUrl`: `basicCatalog(openUrl: launchUrl)`. On v1.0 it runs only from an
action, which the basic components run only from a tap, such as a Button's.
On v0.9 a bound `openUrl` call runs
whenever it resolves, so with a callback the agent can open an `http`,
`https`, `mailto` or `tel` URL without the user acting. Pass one only for an
agent you trust.

## Protocol v0.9

`package:a2ui_flutter/v0_9/basic_catalog.dart` implements the
[v0.9 basic catalog](../../specification/v0_9/catalogs/basic/catalog.json)
under the same names, with the v0.9 differences: Text has the `h1` to `h5`
variants, TextField checks `validationRegexp`, and the components take the
surface theme's `primaryColor` as the Material theme's primary color.

A v0.9 surface has one catalog, so a custom v0.9 component goes in a catalog
with the basic components and functions it needs, under your own id:

```dart
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9;

final demoCatalogV0_9 = CatalogImplementation(
  id: 'https://example.com/demo/v0_9/catalog.json',
  // ratingV0_9 is a component whose schema uses the v0.9 types.
  components: [...v0_9.BasicComponents.all, ratingV0_9],
  functions: BasicCatalog.v0_9().functions.values.toList(),
  themeSchema: v0_9.BasicComponents.api.themeSchema,
  definitions: v0_9.BasicComponents.api.definitions,
);
```

Declare a v0.9 component's dynamic values with `CommonSchemas`.

To serve both versions, register a catalog of each with one processor, which
routes each message by its `version`. Messages to the agent then follow the
version of the surface they concern, its `protocolVersion`. A v0.9 surface's
actions and errors go in `v0.9` envelopes. A v0.9 agent reads
`processor.getRendererDataModel(version: A2uiProtocolVersion.v0_9)` as
`a2uiClientDataModel`, and
`processor.getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9])).toJson()`
as `a2uiClientCapabilities`. Each version's capabilities list every
registered catalog, whatever its protocol version. Once surfaces of both
versions send their data model, `getRendererDataModel()` needs a version,
so a v1.0 agent reads it with `version: A2uiProtocolVersion.v1_0`.

## Tests

`test/catalog/basic/examples_test.dart` renders every
[v1.0 basic catalog example](../../catalogs/basic/v1/examples) and every
[v0.9 one](../../specification/v0_9/catalogs/basic/examples).

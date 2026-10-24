# Genkit

Use this guide to build a full-stack A2UI app in Dart: a
[Genkit Dart](https://genkit.dev/docs/dart/get-started/) agent on the server,
and a Flutter app that renders its surfaces with the
[GenUI SDK](https://docs.flutter.dev/ai/genui), the Flutter renderer for A2UI.

On the server, the [`genkit_a2ui`](https://pub.dev/packages/genkit_a2ui)
plugin adds A2UI to an agent as one middleware, `a2ui()`. The middleware:

- adds your catalog's components to the system prompt,
- extracts the A2UI the model writes and validates it against the catalog,
- streams it to the client as A2UI data parts, next to the text.

On the client, the GenUI SDK's `SurfaceController` renders the surfaces, and
each button press or form submission goes back to the agent as the next turn.

!!! note "Status"

    `genkit_a2ui` is experimental. Its API can change between versions.

This guide builds a reservation assistant for a restaurant called Cymbal
Bistro. The agent checks availability with a tool, shows a booking form, and
confirms the booking when the user submits the form.

## Prerequisites

- The [Flutter SDK](https://docs.flutter.dev/get-started/install) with Dart
  3.12 or later.
- A [Gemini API key](https://aistudio.google.com/apikey) in the
  `GEMINI_API_KEY` environment variable.

## Install

Create a Flutter app and add the packages. The server and the client share
the app's `lib/` directory, so they can share code such as the catalog ID.

```bash
flutter create cymbal_bistro
cd cymbal_bistro
flutter pub add genkit genkit_a2ui genkit_google_genai schemantic genui "a2ui_core:^0.1.0"
flutter pub add dev:build_runner dev:schemantic_builder
```

`genui` 0.10 needs `a2ui_core` 0.1, so pin `a2ui_core` to `^0.1.0`.

Agents are in Genkit's experimental libraries. To silence the analyzer's
warnings about them, add an `errors` entry to the `analyzer` section of
`analysis_options.yaml`:

```yaml title="analysis_options.yaml"
analyzer:
  errors:
    experimental_member_use: ignore
```

## 1. Define the catalog

The catalog lists the components the agent may use. Each component has a
short description and a compact description of its props, written for the
model. Start from the plugin's basic catalog and add the components your app
needs. Here, the form needs a date picker and choice chips.

The server and the client must use the same catalog ID. Put it in a shared
file:

```dart title="lib/shared.dart"
const String bistroCatalogId = 'com.example.a2ui.bistro';
```

```dart title="lib/agent.dart (catalog)"
final A2uiCatalog bistroCatalog = A2uiCatalog(
  id: bistroCatalogId,
  components: [
    ...basicCatalog.components,
    const A2uiCatalogComponent(
      name: 'DateTimeInput',
      description: 'A date and/or time picker.',
      props:
          'value: string or { path } binding (required); variant?: '
          'date|time|datetime; label?: string; min?: string (YYYY-MM-DD); '
          'max?: string (YYYY-MM-DD).',
    ),
    const A2uiCatalogComponent(
      name: 'ChoicePicker',
      description:
          'Lets the user pick one or more options, e.g. a time slot or a '
          'seating area.',
      props:
          'options: { label: string, value: string }[] (required); value: '
          'string, string[] or { path } binding (required); label?: string; '
          'variant?: mutuallyExclusive|multipleSelection; '
          'displayStyle?: checkbox|chips.',
    ),
  ],
);

Future<void> registerCatalogs() =>
    loadCatalog(ai, id: bistroCatalogId, catalog: bistroCatalog);
```

You can also load a catalog from a JSON file with
`loadCatalog(ai, id: ..., file: 'my-catalog.json')`. See the
[`genkit_a2ui` README](https://pub.dev/packages/genkit_a2ui) for the format.

## 2. Define the agent

Register `A2uiPlugin()` on the Genkit instance, then add `a2ui()` to the
agent's `use` list. The tools are ordinary Genkit tools.

```dart title="lib/agent.dart"
import 'package:genkit/experimental.dart';
import 'package:genkit/genkit.dart';
import 'package:genkit_a2ui/a2ui.dart';
import 'package:genkit_google_genai/genkit_google_genai.dart';
import 'package:schemantic/schemantic.dart';

import 'shared.dart';

part 'agent.g.dart';

@Schema()
abstract class $CheckAvailabilityInput {
  @Field(description: 'The restaurant name, e.g. Cymbal Bistro.')
  String get restaurant;
  @Field(
    description:
        'The date for the reservation, e.g. tonight, tomorrow, or YYYY-MM-DD.',
  )
  String get date;
  @Field(description: 'Number of guests.')
  int get partySize;
}

@Schema()
abstract class $CheckAvailabilityOutput {
  String get restaurant;
  String get date;
  int get partySize;
  bool get available;
  List<String> get availableSlots;
  List<String> get seatingAreas;
}

// ConfirmReservationInput and ConfirmReservationOutput are defined the same
// way. See the complete sample.

final Genkit ai = Genkit(plugins: [googleAI(), A2uiPlugin()]);

// bistroCatalog and registerCatalogs() from step 1 go here.

final checkAvailability = ai.defineTool(
  name: 'checkAvailability',
  description: 'Checks table availability at a restaurant for a date.',
  inputSchema: CheckAvailabilityInput.$schema,
  outputSchema: CheckAvailabilityOutput.$schema,
  fn: (input, _) async {
    return .response(
      CheckAvailabilityOutput(
        restaurant: input.restaurant,
        date: input.date,
        partySize: input.partySize,
        available: true,
        availableSlots: ['17:30', '18:00', '19:30', '20:45'],
        seatingAreas: ['Main dining room', 'Patio', 'Bar'],
      ),
    );
  },
);

// confirmReservation is defined the same way and returns a confirmation code.

final uiAgent = ai.defineAgent(
  name: 'uiAgent',
  model: googleAI.gemini('gemini-flash-lite-latest'),
  system:
      'You are the reservation assistant for Cymbal Bistro. Call '
      'checkAvailability, then render an A2UI form (DateTimeInput for the '
      'date, ChoicePicker for time slot and seating area, TextField for '
      'special requests, and a "Book table" Button). When the user submits, '
      'call confirmReservation and render a confirmation Card. Keep prose '
      'brief; put the substance in the UI.',
  tools: [checkAvailability, confirmReservation],
  use: [
    a2ui(catalog: bistroCatalogId, validate: 'strict'),
    retry(),
  ],
  store: InMemorySessionStore(),
);
```

Generate the schema classes:

```bash
dart run build_runner build --delete-conflicting-outputs
```

`a2ui()` takes these options:

| Option         | Default    | Description                                                                            |
| -------------- | ---------- | -------------------------------------------------------------------------------------- |
| `catalog`      | `'basic'`  | The ID the catalog was registered under.                                               |
| `instructions` | `'system'` | Where to add the catalog to the prompt. `'none'` adds nothing.                         |
| `validate`     | `'warn'`   | `'warn'` logs and drops invalid UI, `'strict'` throws, and `'off'` skips validation.   |
| `surfaceId`    | New UUID   | A fixed surface ID to reuse for every surface. By default, each surface gets a new ID. |
| `version`      | `'v0.9'`   | The protocol version written on the messages.                                          |

!!! warning "Validation is not sanitization"

    `validate` checks the message structure and the component types. It
    doesn't check prop values, such as image URLs or Markdown text. Treat
    surfaces as untrusted input: sanitize props in your renderer, and limit
    remote content with a Content Security Policy on the web.

## 3. Serve the agent

`GenkitRouter` serves the agent over HTTP. `addAgent` mounts the turn
endpoint and the snapshot and abort endpoints that the client uses.

```dart title="bin/server.dart"
import 'dart:io';

import 'package:cymbal_bistro/agent.dart';
import 'package:genkit/experimental_io.dart';
import 'package:genkit/io.dart';

Future<void> main() async {
  await registerCatalogs();

  // Mounts /api/uiAgent, /api/uiAgent/getSnapshot, and /api/uiAgent/abort.
  final router = GenkitRouter()..addAgent(uiAgent, path: '/api/uiAgent');

  final server = await router.serve(
    port: int.tryParse(Platform.environment['PORT'] ?? '') ?? 8080,
    // Needed when the Flutter web client runs on another origin.
    cors: const CorsOptions(
      allowedHeaders: ['Content-Type', 'Accept', 'X-Genkit-Stream-Id'],
    ),
  );
  print('Cymbal Bistro agent on http://localhost:${server.port}/api/uiAgent');
}
```

```bash
dart run bin/server.dart
```

If you already run a [Shelf](https://pub.dev/packages/shelf) server, add the
[`genkit_shelf`](https://pub.dev/packages/genkit_shelf) package and mount the
router with `asShelfHandler()` instead of calling `serve()`.

## 4. Render surfaces in Flutter

The client connects to the agent with `remoteAgent` and reads each turn as a
stream. Each chunk can carry text and A2UI messages:

- Show the text in your chat UI.
- Pass the A2UI messages to a GenUI `SurfaceController`. Get them from the
  chunk with `a2uiEnvelopesFromParts`.

The controller's catalog must have the same ID as the server's catalog. The
GenUI basic catalog already renders `DateTimeInput` and `ChoicePicker`, so
re-tag it with the bistro catalog ID:

```dart title="lib/main.dart"
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:flutter/material.dart';
import 'package:genkit/experimental_client.dart';
import 'package:genkit_a2ui/client.dart';
import 'package:genui/genui.dart';

import 'shared.dart';

const String _baseUrl = String.fromEnvironment(
  'AGENT_BASE_URL',
  defaultValue: 'http://localhost:8080',
);

final Catalog _catalog = BasicCatalogItems.asCatalog().copyWith(
  catalogId: bistroCatalogId,
);

class _ChatPageState extends State<ChatPage> {
  late final AgentApi _agent;
  late final AgentChat _chat;
  late final SurfaceController _surfaceController;

  final _surfaceIds = <String>[];
  String _prose = '';

  @override
  void initState() {
    super.initState();
    _agent = remoteAgent(
      url: '$_baseUrl/api/uiAgent',
      getSnapshotUrl: '$_baseUrl/api/uiAgent/getSnapshot',
      abortUrl: '$_baseUrl/api/uiAgent/abort',
    );
    _chat = _agent.chat();
    _surfaceController = SurfaceController(catalogs: [_catalog]);

    // Show each new surface.
    _surfaceController.surfaceUpdates.listen((update) {
      if (update is SurfaceAdded && !_surfaceIds.contains(update.surfaceId)) {
        setState(() => _surfaceIds.add(update.surfaceId));
      }
    });

    // Send button presses and form submissions back to the agent.
    _surfaceController.onSubmit.listen(_onSurfaceSubmit);
  }

  Future<void> _send(String text) => _runTurn(_chat.sendStream(text: text));

  Future<void> _runTurn(AgentTurn turn) async {
    setState(() => _prose = '');
    await for (final chunk in turn.stream) {
      if (chunk.text.isNotEmpty) setState(() => _prose += chunk.text);
      for (final envelope in a2uiEnvelopesFromParts(
        chunk.raw.modelChunk?.content,
      )) {
        _surfaceController.handleMessage(core.A2uiMessage.fromJson(envelope));
      }
    }
    await turn.response;
  }

  // ...
}
```

Render each surface with the `Surface` widget, for example in your chat
list:

```dart
for (final id in _surfaceIds)
  Surface(surfaceContext: _surfaceController.contextFor(id)),
```

## 5. Handle user actions

With A2UI, a user action is the next turn of the conversation. The GenUI SDK
keeps track of the values in the form's inputs. When the user presses
**Book table**, `onSubmit` emits a message that holds the action. Convert it
to an `A2uiClientAction` and send it to the agent with `actionToMessage`:

```dart title="lib/main.dart"
Future<void> _onSurfaceSubmit(ChatMessage message) async {
  final action = _actionFromSubmit(message);
  if (action == null) return;
  await _runTurn(_chat.sendStream(message: actionToMessage(action)));
}

/// GenUI reports an action as a UI interaction part whose payload is
/// {"version": ..., "action": {name, surfaceId, sourceComponentId,
/// timestamp, context}}.
A2uiClientAction? _actionFromSubmit(ChatMessage message) {
  for (final part in message.parts) {
    final interaction = part.asUiInteractionPart?.interaction;
    if (interaction == null) continue;
    final decoded = jsonDecode(interaction);
    final action = decoded is Map ? decoded['action'] : null;
    if (action is Map) {
      return A2uiClientAction.fromJson(action.cast<String, dynamic>());
    }
  }
  return null;
}
```

The agent receives the action's name and its `context`, which holds the
values the user chose:

```json
{
  "action": {
    "name": "confirmReservation",
    "context": {
      "restaurant": "Cymbal Bistro",
      "date": "2026-09-16",
      "time": ["19:30"],
      "partySize": 4,
      "seatingArea": ["Patio"],
      "specialRequests": ""
    }
  }
}
```

It calls `confirmReservation` and streams a confirmation card back.

!!! tip "Inputs need bindings"

    Inputs don't send their values on their own. The model must bind each
    input's `value` to a data path, such as `{"path": "/time"}`, and list the
    same paths in the button's `action.event.context`. The catalog
    instructions that `a2ui()` adds to the prompt tell the model to do this.
    See [Actions](../concepts/actions.md).

Run the client:

```bash
flutter run -d chrome
```

To use another server, add `--dart-define=AGENT_BASE_URL=http://host:port`.

## Debug with the Genkit Developer UI

The Genkit Developer UI shows each step of a turn: the user's message or UI
action, the tool calls, and the A2UI that the model wrote. Install the
[Genkit CLI](https://genkit.dev/docs/dart/get-started/) and start the server
through it:

```bash
genkit start -- dart run bin/server.dart
```

## Complete sample

The [Genkit Dart A2UI sample](https://github.com/genkit-ai/genkit-dart/tree/main/testapps/a2ui)
is a runnable server and Flutter client. It also shows a custom `Gauge`
component, defined in the server catalog and as a GenUI catalog item on the
client.

## Next steps

- **[`genkit_a2ui` on pub.dev](https://pub.dev/packages/genkit_a2ui)**: All
  options, catalog formats, and how the middleware works.
- **[GenUI SDK](https://docs.flutter.dev/ai/genui)**: Custom widgets, theming,
  and more about the Flutter renderer.
- **[Defining Your Own Catalog](../guides/defining-your-own-catalog.md)**:
  Design a catalog for your app.

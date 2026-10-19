# A2UI Flutter Explorer

The gallery app of the Flutter renderer for protocol v0.9, following the
[framework adapter blueprint](../../../blueprints/modules/a2ui_framework_adapter.blueprint.md).
The left column lists the
[v0.9 basic catalog examples](../../../specification/v0_9/catalogs/basic/examples).
The center column shows the selected example's surfaces above its messages,
each message marked processed or pending. The right column shows each
surface's data model as it changes, above a log of the actions the surfaces
send and the errors the surfaces and the message processor report.

## Running

From this directory:

```bash
flutter run -d macos
flutter run -d chrome
```

Selecting an example processes all of its messages. Reset starts it over with
none processed, Advance processes the next one, and Run all processes the
rest.

## Tests

```bash
flutter test
```

## Examples

`lib/src/examples.g.dart` holds a copy of the examples, because a Flutter
build does not ship assets declared from outside the app's directory. After
the examples change, regenerate it from this directory:

```bash
dart run tool/generate_examples.dart
```

`test/examples_test.dart` fails while the copy is stale.

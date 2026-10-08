# A2UI Flutter Explorer

The gallery app of the Flutter renderer, as the
[framework adapter blueprint](../../../blueprints/modules/a2ui_framework_adapter.blueprint.md)
specifies it. The left column lists the
[v0.9 basic catalog examples](../../../specification/v0_9/catalogs/basic/examples).
The center column shows the selected example's surfaces above its messages,
each message marked processed or pending. The right column shows each
surface's data model as it changes, above a log of the actions and errors the
surfaces report.

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

`lib/src/examples.g.dart` holds a copy of the examples, because Flutter
bundles only assets inside the app's package. After the examples change,
regenerate it from this directory:

```bash
dart run tool/generate_examples.dart
```

`test/examples_test.dart` fails while the copy is stale.

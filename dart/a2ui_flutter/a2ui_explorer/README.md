# A2UI Flutter Explorer

The gallery app of the Flutter renderer, as the
[framework adapter blueprint](../../../blueprints/modules/a2ui_framework_adapter.blueprint.md)
specifies it. It lists the
[v0.9 basic catalog examples](../../../specification/v0_9/catalogs/basic/examples)
and steps through the messages of the one selected. The surfaces render in
the center, above the messages, each marked once processed. The right column
shows each surface's data model as it changes and logs the actions and errors
the surfaces report.

## Running

```bash
flutter run -d macos
flutter run -d chrome
```

Advance processes the next message, Run all processes the rest, and Reset
starts the example over.

## Examples

`lib/src/examples.g.dart` holds a copy of the examples, since a Flutter app
cannot bundle files from outside its package. After the examples change,
regenerate it from this directory:

```bash
dart run tool/generate_examples.dart
```

`test/examples_test.dart` fails while the copy is stale.

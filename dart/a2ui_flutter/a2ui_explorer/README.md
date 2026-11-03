# A2UI Flutter Explorer

The gallery app of the Flutter renderer for protocols v0.9 and v1.0,
following the
[framework adapter blueprint](../../../blueprints/modules/a2ui_framework_adapter.blueprint.md).
The left column lists the basic catalog examples of the selected version:
[v0.9](../../../specification/v0_9/catalogs/basic/examples) or
[v1.0](../../../catalogs/basic/v1/examples). The center column shows the
selected example's surfaces above its messages, each message marked
processed or pending. The right column shows each surface's data model as it
changes, above a log of the actions the surfaces send and the errors the
surfaces and the message processor report.

## Running

From this directory:

```bash
flutter run -d macos
flutter run -d chrome
```

Selecting an example processes all of its messages. Reset starts it over with
none processed, Advance processes the next one, and Run all processes the
rest. Selecting the other version opens the example of the same file name in
it, or its first example.

## Tests

```bash
flutter test
```

## Examples

`assets/examples/v0_9` and `assets/examples/v1_0` link to each version's
examples, so the app bundles them as they are. On Windows, the links need a
clone made with `git clone -c core.symlinks=true` and Developer Mode turned
on.

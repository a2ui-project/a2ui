# A2UI CLI

Developer tool and typesafe component generator for A2UI catalogs.

## Installation & Running

Run directly using `dart`:

```bash
dart run dart/a2ui_cli/bin/a2ui.dart codegen \
  --catalog path/to/catalog.json \
  --out path/to/output_dir/
```

Or activate globally from source:

```bash
dart pub global activate --source path dart/a2ui_cli
a2ui codegen -c path/to/catalog.json -o path/to/output_dir/
```

## Regenerating Checked-In Python Builders

After changing the generator or the basic catalog schema, regenerate the Python SDK builder catalog using:

```bash
dart run dart/a2ui_cli/bin/a2ui.dart codegen \
  --catalog specification/v0_9_1/catalogs/basic/catalog.json \
  --out python/a2ui_agent/src/a2ui/builder/v0_9/catalogs/basic.py
```

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

After changing the generator or a basic catalog schema, regenerate the Python SDK builder catalog using:

```bash
# Protocol v0.9 / v0.9.1:
dart run dart/a2ui_cli/bin/a2ui.dart codegen \
  --catalog specification/v0_9_1/catalogs/basic/catalog.json \
  --out python/a2ui_agent/src/a2ui/builder/v0_9/catalogs/basic.py

# Protocol v1.0:
dart run dart/a2ui_cli/bin/a2ui.dart codegen \
  --catalog catalogs/basic/v1/catalog.json \
  --out python/a2ui_agent/src/a2ui/builder/v1_0/catalogs/basic.py
```

## Linting Catalog Accessibility Labels

Use `a2ui lint` to check that interactive components in a catalog declare a text-bearing label property:

```bash
dart run dart/a2ui_cli/bin/a2ui.dart lint \
  --catalog catalogs/basic/v1/catalog.json
```

### Heuristic

A component is treated as interactive when any of its declared properties references `common_types.json#/$defs/Action` (reported as `accepts action`) or when the component includes `common_types.json#/$defs/Checkable` (reported as `accepts input`).

By default, an interactive component passes when any declared property other than `value` is:

- A string or `DynamicString` property
- A single child component reference (`Child` or `ComponentId`)
- An array of objects whose item schema declares such a property

### Options

- `--strict`: Requires the text-bearing label property (and any nested item label property) to be listed in `required`.
- `--ignore <Component>`: Acknowledges a finding for `<Component>` (may be passed multiple times). Acknowledged components are printed as `ignored: <Component>` and do not cause a non-zero exit code. If an `--ignore` entry has no matching finding, `a2ui lint` emits a warning so allowlists do not go stale.

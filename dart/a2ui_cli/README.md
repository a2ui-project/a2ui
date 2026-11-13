# A2UI CLI

Developer tool and typesafe component generator for A2UI catalogs.

## Installation

### Standalone Pre-Built Binaries

Pre-built standalone executables are available for official release tags (beginning with `cli-v0.1.0`). No Dart or Flutter SDK installation is required.

#### macOS & Linux (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/public/install_cli.sh | sh
```

The script automatically detects your platform (macOS Apple Silicon/Intel, Linux x86_64/ARM64), verifies the cryptographic SHA-256 checksum against official release assets, and installs `a2ui` into `${XDG_BIN_HOME:-~/.local/bin}` (or `$A2UI_INSTALL_DIR`, with optional version pinning via `$A2UI_VERSION`) without requiring `sudo`.

#### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/public/install_cli.ps1 | iex
```

Verifies the cryptographic SHA-256 checksum against official release assets, installs `a2ui.exe` into `%LOCALAPPDATA%\Programs\a2ui\bin` (or `$env:A2UI_INSTALL_DIR`, with optional version pinning via `$env:A2UI_VERSION`), and ensures it is added to the user's `PATH`.

### Running from Source (Dart SDK)

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

Generated Python enum types preserve string, integer, boolean, and null values.
Integral JSON numbers such as `1.0` generate integer literals when exactly
representable as signed 64-bit integers; out-of-range values fail generation
instead of being clamped or rounded.
Numeric and boolean enums reject string substitutes and do not treat booleans as
numbers. Fractional numbers, arrays, and objects cannot be Python `Literal`
members; code generation reports an error for these enum values.

The `codegen` file reader normalizes integral numeric tokens exactly before
analysis, including `9007199254740993.0`. It rejects integers outside signed
64-bit range and fractional tokens whose decimal value changes when converted
to a Dart double and back, including overflow and underflow. This check covers
the whole document, including nested schemas and local reference targets;
quoted strings and escapes are unchanged. Programmatic callers supplying
already-decoded maps must preserve numeric precision in their own decoder.

Nullable properties retain `None` in their Python annotations. A required nullable
property must still be supplied. Serialization is owned by the Python builder SDK:
SDK 0.11.0's `flatten_component_tree` omits `None` values, including required nullable
properties. The generator does not change that runtime behavior.

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

## Linting Catalog Schemas

Use `a2ui lint` to check freestanding catalog JSON files against deterministic A2UI protocol schema rules:

```bash
dart run dart/a2ui_cli/bin/a2ui.dart lint \
  --catalog catalogs/basic/v1/catalog.json
```

### Rules

`a2ui lint` reports errors and warnings across protocol versions `0.9`, `0.9.1`, and `1.0`:

- Core catalog structure, `catalogId`, `protocolVersion`, `metadata`, and local or external `$ref` targets via `a2ui_core`.
- Reserved `@`-prefixed function names across all catalog versions, and v1.0 Unicode UAX 31 identifier names on components, functions, component properties, and function parameters.
- The reserved `Surface` component name, which is permitted only inside `allowedParents`.
- Component (`properties.component.const`) and function (`properties['@call'].const`) wire discriminators in v1.0 catalogs.
- Functions in v1.0 catalogs that set `requiresUserActivation: true` while permitting agent invocation in `allowedCallers`.
- Warnings when components or v1.0 functions redundantly wrap `ComponentCommon` or `FunctionCommon`, or redeclare their envelope properties.

### Options

Pass `--fatal-warnings` to treat warning findings as fatal and exit with code `1` in CI checks.

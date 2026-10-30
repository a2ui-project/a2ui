# A2UI CLI

Developer tool and typesafe component generator for A2UI catalogs.

## Installation

### Standalone Pre-Built Binaries

Pre-built standalone executables are available for official release tags (beginning with `cli-v0.1.0`). No Dart or Flutter SDK installation is required.

#### macOS & Linux (curl)

```bash
curl -sSL https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/public/install_cli.sh | sh
```

The script automatically detects your platform (macOS Apple Silicon/Intel, Linux x86_64/ARM64), verifies the cryptographic SHA-256 checksum against official release assets, and installs `a2ui` into `~/.local/bin/` without requiring `sudo`.

#### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/public/install_cli.ps1 | iex
```

Installs `a2ui.exe` into `%LOCALAPPDATA%\Programs\a2ui\bin` and ensures it is added to the user's `PATH`.

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

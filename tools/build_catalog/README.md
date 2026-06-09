# Catalog Build Tools

This directory contains a tool for managing and bundling A2UI catalogs.

## assemble_catalog.py

`assemble_catalog.py` is a highly flexible tool for combining multiple
A2UI component and function catalogs into a single unified JSON Schema file. It
natively supports external HTTP refs, automatic GitHub version resolution for
official catalogs, and multi-file merging.

Furthermore, A2UI v0.9+ requires catalogs be freestanding, except for references
to `common_types` which are automatically resolved by the A2UI SDK, to simplify
LLM inference and dependency management.

### Key Features

- **Multi-input support**: Pass one or more local file paths or HTTP(S) URLs to
  combine multiple catalogs into one cohesive output.
- **Smart `$ref` Resolution**: Automatically fetches external URLs and
  accurately resolves relative local paths.
- **Official Catalog Interception**: By default, it intercepts references to
  `basic_catalog.json` (or `standard_catalog_definition.json` for v0.8) and
  `common_types.json` and auto-downloads the official A2UI specification from
  GitHub based on the `--version` provided (defaults to `0.9`). If you provide
  your own local versions in the input list, it will intelligently use those
  instead!
- **Circular Dependency Protection**: Detects and aborts on infinite `$ref`
  loops.
- **Resilient Remote Fetching**: Employs timeouts for network requests and
  provides clear, descriptive errors for missing files or invalid JSON payloads.
- **Collision Warnings**: Logs warnings if components or functions with the same
  name are merged, preventing silent overwrites.
- **Schema Metadata**: Automatically generates `$id`, `catalogId`, `title`, and
  `description` root metadata based on your output `--name`.
- **Automatic `.json` extension**: Ensures the output file is always correctly
  formatted.

### Usage

```bash
uv run tools/build_catalog/assemble_catalog.py [INPUTS ...] --output-name <OUTPUT_NAME> [--catalog-id <ID>] [--version <VERSION>] [--extend-basic-catalog] [--out-dir <DIR>] [--verbose]
```

### Arguments

- `inputs`: One or more paths or URLs to A2UI component catalog JSONs.
- `--output-name`: (Required) The desired name of the combined catalog (e.g.
  `my_merged_catalog`). The `.json` extension is appended automatically if
  omitted.
- `--catalog-id`: Custom `catalogId` for the output. Defaults to `urn:a2ui:catalog:<base_name>`.
- `--version`: The A2UI specification version to use for official catalog
  fallbacks. Choices are `0.8`, `0.9` or `1.0`. Defaults to `0.9`.
- `--extend-basic-catalog`: If passed, automatically includes the entirety of
  `basic_catalog.json` in the root output regardless of whether the input
  catalogs explicitly reference it.
- `--out-dir`, `-o`: The directory where the assembled catalog will be saved. Defaults to `dist`.
- `--verbose`, `-v`: If passed, enables verbose debug logging to help diagnose issues.

### Examples

**Combine two local catalogs:**

```bash
uv run tools/build_catalog/assemble_catalog.py component1.json component2.json --output-name merged_catalog
```

**Combine a local catalog with an external URL, enforcing v1.0:**

```bash
uv run tools/build_catalog/assemble_catalog.py local_catalog.json https://example.com/remote_catalog.json --output-name hybrid_catalog --version 1.0
```

**Build a catalog and explicitly inject all `basic_catalog.json` properties:**

```bash
uv run tools/build_catalog/assemble_catalog.py my_catalog.json --output-name extended_catalog --extend-basic-catalog
```

**Author and assemble a local catalog with external references:**

1. Author a catalog that imports Text from the Basic Catalog to build a simple Popup surface (e.g., `sample_popup_catalog.json`):

```json
{
  "$id": "sample_popup_catalog",
  "components": {
    "allOf": [
      {
        "$ref": "basic_catalog.json#/components/Text"
      },
      {
        "Popup": {
          "type": "object",
          "description": "A modal overlay that displays an icon and text.",
          "properties": {
            "text": {
              "$ref": "common_types.json#/$defs/ComponentId"
            }
          },
          "required": ["text"]
        }
      }
    ]
  }
}
```

2. Run `assemble_catalog.py` to bundle all those external file references into a single, independent JSON Schema file:

```bash
$ uv run tools/build_catalog/assemble_catalog.py sample_popup_catalog.json --output-name sample_popup_catalog

📦 Assembling 1 catalogs into 'sample_popup_catalog.json' (Version: 0.9)
✅ Created: dist/sample_popup_catalog.json
```

3. Your bundled catalog containing the fully synthesized `basic_catalog` and
   `common_types` requirements will be mapped out to `dist/sample_popup_catalog.json`.

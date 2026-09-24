# A2UI CLI Conformance Test Suite

This directory contains language-agnostic conformance tests for A2UI CLI developer tools and code generators (such as `@a2ui/cli` and its future Dart port).

## Purpose

The CLI conformance suite verifies that implementations across different host languages (TypeScript, Dart, etc.):

1. Correctly parse CLI flags, options, and arguments (both long `--catalog`, `--out` and short `-c`, `-o`).
2. Provide appropriate exit codes and error messages when arguments are missing, files are not found, or JSON is malformed.
3. Ingest catalog JSON schemas and generate matching code with exact string fidelity.
4. Support advanced catalog features including open enums (`Literal[...] | str`), typed slots (`Slot`, `SlotList`), Python keyword sanitization, custom base imports, and function call wrappers.

## Test Case Schema

Each YAML document in this directory contains a list of test cases conforming to the following structure:

```yaml
- name: string # Unique test identifier (e.g. test_codegen_minimal_single_component)
  description: string # Clear explanation of what is verified
  catalog_schema: object # Optional inlined catalog schema JSON object
  raw_catalog_content: string# Optional raw string for malformed file tests
  args:
    [string] # Command-line arguments. Supports placeholders:
    #   - ${CATALOG_PATH}: Path to the prepared catalog file
    #   - ${OUT_DIR}: Path to temporary output directory
    #   - ${OUT_FILE}: Path to temporary output file
  expect:
    exit_code: integer # Expected exit code (0 for success, 1 for error)
    stdout_contains: [str] # Substrings expected in stdout
    stderr_contains: [str] # Substrings expected in stderr
    files: # Optional map of relative file names to assertions
      <filename>:
        exact_content: str # Exact string matching against the generated file content
        content_contains: [str] # Substrings that must be present
        content_not_contains: [str] # Substrings that must NOT be present
```

## Running the Conformance Suite

### TypeScript (`@a2ui/cli`)

The TypeScript test harness executes these test cases against `dist/src/cli.js`:

```bash
yarn workspace @a2ui/cli test
```

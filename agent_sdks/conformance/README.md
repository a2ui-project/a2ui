# Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite in this directory.

## Suite Structure

All test suites are located in the `suites/` directory:

- `suites/streaming_parser.yaml`: Contains test cases for the `A2uiStreamParser` (streaming), verifying chunk buffering, incremental yielding, and edge cases like cut tokens.
- `suites/parser.yaml`: Contains test cases for non-streaming parsing and payload fixing.
- `suites/validator.yaml`: Contains test cases for the `A2uiValidator`, verifying structural integrity, cycle detection, and reachability.
- `suites/catalog.yaml`: Contains test cases for `A2uiCatalog` (prune, render, load).
- `suites/schema_manager.yaml`: Contains test cases for `A2uiSchemaManager` (select_catalog, load_catalog, generate_prompt).

All static test data and simplified schemas are located in the `test_data/` directory.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML test files themselves.

## Usage in SDKs

Each language SDK must implement a test harness that:

1.  Reads the YAML files.
2.  Feeds the inputs to the language's specific implementation of the parser/validator.
3.  Asserts that the output matches the expected results defined in the YAML.

Refer to `agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py` for a reference implementation of a harness.

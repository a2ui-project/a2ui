# Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite in this directory.

## Suite Structure

All test suites are located in the `suites/` directory, organized by SDK target (`agent/` vs `core/`) and layer paths:

### Agent SDK Suites (`suites/agent/`)
- `suites/agent/processing/streaming_parser.yaml`: Test cases for `A2uiStreamParser` (streaming), verifying chunk buffering, incremental yielding, and edge cases.
- `suites/agent/processing/parser.yaml`: Test cases for non-streaming parsing and payload fixing.
- `suites/agent/validating/validator.yaml`: Test cases for `A2uiValidator`, verifying structural integrity, cycle detection, and reachability.
- `suites/agent/catalog/catalog.yaml`: Test cases for `A2uiCatalog` (prune, render, load).
- `suites/agent/inference/inference_format.yaml`: Test cases for `A2uiSchemaManager` (select_catalog, load_catalog, generate_prompt).
- `suites/agent/adk/adk_extensions.yaml`: Test cases for ADK extensions.
- `suites/agent/a2a/a2a_integration.yaml`: Test cases for A2A protocol integration.

### Core SDK Suites (`suites/core/`)
- `suites/core/state/data_model.yaml`: Comprehensive test cases for `DataModel` reactive state management (get, set, auto-vivification, subscriptions, RFC 6901 pointer escaping, prototype pollution protection).

All static test data and simplified schemas are located in the `test_data/` directory.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML test files themselves.

## Usage in SDKs

Each language SDK must implement a test harness that:

1.  Reads the YAML files.
2.  Feeds the inputs to the language's specific implementation of the parser/validator.
3.  Asserts that the output matches the expected results defined in the YAML.

Refer to `agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py` for a reference implementation of a harness.

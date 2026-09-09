# Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite in this directory.

## Suite Structure

Test suites are organized by functional domain:

### Core (`core/`)

- `core/catalog.yaml`: Contains test cases for catalog operations (prune, render, load).
- `core/accessibility.yaml`: Contains test cases for accessibility attributes and checks.
- `core/validator.yaml`: Contains test cases for schema and structural validators, verifying structural integrity, cycle detection, and reachability.
- `core/data_model.yaml`: Contains test cases for the reactive data model, verifying JSON Pointer reads and writes, container creation, deletion, and observer notification.
- `core/message_processor.yaml`: Contains test cases for the message processor's state machine. Written in the case vocabulary of the `v1_0` branch, whose suite of the same name is the primary one, so the two converge rather than conflict.

### Agent (`agent/`)

- `agent/streaming_parser.yaml`: Contains test cases for streaming parser implementations, verifying chunk buffering, incremental yielding, and edge cases like cut tokens.
- `agent/parser.yaml`: Contains test cases for non-streaming parsing and payload fixing.
- `agent/inference_format.yaml`: Contains test cases for inference formats and schema managers (select_catalog, load_catalog, generate_prompt).

### Extensions (`extensions/`)

- `extensions/a2a/a2a_integration.yaml`: Contains test cases for A2A protocol event and part conversions.
- `extensions/adk/adk_extensions.yaml`: Contains test cases for ADK extensions and RPC handling.

All static test data and simplified schemas are located in the `test_data/` directory.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML test files themselves.

## Usage in SDKs

Each language SDK must implement a test harness that:

1.  Reads the YAML files.
2.  Feeds the inputs to the language's specific implementation of the parser/validator.
3.  Asserts that the output matches the expected results defined in the YAML.

Refer to `agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py` for a reference implementation of a harness.

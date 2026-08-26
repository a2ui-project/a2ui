# Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite in this directory.

## Suite Structure

Test suites are organized by functional domain:

### Core (`core/`)

- `core/catalog.yaml`: Contains test cases for catalog operations (prune, render, load).
- `core/accessibility.yaml`: Contains test cases for accessibility attributes and checks.
- `core/validator.yaml`: Contains test cases for schema and structural validators, verifying structural integrity, cycle detection, and reachability.
- `core/data_model.yaml`: Contains test cases for the reactive data model: JSON Pointer resolution, structural auto-vivification, and observer notification routing.

### Agent (`agent/`)

- `agent/streaming_parser.yaml`: Contains test cases for streaming parser implementations, verifying chunk buffering, incremental yielding, and edge cases like cut tokens.
- `agent/parser.yaml`: Contains test cases for non-streaming parsing and payload fixing.
- `agent/inference_format.yaml`: Contains test cases for inference formats and schema managers (select_catalog, load_catalog, generate_prompt).
- `agent/request_processor.yaml`: Contains end-to-end test cases for the agent turn described in `blueprints/modules/a2ui_agent.blueprint.md`: negotiate catalogs against renderer capabilities, render the system prompt snippet, and parse a full model response into deliverable A2UI messages.

### Extensions (`extensions/`)

- `extensions/a2a/a2a_integration.yaml`: Contains test cases for A2A protocol event and part conversions.
- `extensions/adk/adk_extensions.yaml`: Contains test cases for ADK extensions and RPC handling.

All static test data and simplified schemas are located in the `test_data/` directory.

Cases may also reference published specification artifacts by relative path, for example `"../specification/v0_9_1/catalogs/basic/catalog.json"`. Path-valued fields such as `catalog_schema`, `s2c_schema` and `catalog_configs[].path` are resolved relative to this `conformance/` directory. Referencing the specification directly, rather than copying it here, keeps suites measured against the published contract instead of a snapshot that can drift.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML test files themselves.

## Scope of a shared dataset

A suite in this directory is a contract every implementation must satisfy, so it holds only behaviour that can hold across languages. Behaviour that is genuinely language specific stays in the owning package's own tests, with a note pointing back here. `core/data_model.yaml`, migrated from `renderers/web_core/src/v0_9/state/data-model.test.ts`, documents the exclusions it made and why.

## Usage in SDKs

Each language SDK must implement a test harness that:

1.  Reads the YAML files.
2.  Feeds the inputs to the language's specific implementation of the parser/validator.
3.  Asserts that the output matches the expected results defined in the YAML.

Refer to `agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py` for a reference implementation of a harness.

# Conformance Testing

To ensure behavioral parity across all SDK implementations (Python, Kotlin, etc.), the project maintains a language-agnostic conformance suite in this directory.

## Suite Structure

Test suites are organized by functional domain:

### Core (`core/`)

- `core/catalog.yaml`: Contains test cases for catalog operations (prune, render, load).
- `core/accessibility.yaml`: Contains test cases for accessibility attributes and checks.
- `core/validator.yaml`: Contains test cases for schema and structural validators, verifying structural integrity, cycle detection, and reachability.
- `core/expressions.yaml`: Contains test cases for the client-side expression parser behind `formatString`, covering literals, data bindings, function calls, nested interpolation, escaped markers and parse errors.

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

Client-side implementations run these suites too:

- Dart: `dart/a2ui_core/test/conformance/expressions_conformance_test.dart`
- TypeScript: `renderers/web_core/src/v0_9/basic_catalog/expressions/expression_parser.conformance.test.ts`

Both locate the suite by walking up from the test file, so they need no configured path.

### Writing cases for `parse_expression_template`

`input` is the template string handed to the parser, and `expect` is the sequence of parsed parts — literal strings, data bindings (`{path: ...}`) and function calls (`{call: ..., args: ..., returnType: ...}`).

Harnesses join adjacent literal parts before comparing, and drop empty ones. A case therefore fixes what a template _means_, not how a given implementation splits the literal text around its values; implementations that split literal runs differently still conform as long as the values and the text agree.

Errors are expressed with the suite's language-agnostic categories rather than an SDK's class names: `ParseError` maps to `A2uiExpressionError` in both the Dart and TypeScript clients, and `message` is matched as a regular expression against the error's text.

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
- `core/expressions.yaml`: Contains test cases for the client-side expression parser behind `formatString`, covering literals, data bindings, function calls, nested interpolation, escaped markers and parse errors.

### Agent (`agent/`)

These suites describe the agent SDK interface specified in [`blueprints/modules/a2ui_agent.blueprint.md`](../blueprints/modules/a2ui_agent.blueprint.md). No SDK implements that interface yet, so they state what an implementation has to do rather than what one already does.

The suites that do not depend on an inference format sit directly under `agent/`:

- `agent/catalog_transformer.yaml`: Applying component and function pruning rules to a catalog before it reaches a prompt or a validator.
- `agent/catalog_provider.yaml`: Loading catalog documents from the filesystem, including the identity and protocol version checks a provider performs.
- `agent/catalog_resolution.yaml`: Negotiating renderer capabilities against the catalogs an agent registered, including inline catalogs.
- `agent/request_processor.yaml`: Building an inference format from its factory, and taking registered catalogs and renderer capabilities through to a request processor.
- `agent/skill.yaml`: Generating skill documents and skill sets from a format and a catalog.

#### Per-format suites (`agent/direct_json/`, `agent/express/`)

Everything a format decides for itself is covered once per format, in a folder named for it:

- `prompt_generator.yaml`: Rendering the system prompt snippet for a set of active catalogs. Both folders.
- `response_parser.yaml`: Unwrapping a response into raw blocks, wrapping parts back into a response, and parsing a whole response end to end. Both folders.
- `compiler.yaml`: Compiling one raw block into A2UI messages. Both folders.
- `decompiler.yaml`: Writing messages back into the format's own notation, which is how a prompt example is authored as messages and shown to a model as notation. Both folders.
- `response_streaming.yaml`: Parsing a response one chunk at a time, including the point at which a payload can first be emitted. `direct_json/` only, since the Express parser does not implement `parse_chunk` and an Express agent parses a buffered response whole.

The blueprint declares `wrap`, `unwrap`, `compile`, `decompile` and `parse_response` on a single `Parser` interface, so `response_parser.yaml`, `compiler.yaml` and `decompiler.yaml` are three files for one interface. They are split by call because each has rules of its own: where a payload begins and ends, what it means, and how it is written back. The Express compiler suite is by far the largest of the three, since Express has a grammar to get right and direct JSON does not.

Each folder is self-contained. A rule that holds for both formats has a case in each, written against that format's own output, rather than one shared case that a harness would have to gate. That costs some duplication and buys two things: an implementer adding a format can run one folder and know when they are done, and a rule that turns out to differ by format has somewhere to differ. The differences are real — a direct JSON parser reads a payload progressively as it streams, while Express does not stream at all — and the suite headers say which asymmetries are deliberate.

#### Legacy agent suites (`agent/legacy/`)

`agent/legacy/` holds the suites for the earlier agent interface, the one implemented by `agent_sdks/python/a2ui_agent` and `kotlin/agent_sdk_legacy`. They stay until those SDKs move to the blueprint interface. New cases belong in the suites above.

- `agent/legacy/streaming_parser.yaml`: Streaming parser cases, verifying chunk buffering, incremental yielding, and edge cases like cut tokens.
- `agent/legacy/parser.yaml`: Non-streaming parsing and payload fixing.
- `agent/legacy/inference_format.yaml`: Inference formats and schema managers (select_catalog, load_catalog, generate_prompt).

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

### Writing cases for the agent SDK suites

The suites under `agent/`, including the per-format folders, share one vocabulary, described in the `$defs` of `conformance_schema.json` and summarised here.

Catalogs under test live in `args`, either as a path relative to `conformance/` or as a document inlined in the case. A registration in `args.catalogs` is a `CatalogConfig`: the pristine document plus the transformers applied to it. An agent case states no protocol version of its own: the version it runs under is the one its catalog document declares, or the one a provider is constructed with. These rules do not vary by version, so they are written once against v1.0.

A case states allowlists literally. Keeping everything is said by applying no transformer, so an empty allowlist keeps nothing.

Parser cases use the part union from the blueprint. `unwrap` returns raw parts, each carrying either `text` or `a2ui_raw` with an `is_final` flag; `parse_response` and `parse_chunk` return parts carrying either `text` or compiled `a2ui` messages. Text that precedes a payload is its own part, which is the difference from the legacy suites under `agent/legacy/`, where one item carried both.

A `create_processor` case can parse a response through the processor it just built, by way of a `then_parse` block holding an `input` and its own `expect` or `expect_error`. It sits beside `expect` rather than inside it because it is a call made on the processor, not a property read off it. Use it only for rules that need negotiation to have happened first; a rule about parsing as such belongs in the per-format `response_parser.yaml`, and one about what a payload compiles to in `compiler.yaml`.

Where a format decides the exact spelling of its output, a case asserts an invariant rather than a string: `expect_round_trip` on `wrap` and `decompile`, `expect_deterministic` on `generate_prompt_snippet`, and `expect_matches_single_shot` on `parse_chunk`, which says chunk boundaries change when parts arrive and nothing else. Prompt cases assert substrings through `expect_contains` and `expect_absent`, because the wording around a catalog belongs to the implementation.

`expect_present` on `compile` covers the narrower case of a single value the format must supply but the protocol does not dictate, such as the message on a check written without one. It lists JSON Pointers into the compiled messages; a harness removes each from what the implementation produced, asserting on the way that it was there and not empty, then compares the remainder against `expect`. The `expect` block therefore omits those paths. Reach for it only when pinning the value would freeze one implementation's wording into the protocol, since everything it covers is a thing no other implementation has to match.

Two error categories carry the load: `ParseError` for text that does not parse, and `ValidationError` for a payload that parses but names something the active catalogs do not declare.

Every catalog fixture lives in `test_data/catalogs/`, and every prompt example fixture in `test_data/examples/`. A case names an example by path, the same way it names a catalog, so an example payload is never inlined in a suite and never carries a free-text label. A generator is therefore checked on what it renders, not on a description a case made up. A catalog states only what it adds: its components, its functions, and the `anyComponent` and `anyFunction` unions over them. The types the protocol already defines are referenced, never copied, so a component writes `{"$ref": "common_types.json#/$defs/DynamicString"}` rather than spelling out what a dynamic string is. The same holds for `Child`, `ChildList`, `DataBinding`, `FunctionCall`, `Action` and `CheckRule`. A `$defs` entry is justified only when the protocol has no name for the thing. Copying a protocol type into a catalog lets the copy drift from the protocol, and a fixture that drifts silently stops testing what it claims to.

The fixtures also follow the published catalogs in leaving their component schemas open. A component schema that closes itself with `additionalProperties` would reject the `id` the message envelope adds, and every expected message in these suites would then be invalid against the protocol. Rejecting a property the catalog does not declare is the envelope's job: `agent_to_renderer.json` combines the envelope's own fields with the catalog component and closes the result with `unevaluatedProperties`. Nested objects inside a catalog, such as a function's `args`, do close themselves, which is what the published catalogs do.

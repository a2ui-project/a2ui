# Implementing conformance harnesses

This guide explains how to build conformance test harnesses for an A2UI SDK on a new platform. In the SDK architecture defined in [specification/v1_0/docs/sdks_spec.md](../specification/v1_0/docs/sdks_spec.md), each language's SDK has three tiers, and the conformance suite is split the same way:

| SDK tier          | What it does                                                                                                                                                             | Blueprint                                                                                        | Suites                                                                                                                                             |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core SDK          | Loads catalogs, validates and applies `AgentToRendererMessage` envelopes, holds surface state and the data model, evaluates expressions and functions                    | [a2ui_core.blueprint.md](../blueprints/modules/a2ui_core.blueprint.md)                           | `conformance/core/`                                                                                                                                |
| Inference SDK     | Generates system prompts, negotiates catalogs, parses and streams model responses, compiles shorthand notations into A2UI messages, and exports skills                   | [a2ui_agent.blueprint.md](../blueprints/modules/a2ui_agent.blueprint.md)                         | `conformance/agent/`                                                                                                                               |
| Framework adapter | Renders a Core SDK surface with a UI framework (Lit, React, Angular, Flutter, SwiftUI), forwards interactions and validation state, and applies accessibility attributes | [a2ui_framework_adapter.blueprint.md](../blueprints/modules/a2ui_framework_adapter.blueprint.md) | `conformance/core/adapter_conformance.yaml` and `conformance/core/accessibility.yaml`, plus the Core suites through the Core SDK the adapter wraps |

Across this repository, packages and test suites name the Inference SDK tier `a2ui_agent`.

A conformance harness is a thin adapter inside your language package's test directory. It reads the shared YAML files and constructs catalogs, processors, and formats through your SDK's public entry points. Then it invokes the `action` each test case names, normalizes the output to JSON values, and checks the expected fields or error categories. The harness is not where behavior lives: when a case fails, fix the SDK, not the harness.

## Prerequisites and scope

Build the tiers in order. The Inference SDK depends on the Core SDK, and the inference suites depend directly on four Core SDK capabilities:

1. Loading catalog JSON documents into `Catalog` objects and pruning them into derived catalogs.
2. Parsing and serializing `AgentToRendererMessage` envelopes without losing field types.
3. Validating and applying message envelopes through a `MessageProcessor` with a strict `ValidationConfig` (the Inference SDK builds its stateless `validatePayload` helper on top of `MessageProcessor` to check one turn's messages without prior session history).
4. Raising typed errors from the `A2uiError` hierarchy (`A2uiParseError`, `A2uiValidationError`, `A2uiCatalogError`, and their subclasses).

So the Core harness comes first, the Inference harness second, and the adapter harness last, once a framework renderer exists for the Core SDK.

Do not implement a runner for the files under `conformance/agent/legacy/` (`parser.yaml`, `streaming_parser.yaml`, and `inference_format.yaml`). Those three files test an earlier pre-blueprint interface retained only for backward compatibility. Every rule for a new SDK lives in the suites directly under `core/`, `agent/`, `agent/direct_json/`, and `agent/express/`.

## Repository layout and path resolution

The `conformance/` directory sits at the root of the monorepo alongside the specification, published catalogs, and language SDK directories:

```text
a2ui/
├── catalogs/basic/v1/                 # Published v1.0 basic catalog and JSON examples
├── specification/                     # Protocol JSON schemas (v0_8, v0_9, v0_9_1, v1_0)
├── conformance/
│   ├── conformance_schema.json        # JSON Schema checking all YAML test cases
│   ├── README.md                      # Overview of core and agent suites
│   ├── core/                          # Core SDK suites (also run by framework adapters)
│   ├── agent/                         # Format-independent inference SDK suites
│   │   ├── direct_json/               # Direct JSON format suites and scaling tests
│   │   ├── express/                   # Express format suites and scaling tests
│   │   ├── builder/                   # Fluent builder AST suite and golden JSON files
│   │   ├── macros/                    # Composite macro AST suite and golden JSON files
│   │   └── legacy/                    # Deprecated pre-blueprint suites (skip on new SDKs)
│   └── test_data/                     # Shared catalog, example, prompt, node, and skill fixtures
├── python/a2ui_core/, python/a2ui_agent/        # Python reference SDKs and harnesses
├── typescript/core/web_core/, typescript/agents/a2ui_agent/  # TypeScript reference SDKs and harnesses
├── typescript/renderers/                        # Lit, React, and Angular framework adapters and harnesses
├── dart/a2ui_core/, dart/a2ui_agent/, dart/a2ui_flutter/     # Dart SDKs, Flutter adapter, and harnesses
└── swift/core/, swift/swiftui/                  # Swift Core SDK, SwiftUI adapter, and harnesses
```

Locate the repository root dynamically rather than hardcoding `../` segments or requiring an environment variable. Walk upward from the test file directory or current working directory until you find `conformance/conformance_schema.json`. Store both `REPO_ROOT` (that ancestor directory) and `CONFORMANCE_ROOT` (`<REPO_ROOT>/conformance`).

Watch for two different base-path conventions when resolving fixture paths from YAML cases:

1. Core suites write paths relative to `REPO_ROOT`. `catalogPaths` and `catalogPath` name published catalogs such as `catalogs/basic/v1/catalog.json`, and `expectFile` names specification documents such as `specification/v1_0/json/common_types.json` or goldens such as `conformance/test_data/validation_schema/...`. The one exception is `core/node_resolution.yaml`, whose `fixture` paths (`test_data/node/...`) are relative to `CONFORMANCE_ROOT`.
2. Almost all `conformance/agent/` suites write paths relative to `CONFORMANCE_ROOT`. For example, `test_data/catalogs/simplified_catalog_v1_0.json` resolves under `conformance/test_data/`. [agent/skill.yaml](agent/skill.yaml) is the exception and uses `REPO_ROOT` paths for `args.catalog`, `expected_file`, and `expected_skill_files`.

Provide separate `conformancePath(rel)` and `repoPath(rel)` helpers so path resolution stays explicit at each call site.

Every standard YAML suite is a top-level list of test case objects checked in CI against [conformance_schema.json](conformance_schema.json) by [conformance/tests/test_conformance_yaml.py](tests/test_conformance_yaml.py). Two suites are exempted from that schema check: [agent/builder/builder.yaml](agent/builder/builder.yaml) and [agent/macros/macros.yaml](agent/macros/macros.yaml). Both use a top-level `{macros, tests}` map and identify cases by `id` rather than `name`.

## Shared harness plumbing

All reference harnesses centralize the following responsibilities in a small helper module before writing per-suite test files. Build this module once per package and share it between the Core and Inference harnesses where the language allows.

### 1. YAML loading and plain-value conversion

Use a YAML 1.2 parser to load suite files. Older YAML 1.1 parsers convert unquoted words such as `yes`, `no`, `on`, or `off` into booleans. They also parse colon-separated digits as base-60 numbers, which corrupts test inputs. Float literals are written with a decimal point and a signed exponent (`1.0e+308`) because YAML 1.1 parsers such as PyYAML read `1e308` as a string.

Some YAML libraries return custom wrapper types such as `YamlMap` and `YamlList` in Dart, or unordered dictionaries in Swift. Recursively convert every loaded case into native maps, lists, strings, numbers, booleans, and nulls before running your SDK or deep-equality assertions. Compare JSON structures without regard to object key order. Deeply nested suites can also overflow a parser's default thread stack: the Swift harness parses on a thread with an 8 MB stack for this reason.

### 2. Filtering, skip lists, and strict failure tracking

Configure two top-level constants in your runner as described in [README.md](README.md): `SUPPORTED_PROTOCOL_VERSIONS` and `SKIP_TEST_NAMES`. Note the protocol version strings used across `conformance_schema.json`: pre-1.0 versions carry a `v` prefix (`"v0.8"`, `"v0.9"`, `"v0.9.1"`), whereas version 1.0 is bare `"1.0"`. Core cases declare their version either at the top level (`protocolVersion`) or under `catalog.protocolVersion`; read the top-level key first and fall back to the catalog block.

Follow three safeguards so your test suite never hides regressions behind green results:

1. Assert in every suite file that the loaded case list is not empty. If a file path breaks during refactoring, the suite fails immediately instead of passing zero tests.
2. Enforce the strict dispatch rule across every dispatcher and handler:
   1. An unknown `action`, step `op`, `args` key, scenario key, step key, or `expect*` key fails the case with `Unknown <kind> '<key>' in <suite>#<case>`. The case-level metadata keys `name`, `description`, and `features` are always accepted and ignored.
   2. The only escape is a per-harness `UNSUPPORTED` map from `"<action>"` or `"<action>.<key path>"` to a reason. A matching case is recorded as `skipped` with that reason, never as `passed`. An `UNSUPPORTED` or expected-failure entry that matches no case fails the run.
   3. Each handler declares its keys in one table next to the handler (Python `_KNOWN_KEYS: dict[str, frozenset[str]]`, TypeScript `KNOWN_KEYS` `Map`, Dart `const Map<String, Set<String>>`, Swift `static let knownKeys: [String: Set<String>]`) and calls one helper: Python `_assert_known_keys(obj: Mapping[str, Any], allowed: frozenset[str], where: str) -> None`, TypeScript `assertKnownKeys(obj, allowed, where)`, Dart `void assertKnownKeys(Map<String, Object?> obj, Set<String> allowed, String where)`, Swift `func assertKnownKeys(_ obj: [String: Any], _ allowed: Set<String>, _ where: String) throws`.
   4. Every harness writes the [executed-case manifest](#5-executed-case-manifest), and CI runs the comparer in the same job right after the tests.
3. Separate unimplemented capabilities from defects in implemented code, following [typescript/agents/a2ui_agent/tests/conformance/loader.ts](../typescript/agents/a2ui_agent/tests/conformance/loader.ts) and [dart/a2ui_core/test/conformance/conformance_harness.dart](../dart/a2ui_core/test/conformance/conformance_harness.dart). Mark unsupported versions or unbuilt modules as `[SKIPPED]`, and mark known bugs with a strict expected-failure marker (`pytest.mark.xfail(strict=True)`, Vitest `test.fails`, or a name-to-reason `expectedFailures` map). When a code change fixes a known bug, a strict expected failure fails CI right away so you delete the stale entry.

### 3. Mapping error categories

Test cases express failures through `expectError` or `expect_error` using language-agnostic category names from `ExpectError` in [conformance_schema.json](conformance_schema.json). Agent suites always write `expect_error`, whereas Core suites and steps use both key names (`data_model.yaml` and `expressions.yaml` write `expect_error`, and the remaining Core suites write `expectError`), so a Core runner must check both keys:

| Schema `category`  | Meaning                                                                                            | Typical SDK error classes                                                                           |
| :----------------- | :------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `ParseError`       | Malformed JSON, invalid Express syntax, unterminated sentinel block, or invalid file JSON          | `A2uiParseError`, `A2uiCompilationParseError`                                                       |
| `ValidationError`  | Valid syntax naming an unknown component, invalid property, duplicate ID, missing root, or cycle   | `A2uiValidationError`, `A2uiCompilationValidationError`, `A2uiIntegrityError`, `A2uiRecursionError` |
| `IntegrityError`   | Surface lifecycle faults: duplicate `createSurface`, update to an unknown surface, dangling refs   | `A2uiIntegrityError` (a subclass of `A2uiValidationError`)                                          |
| `RecursionError`   | Component graph cycles or nesting past the depth limit                                             | `A2uiRecursionError`                                                                                |
| `CatalogError`     | Missing catalog file, conflicting catalog ID or protocol version, or failed capability negotiation | `A2uiCatalogError`                                                                                  |
| `DataError`        | Invalid JSON Pointer, forbidden path segment (`__proto__`, `constructor`, `prototype`), bad write  | `A2uiDataError`                                                                                     |
| `ExpressionError`  | Template string that does not parse, or exceeds the length and part limits                         | `A2uiExpressionError`                                                                               |
| `StateError`       | Operation on a disposed or otherwise unusable object                                               | `A2uiStateError`                                                                                    |
| `CompilationError` | General compilation failure not narrowed to syntax or schema checks                                | `A2uiCompilationError`                                                                              |

Map each category to the narrowest class or classes that satisfy it. Accepting the base `A2uiError` for every category makes the category assertion vacuous. When a case also includes a `message` string, match it as a regular expression against the thrown error's message. Core cases may also carry `expectError.surfaceId`, `expectError.functionCallId`, `expectError.path`, `expectError.details` (a list of `path`, `code`, `surfaceId`, and `message` entries), and `expectError.rendererError` (the outbound renderer-to-agent error envelope `{version, error: {code, surfaceId?, functionCallId?, path?, message}}` emitted on `MessageProcessor`'s outbound listener).

Pay close attention to class inheritance if your target language supports only single inheritance. In Python, `A2uiCompilationParseError` inherits from both `A2uiCompilationError` and `A2uiParseError`, so a single `isinstance(err, A2uiParseError)` check matches both core and compiler parse errors. In single-inheritance languages (TypeScript, Dart, Swift, Java, or Rust), make `A2uiCompilationParseError` extend `A2uiParseError` directly, or map `"ParseError"` and `"ValidationError"` in your runner to match both the core error class and its compiler counterpart. The same holds for `A2uiIntegrityError`, which the blueprint defines as a subclass of `A2uiValidationError`, so a case expecting `ValidationError` accepts an integrity failure.

### 4. Timing cases

The `scaling.yaml` suites and `core/message_processor_scaling.yaml` time an operation rather than check its result. A `measure_growth` case times `operation` on a `PayloadTemplate` expanded at two `sizes`, n and 4n, and expects the larger run to take at most `max_ratio` times as long. A `measure_overhead` case times streaming a payload against compiling it. Tag these tests so regular unit test runs skip them and CI runs them in an isolated job. The Dart packages tag them `performance` (`dart test -P performance`), the Python packages mark them `performance` (`uv run pytest -m performance`), and the TypeScript packages run them with `yarn test:timing` through [typescript/core/web_core/tests/timing/timing.mjs](../typescript/core/web_core/tests/timing/timing.mjs). Build catalogs and formats outside the timer and expand the template (`repeat` segments replacing `{i}` joined by `separator`). Run one untimed warmup pass, then alternate at least five measured runs of each size before comparing medians. Avoid forcing a major garbage collection inside the loop: in V8 or the JVM, a forced full GC between runs can deoptimize compiled code and push `4n` past `max_ratio`.

### 5. Executed-case manifest

Every conformance harness records each case it runs or skips so CI can verify that no suite or case was silently dropped. When the `A2UI_CONFORMANCE_MANIFEST_DIR` environment variable is set, the harness appends one JSON Lines record per finished case to `$A2UI_CONFORMANCE_MANIFEST_DIR/<harness>-<suffix>.jsonl` (where `<suffix>` is the process ID or test-file name so parallel runners do not share a file handle). When `A2UI_CONFORMANCE_MANIFEST_DIR` is not set, no manifest files are written.

Each line is validated against [executed_case_manifest.schema.json](executed_case_manifest.schema.json):

```json
{"harness": "python-core", "suite": "core/rpc_functions.yaml", "case": "test_rpc_call_agent_function_timeout_handling", "status": "passed"}
{"harness": "dart-core", "suite": "core/common_types.yaml", "case": "test_dynamic_string_accepts_binding", "status": "skipped", "reason": "validate_common_type is not implemented in this harness yet"}
```

- `harness`: Harness identifier (`python-core`, `web_core`, `dart-core`, `swift-core`, or the agent/adapter harness name).
- `suite`: Suite path relative to `conformance/`, using forward slashes.
- `case`: Case `name`, or test `id` for `{macros, tests}` map-form suites.
- `status`: `passed`, `failed`, `skipped`, or `xfailed`.
- `reason`: Required and non-empty when `status` is `skipped` or `xfailed`.

Suite corpora (`core`, `agent`, `extensions`, and `adapter`) are listed in [manifest_corpora.json](manifest_corpora.json). Every Core harness must account for every case in `core/*.yaml`, recording the adapter suites (`core/adapter_conformance.yaml` and `core/accessibility.yaml`) as `skipped` with a reason when run headlessly. After the test step finishes, CI runs the comparer:

```bash
uv run --project conformance python conformance/scripts/check_executed_cases.py \
  --manifest-dir "$A2UI_CONFORMANCE_MANIFEST_DIR" \
  --harness python-core \
  --corpus core \
  [--corpus adapter] \
  [--only SUITE_GLOB] \
  [--exclude SUITE=REASON] \
  [--matrix-out FILE.md]
```

The comparer fails on any `MISSING` (corpus case without a record), `DUPLICATE` (two records for one suite and case), `UNKNOWN_CASE` (record names a case the suite does not contain), `UNREASONED` (`skipped` or `xfailed` without a reason), `INVALID_RECORD` (schema validation failure), or `FAILED` (`status: "failed"`) finding, including when the manifest directory is empty. Records for suites outside the requested corpora are ignored. Repeat `--only SUITE_GLOB` to narrow a corpus to suites matching a glob when a harness covers only part of a corpus (such as `--corpus extensions --only 'extensions/a2a/**'`). Repeat `--exclude SUITE=REASON` for suites that a test runner filters out before harness code executes (such as performance-tagged suites in Dart and Swift); the comparer prints each excluded suite and reason.

## Implementation order across tiers

Implement the suites in stages so each layer is tested before higher-level components depend on it:

| Stage                                     | Suites to add                                                                                                                                                                          | SDK surface checked                                                                                                                          |
| :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| C1. Data model and expressions            | `core/data_model.yaml`, `core/data_model_pointers.yaml`, `core/data_deletion.yaml`, `core/data_context.yaml`, `core/expressions.yaml`                                                  | `DataModel` pointer reads, writes, deletes, and observers; relative path resolution; the expression template parser                          |
| C2. Catalogs and schemas                  | `core/catalog.yaml`, `core/common_types.yaml`, `core/agent_to_renderer.yaml`                                                                                                           | `Catalog.fromJson`, `toJson`, `derive`, `validationSchema`; schema generation from the SDK's own models                                      |
| C3. Validation and message processing     | `core/validator_v*.yaml`, `core/error_responses.yaml`, `core/message_processor_v*.yaml`, `core/composition_constraints.yaml`, `core/reserved_keys.yaml`, `core/validation_result.yaml` | Strict validation, outbound renderer error envelopes, `MessageProcessor` lifecycle, per-call `validationConfig`, capabilities and data reads |
| C4. Functions, actions, and multi-catalog | `core/functions.yaml`, `core/index_function.yaml`, `core/multi_catalog.yaml`, `core/actions.yaml`, `core/rpc_functions.yaml`                                                           | Basic catalog functions, call resolution across catalogs, action dispatch, bidirectional RPC                                                 |
| C5. Node resolution and timing            | `core/node_resolution.yaml`, `core/message_processor_scaling.yaml`                                                                                                                     | `NodeResolver` identity, scoped bindings, and notifications; linear-time message processing                                                  |
| A1. Catalog plumbing                      | `agent/catalog_provider.yaml`, `agent/catalog_transformer.yaml`, `agent/catalog_resolution.yaml`                                                                                       | `FileSystemCatalogProvider`, `InMemoryCatalogProvider`, `CatalogConfig`, pruning transformers, and `resolveCatalogs`                         |
| A2. Direct JSON format                    | `agent/direct_json/response_parser.yaml`, `compiler.yaml`, `decompiler.yaml`, `prompt_generator.yaml`, `response_streaming.yaml`                                                       | Sentinel framing (`<a2ui-json>`), single-block compilation, prompt golden matching, and incremental JSON streaming                           |
| A3. Express format                        | `agent/express/response_parser.yaml`, `compiler.yaml`, `decompiler.yaml`, `prompt_generator.yaml`                                                                                      | Sentinel framing (`<a2ui>`), Express grammar parsing, compilation, decompilation, and prompt generation                                      |
| A4. Multi-catalog and session pipeline    | `agent/multi_catalog_formats.yaml`, `agent/request_processor.yaml`, `agent/streamed_answer.yaml`                                                                                       | Cross-catalog lookup, `InferenceFormatFactory`, `A2uiGenerator`, `A2uiRequestProcessor`, and `StreamedAnswer`                                |
| A5. Specification round-trips             | `catalogs/basic/v1/examples/*.json` (and v0.9 examples if supported)                                                                                                                   | End-to-end `decompile` followed by `compile` across every published basic catalog example                                                    |
| A6. Skills, macros, and scaling           | `agent/skill.yaml`, `agent/builder/builder.yaml`, `agent/macros/macros.yaml`, `agent/*/scaling.yaml`                                                                                   | Skill generation, typesafe fluent builders, macros, and linear-time parsing                                                                  |
| F1. Framework adapter                     | `core/adapter_conformance.yaml`, `core/accessibility.yaml`                                                                                                                             | Rendered view trees, repeaters, two-way bindings, action and user-activation gating, validation state, accessibility, and unmount cleanup    |

Notice that `agent/express/` has no `response_streaming.yaml` file. Express parses whole buffered blocks and does not implement `openStream`.

## Core SDK harness (`conformance/core/`)

### Case shape

Core cases use camelCase keys for most inputs and expectations, with two notable exceptions: error expectations write either `expectError` or `expect_error` (`data_model.yaml` and `expressions.yaml` use `expect_error`), and `data_model.yaml` also uses snake_case step expectations (`expect_absent`, `expect_type`, `expect_notified`, `expect_values`). A case names its `action`, states its version at the top level as `protocolVersion` (or under `catalog.protocolVersion`), and names its catalogs with `catalogPaths` (a list of repository-relative paths), `catalogPath` (one path), `catalogs` (a list of inline documents or `{catalogId, protocolVersion}` stubs), or an inline `catalog`. Expectations use `expect`, `expectError` / `expect_error`, `expectFile`, `expectSelected`, or `expectDispatched` depending on the action.

Multi-step cases carry a `steps` list. Each step holds the inputs for one call (`messages`, `payload`, `op` and `path`, or `args`) and its own `expect` or `expectError` / `expect_error`. Steps run in order against the same object, so a later step sees the state earlier steps created. A step's `expect` is a subset match unless the action's documentation says otherwise.

### Loading catalogs for a case

Resolve the case's protocol version first, then build the catalogs it names:

1. `catalogPaths` and `catalogPath` point to JSON files under `REPO_ROOT`. When parsing fixture documents with `Catalog.fromJson`, supply the case's protocol version when a pre-1.0 file omits `protocolVersion` on disk (both `specification/v0_8/json/standard_catalog_definition.json` and `specification/v0_9/catalogs/basic/catalog.json` leave it out). Note that the TypeScript and Python reference runners substitute their built-in basic catalog when `catalogPaths` names a published basic catalog (`basic/catalog.json`) and call `Catalog.fromJson` only on other fixture files.
2. Inline `catalog` and `catalogs` documents are loaded from the YAML value. A `catalogs` entry with only `catalogId` and `protocolVersion` is a stub: build a catalog with those two fields and no components, which is what `get_renderer_capabilities` cases use.
3. For a stricter new runner, validate unnamed cases against your SDK's real basic catalog for the case's version and alias any declared fixture under the `catalogId` the case's messages reference. Be aware that several existing Core fixtures omit required component fields (such as a `Button` without `child` or `action`) or reference placeholder `catalogId` values (such as `test-catalog-v10`) without defining a catalog, so the reference runners relax catalog loading outside `CatalogError` cases: TypeScript registers permissive `flexibleComponents` (copying the declared catalog under the message's ID only when the case expects a non-catalog error), Python's `add_catalog_id` synthesizes a catalog populated with the version's basic components, Swift injects open schemas for `Button`, `Label`, and `Text` when no custom catalog is given, and Dart uses a permissive basic catalog for pre-1.0 `catalogPaths` cases while recording schema-incomplete v1.0 message-processor fixtures in its expected-failure map.

### Action reference by suite

1. `data_model` (`data_model.yaml`): Create a `DataModel` from `initial` (default `{}`) and run `steps`. Each step is an `op` of `get`, `set`, `delete`, or `dispose` on a JSON Pointer `path` with an optional `value`. Compare `get` results against `expect` as whole values, so a deleted key is detected, and check `expect_absent` and `expect_type` when present. When `watch` lists paths, subscribe before running the steps and check `expect_notified` and `expect_values` on each step. Forbidden segments (`__proto__`, `constructor`, `prototype`) and malformed pointers raise `DataError` (`expect_error`) in every language.
2. `resolve_path` (`data_context.yaml`, `message_processor_v0_9.yaml`): Resolve `args.path` against `args.contextPath` through the data context and compare the absolute pointer with `expect`. `"."` and `""` resolve to the context path itself.
3. `parse_expression_template` (`expressions.yaml`): Parse `input` into parts and compare against `expect`, a list of literal strings, bindings (`{path: ...}`), and calls (`{call: ..., args: ..., returnType: ...}`). Join adjacent literal parts and drop empty ones before comparing, so implementations that split literal text differently still conform. `ParseError` maps to `A2uiExpressionError`.
4. `from_json`, `to_json`, `round_trip`, `validation_schema`, and `derive` (`catalog.yaml`): See the suite description in [README.md](README.md). `from_json` expectations list exactly the components and functions the loaded catalog defines; `matchesBuiltinCatalog: true` compares the loaded published catalog with the SDK's own basic catalog implementation; `selfContained: true` requires every `$ref` in the resolved schema to resolve within the document. `to_json` serializes the SDK's own catalog named by `builtinCatalog` and compares it with `expectFile`. `validation_schema` compares the flattened validation schema with a golden under `test_data/validation_schema/`. `derive` builds a catalog from a source with `args.components` and `args.functions` and checks `expect`. All comparisons ignore key order and the order of `enum` and `required` values.
5. `common_types_schema`, `validate_common_type` (`common_types.yaml`) and `agent_to_renderer_schema` (`agent_to_renderer.yaml`): Serialize the schema your SDK generates from its own models for `protocolVersion` with sorted keys and compare it with the specification document named by `expectFile`. They must be identical. `validate_common_type` validates each step's `value` as the named `definition` with the SDK's model and expects acceptance or `expectError`.
6. `validate` (`validator_v*.yaml`, `composition_constraints.yaml`, `data_deletion.yaml`, `data_model_pointers.yaml`, `error_responses.yaml`, `expressions.yaml`, `functions.yaml`, `index_function.yaml`, `message_processor_v1_0.yaml`, `multi_catalog.yaml`, `reserved_keys.yaml`, `validation_result.yaml`): Because several suites mix `validate` cases with other actions, dispatch each case by its `action` field rather than by suite filename. Run the top-level `payload` or each step's `messages` through a single `MessageProcessor` across steps, so a later message is checked against the components earlier messages created. Default to strict validation, respecting `strictMode: false` when a case tests non-strict buffered streaming (`error_responses.yaml`). A step without `expectError` / `expect_error` must be accepted (and match `expect.surfaces` when present), and a step with one must raise the named category. When `expectError.rendererError` is set (`error_responses.yaml`), attach an outbound listener to `MessageProcessor` and verify that the emitted `error` message matches `rendererError.version`, `code`, `message`, and any expected `surfaceId`, `functionCallId`, or JSON Pointer `path` against `client_to_server.json` (v0.9) or `renderer_to_agent.json` (v1.0).
7. `process_messages` (`message_processor_v*.yaml`, `reserved_keys.yaml`): Create one `MessageProcessor` per case with the case's catalogs, then apply the top-level `messages` or each step's `messages`. A step's `validationConfig` applies to that call only and replaces the processor's own rules; a rule the step leaves out is strict. After processing, compare `expect.surfaces.<id>`: `exists`, `sendDataModel`, `theme`, `components`, and `dataModel` where present (`validationResult`, `isValid`, `validationErrors`, and `validationResults` appear on component expectations in `validate` cases from `validation_result.yaml`, so share one surface-assertion helper across both actions). Also handle messages wrapped in a `{"messages": [...]}` container object.
8. `get_renderer_capabilities` and `get_renderer_data_model` (`message_processor_v*.yaml`): Build a processor from `catalogs` and call the capability or data model accessor with `args` (`version`, `includeInlineCatalogs`). Compare the full `expect` structure, not just the top-level keys. For versions before 1.0, inline catalogs use the v0.9 `client_capabilities.json` shape; from 1.0 they are standalone catalog documents. Sort `supportedCatalogIds`, component names, and function names before comparing, because dictionary iteration order differs between languages.
9. `evaluate_function` (`functions.yaml`): Without a `surface` block, call the function implementation directly in the case's default catalog with `args` and compare the result with `expect`, or expect the error category. With a `surface` block, build a surface for `protocolVersion` with the catalogs from `catalogPaths`, set `surface.catalogId` as the surface default catalog, and evaluate `{"@call": function, "catalogId": catalogId, "args": args}` (or `call` before v1.0) through the surface's data context at the root path. From v1.0 a call runs in its own `catalogId`, else the surface default, else it fails with `CatalogError`. Some SDKs report evaluation failures on the surface's error channel instead of raising; treat the first error reported that way as raised.
10. `select_catalog` (`multi_catalog.yaml`): Given `args.surface` (`defaultCatalogId`, `supportedCatalogIds`) and `args.components`, resolve the catalog each component binds to and compare with `expectSelected`.
11. `dispatch_action` (`actions.yaml`): Resolve `actionPayload` (an `event` or `functionCall`, in long or shorthand form) through the binder with optional `sourceComponentId` and `userActivation`. Compare the dispatched event against `expectDispatched` (`name`, `surfaceId`, `sourceComponentId`, `context`, `userMessage`, `timestampIso8601`, `metadata`, or `null` when no event leaves the client), check `expectDataModel` after local mutations, or verify `expectError` when user activation is absent.
12. `handle_rpc` (`rpc_functions.yaml`): Handle both RPC directions. For inbound messages (`args.message`, carrying a `callRendererFunction` or `agentFunctionResponse` envelope), pass optional `args.functionMetadata` (`allowedCallers`, `requiresUserActivation`), `args.userActivationPresent`, `args.catalogId`, and `args.catalogVersion` to your RPC handler and compare the result against `expect.response` or `expect.error`. For renderer-initiated calls (`args.outboundCall`, carrying `surfaceId`, `functionCallId`, `callFunction`, and optional `timeoutMs`), register the outbound `callAgentFunction` call and either correlate it with `args.inboundResponse` (`agentFunctionResponse`) to check `expect.correlatedCallId` and `expect.result`, or run `args.secondOutboundCall` and timeout checks expecting `expectError.code` of `DUPLICATE` or `TIMEOUT`.
13. `resolve_nodes` (`node_resolution.yaml`): Load the `fixture` from `conformancePath(fixture)`, build the node tree through your `NodeResolver`, and compare `expect.nodes` (keyed by node path such as `root/children/0`, with `component_id`, `type`, `state`, `data_path`, `isValid`, `validationErrors`, `validationResults`, and resolved `props` carrying `value` and `writable`). Then run `steps` (`write`, `set_data`, `update_components`, `process_messages`, `dispose`, and others listed in [core/node_resolution.md](core/node_resolution.md)) and check per-step `nodes`, `data`, `emissions`, `errors`, and `same_nodes` identity assertions.
14. `measure_growth` (`message_processor_scaling.yaml`): See [Timing cases](#4-timing-cases).

### Comparing surface state

Surface expectations in `process_messages` and `validate` cases follow these rules in the reference harnesses:

1. `components` in list form is exhaustive: assert the count matches and every listed component matches by `id`. In map form (`{id: {...}}`) it is a subset check against the named components only. A harness that loops over the expected entries without checking the count turns `components: []` into an assertion that passes on any surface.
2. `dataModel` is compared against the whole data model root (`get("/")`), so a key the processor should have deleted is detected. Comparing one top-level key at a time misses deletions.
3. `validationResult` is read from the resolved component's props, not from the raw message, because check rules are evaluated during resolution. For an evaluated check, an explicit rule `message` overrides the default message the condition function returns; for a path-bound check (`@path`), the data model's `ValidationResult.message` takes precedence.
4. Completeness (root presence, dangling references, orphans) is checked on every `updateComponents` message against the merged candidate surface, not once at the end of the payload, per [a2ui_core.blueprint.md](../blueprints/modules/a2ui_core.blueprint.md).

### Patterns and pitfalls in Core harnesses

1. Use a single error vocabulary across SDKs. A duplicate `createSurface` and an update to an unknown surface both raise `A2uiIntegrityError` with the message `Surface not found for message: <id>` for the latter. SDKs that raised `A2uiStateError` here failed the shared suites until they converged.
2. Run functions the way the runtime runs them. The Python harness calls each function's raw execution callable rather than the schema-validated wrapper, so a case can check runtime coercion (`length` on arrays, `and` on `[1, "non-empty"]`) without being blocked by wire-schema validation. Decide which layer `evaluate_function` targets in your SDK and keep it consistent with the other harnesses.
3. Common-type references must resolve. A catalog loaded from JSON that references `common_types.json#/$defs/Checkable` or `DynamicString` must inline or resolve those definitions, or `checks` silently never run and unresolvable `$ref`s become unconstrained schemas. `selfContained` cases in `catalog.yaml` and `test_catalog_json` style round trips catch this.
4. Expression parsers must accept the `@` and `~` tokens used by v1.0 (`${@index(offset: 1)}`), enforce the 10,000 character and 1,000 part limits, and normalize `-0`.
5. Sort before comparing capabilities. Inline catalog output must iterate `supportedCatalogIds`, components, and functions in sorted order, or comparisons flake on languages with unordered dictionaries.

## Inference SDK harness (`conformance/agent/`)

### Loading catalog fixtures and registrations

Agent cases do not declare a top-level `protocolVersion` field. Instead, each case runs under the version its catalog document declares (almost always `"1.0"`).

In `args.catalog` and `args.catalogs`, a case specifies a catalog in one of three forms:

1. A string path relative to `CONFORMANCE_ROOT`, such as `"test_data/catalogs/simplified_catalog_v1_0.json"`.
2. An inline JSON object representing the catalog document directly in YAML.
3. A registration map `{"catalog": <path or inline object>, "transformers": [...]}` corresponding to `CatalogConfig`. Each entry in `transformers` specifies either `{"component_pruning": <list or null>}` or `{"function_pruning": <list or null>}`. Cases write allowlists literally: omitting a transformer keeps every entry, whereas an empty list `[]` or `null` keeps nothing.

Apply three fallback rules when building a shared catalog loader for test fixtures:

1. When a format case omits both `args.catalog` and `args.catalogs` (common in `unwrap` and `wrap`), load `test_data/catalogs/simplified_catalog_v1_0.json` to build the parser.
2. When a fixture document omits `catalogId` (outside `catalog_provider.yaml`, which tests missing IDs directly), supply its relative fixture path as the fallback `catalogId`.
3. When a fixture omits `protocolVersion`, default to `"1.0"`. Every v0.8 and v0.9 catalog fixture loaded by the non-legacy agent suites declares its version explicitly.

### Default surface IDs and `compileChecked`

In Express, an author can omit `surface(...)` when targeting a single default surface. Conformance expectations assume that default surface ID is `"default_surface"`. Pass `"default_surface"` when constructing your Express parser or compiler if your SDK uses a different default in production.

Implement a shared `compileChecked(parser, content)` helper for all `compile` cases and `decompile` round-trip checks:

1. Call `parser.compile(content)` to produce `AgentToRendererMessage` objects. If your compiler throws a raw JSON or grammar exception that does not inherit from `A2uiError`, wrap it in your compilation parse error type first.
2. Call `validatePayload(parser.catalogs, messages)`, an Inference SDK utility built on Core's `MessageProcessor`. Unlike a fresh `MessageProcessor`, `validatePayload` checks one block in isolation and assumes any surface updated without `createSurface` was created in an earlier turn.
3. Return the checked messages and serialize them to plain JSON maps, omitting default optional values that v1.0 leaves out (such as `sendDataModel: false` on `createSurface`).

### Catalog providers, transformers, and negotiation

1. `provide_catalog` (`agent/catalog_provider.yaml`): Construct `FileSystemCatalogProvider` pointing to `conformancePath(args.path)`, passing optional `args.catalog_id` and `args.protocol_version`. Call `load()`. Compare `expect.catalog_id` and `expect.protocol_version` for equality, and compare `expect.components` and `expect.functions` as unordered sets of names.
2. `transform_catalog` (`agent/catalog_transformer.yaml`): Wrap `args.catalog` and `args.transformers` in a `CatalogConfig` and inspect `transformedCatalog` using the same catalog expectation helper.
3. `resolve_catalogs` (`agent/catalog_resolution.yaml`): Build the list of `CatalogConfig` registrations from `args.catalogs`. Pass them to `resolveCatalogs` along with `args.renderer_capabilities` (preserving `null` or `undefined` when omitted from `args`) and `args.accepts_inline_catalogs` (default `false`). Compare `expect.active_catalog_ids` as an unordered set, and match each item in `expect.catalogs` to the resolved catalog with the same `catalog_id` rather than by list index.

### Response framing and whole-response parsing

All four actions in `response_parser.yaml` run against `format.createParser()`:

1. `unwrap`: Call `parser.unwrap(input)` and serialize each `RawResponsePart` to `{"text": ...}` or `{"a2ui_raw": ...}`. Include `"is_final": false` only when `isFinal` is `false` (or strip `"is_final": true` from `expect`, because `true` is the schema default). On non-error cases, you can also check `parser.hasFormatContent(input)` with `complete: false` (any raw part unwrapped) and `complete: true` (any unwrapped part has `isFinal == true`).
2. `has_format_content`: Call `parser.hasFormatContent(input, complete: args.complete ?? false)` and compare with the boolean `expect`.
3. `wrap`: Convert `parts` into `RawResponsePart` objects (`is_final` defaults to `true` when omitted) and call `parser.wrap(parts)`. Check `expect_output` for exact equality, `expect_contains` for required substrings, and `expect_round_trip` by passing the wrapped string back to `parser.unwrap(...)` and comparing against `parts`.
4. `parse_response`: Call `parser.parseResponse(input, wrapped: args.wrapped ?? true)`. Serialize each `ResponsePart` to `{"text": ...}` or `{"a2ui": [...]}` and compare against `expect`.

### Compilation, decompilation, and multi-catalog ordering

1. `compile` (`compiler.yaml` and `multi_catalog_formats.yaml`): Run `compileChecked(parser, input)` and serialize the messages to JSON maps. When `expect_present` is set (such as `"/0/createSurface/components/0/checks/0/message"` in `agent/express/compiler.yaml`), resolve each RFC 6901 JSON Pointer in the serialized messages. These pointers target dynamic object properties (such as generated error messages or diagnostics) rather than array indices. Verify that each pointer resolves to a non-null and non-empty value, delete that object property key at the leaf of the pointer from the compiled structure, and then compare the remaining structure against `expect`.
2. Multi-catalog component order (`agent/multi_catalog_formats.yaml`): Component array order inside `createSurface.components` and `updateComponents.components` carries no meaning in A2UI. Sort `components` lists by component `id` on both actual and expected messages before asserting equality in multi-catalog cases.
3. `decompile` (`decompiler.yaml` and `multi_catalog_formats.yaml`): Parse `messages` into `AgentToRendererMessage` objects, call `parser.decompile(messages)`, and check `expect_output`, `expect_contains`, and `expect_absent`. When `expect_round_trip` is `true`, recompile the output with `compileChecked` on a fresh parser and compare against `messages`. When `expect_recompiled` is set (where Express merges a root `updateDataModel` into `createSurface.dataModel`), recompile the output and compare against `expect_recompiled` instead.

### Prompt generation

`generate_prompt_snippet` (`prompt_generator.yaml`) builds the target format from `args.catalogs`, optional `args.examples` (loaded from `CONFORMANCE_ROOT`), and optional `args.allowed_messages`. Call `format.promptGenerator.generate()` and check three optional expectations:

1. `expect_file`: Exact string equality against the golden text file at `conformancePath(expect_file)` (used by `direct_json`, which embeds deterministic JSON schemas formatted with 2-space indentation).
2. `expect_contains` and `expect_absent`: Substring presence and absence checks. Express and catalog-pruning cases use these checks so implementations can word prose naturally while still checking every component signature and pruned symbol.
3. `expect_deterministic`: Calling `generate()` a second time on a newly created format with identical inputs returns the exact same string.

### Chunked response streaming

`parse_chunk` (`agent/direct_json/response_streaming.yaml`) feeds a response to a streaming parser one chunk at a time to check progressive emission timing, partial error recovery, and block-state tracking:

1. Construct `DirectJsonFormatFactory` with `args.progressive_keys` (when provided) and create a parser.
2. Open a stream with `wrapped` set to `args.wrapped ?? true`. When `args.after_rejected_block` is `"continue"`, open a continuing stream that emits `{"error": {"category": ...}}` parts for rejected blocks; otherwise default to `"end"`, which raises immediately.
3. Loop over `steps` in order and pass `step.input` to `stream.feed(chunk)`:
   1. If `step.expect_error` is present, catch the raised `A2uiError`, assert its category matches `step.expect_error`, and if `step.expect_partial_results` is present, assert `error.partialResults` matches `step.expect_partial_results`. Check `step.expect_in_block` against `stream.isInBlock` if present, then return from the case.
   2. Otherwise, assert the delta returned by `stream.feed(chunk)` equals `step.expect`, append those parts to an accumulated list, and check `step.expect_in_block` against `stream.isInBlock` if present.
4. Call `stream.close()`. Assert the returned final parts equal `expect_close` when specified, and append them to the accumulated list.
5. When `expect_matches_single_shot` is `true`, join all `step.input` strings and call `parseResponse(joined, wrapped)` on a fresh parser. Merge adjacent `{"text": ...}` parts on both the accumulated stream list and the single-shot result before asserting equality. Merging adjacent text parts is required because streaming emits conversational text chunk by chunk whereas `parseResponse` emits one combined text part.

### Format factories, request processors, and streamed answers

1. `create_format` (`agent/request_processor.yaml` and `agent/multi_catalog_formats.yaml`): Build an `InferenceFormat` through `DirectJsonFormatFactory` or `ExpressFormatFactory` with `args.catalogs` and `args.examples`, then check `expect.prompt_snippet_contains` and `expect.prompt_snippet_absent`. When `expect.parsers_are_distinct` is `true`, check that two `format.createParser()` calls return distinct object instances. When `expect.parser_state_isolated` is `true`, stream `args.probe_chunks` through one parser, check for non-empty output, and check that a second parser produces identical parts.
2. `create_processor` (`agent/request_processor.yaml`): Build `A2uiGenerator` with `args.catalogs`, `args.examples`, `args.accepts_inline_catalogs`, and optional `args.format` (omit the factory argument when `args.format` is absent to test the default Express factory). Snapshot the generator's catalogs before calling `generator.createProcessor(args.renderer_capabilities, formatOverride: args.format_override)`, then check `expect.active_catalog_ids`, positional `expect.catalogs`, prompt snippet checks, and `expect.generator_catalogs_unchanged`. If a sibling `then_parse` block is present, run `processor.parseResponse(then_parse.input, wrapped: then_parse.wrapped ?? true)` and check `then_parse.expect` or `then_parse.expect_error`.
3. `stream_answer` (`agent/streamed_answer.yaml`): Build an `A2uiRequestProcessor` (`DirectJsonFormatFactory` with `args.catalog`) and a Core `MessageProcessor` (`args.renderer_catalogs ?? [args.catalog]`), then open `StreamedAnswer(processor, renderer)`. Unlike `parse_chunk` deltas, each step's `expect_parts` checks the full `answer.parts` list accumulated so far (`{"text": ...}`, `{"surface": surface.id}`, or `{"error": {"category": ...}}`). Assert reference identity (`same` / `===` / `is`) between each `AnswerSurfacePart.surface` and `renderer.model.getSurface(surface.id)`, and check `step.expect_in_block` plus `expect_close` after `answer.close()`.

### Skills, builders, macros, round-trips, and timing suites

1. Skills (`agent/skill.yaml`): Dispatch five actions against `SkillGenerator` and `SkillSet`: `from_format` (`generateSkill`), `core_syntax` (`generateCoreSkill`), `from_catalog` (`generateCatalogSkill`), `skill_set` (`generateSkillSet`), and `export_to_directory` (`SkillSet.exportToDirectory`). Resolve all file paths in this suite from `REPO_ROOT`. Run `export_to_directory` in a temporary directory populated with `args.pre_existing_files` to check that exporting deletes only managed skill subdirectories and preserves sibling files (even on `expect_error`).
2. Fluent builders and macros (`agent/builder/builder.yaml` and `agent/macros/macros.yaml`): Interpret the `$`-prefixed AST sentinels listed in the header comment of [agent/builder/builder.yaml](agent/builder/builder.yaml) (`$bind`, `$componentRef`, `$dynamicChildList`, `$action`, `$checkRule`, `$accessibility`, `$tabItem`, and `$choiceOption`) and in [agent/macros/README.md](agent/macros/README.md) (`$param` and `$spreadParam`). For cases that declare `golden`, compare the expanded envelopes against `golden/<file>.json` and run them through `MessageProcessor` under the case's `validation` flags (`allow_missing_root`, `allow_orphan_components`, `allow_dangling_references`). In `agent/macros/macros.yaml`, also dispatch three non-golden `action` types: `transform_catalog` (macro-to-catalog name collision checks expecting `expect_error`), `transform_to_inference_catalog` (synthesized inference catalog schema assertions in `expect`, with optional `passthrough_components`), and `transform_to_inference` (reverse passthrough of unexpanded messages).
3. Specification example round-trips: Iterate over `catalogs/basic/v1/examples/*.json` (skipping examples with `customComponents`), decompile and recompile each payload, and check equivalence. See [dart/a2ui_agent/test/specification_round_trip_test.dart](../dart/a2ui_agent/test/specification_round_trip_test.dart) and [python/a2ui_agent/tests/test_specification_roundtrip.py](../python/a2ui_agent/tests/test_specification_roundtrip.py) for two edge cases:
   1. Multi-turn examples such as `31_incremental-dashboard.json` replace placeholder components across turns, so split turns into separate payloads or compare final reachable surface state.
   2. Express round-trips on examples with hyphenated IDs or `sendDataModel: true` must replace hyphens with underscores and clear `sendDataModel`.
4. Timing suites (`agent/direct_json/scaling.yaml` and `agent/express/scaling.yaml`): Follow [agent/direct_json/scaling.yaml](agent/direct_json/scaling.yaml) and [Timing cases](#4-timing-cases). Seed `RendererState` with `createSurface` messages for pre-existing surfaces before timing.

### Patterns and pitfalls in Inference harnesses

The existing Python, TypeScript, and Dart harnesses show several reusable patterns and common cross-language pitfalls:

1. Only implement multi-version fixture translation if your SDK explicitly supports legacy protocol versions. If you are building a new SDK targeting protocol v1.0 exclusively, you can run the standard v1.0 suites directly without legacy adapters. However, if your SDK must support older versions like v0.9, do not duplicate test suites across protocol versions. Use a lowering and lifting adapter instead of copying YAML files: the Dart harness ([dart/a2ui_agent/test/conformance/suites.dart](../dart/a2ui_agent/test/conformance/suites.dart)) translates v1.0 test vectors into v0.9 equivalents at test execution time. In its v0.9 pass, the Dart runner converts `"1.0"` to `"v0.9"`, renames `@path` and `@call` outside `ChildList` templates, and injects a default `catalogId`. It also splits inline `createSurface` `components` and `dataModel` fields into follow-up messages before lifting SDK outputs back to v1.0.
2. Format numbers consistently in Express decompilation and prompt examples. JavaScript and TypeScript decode `1500.00` in JSON as `1500`, whereas Python, Kotlin, Swift, and Rust decode `1500.0` with a `.0` suffix. Per [agent/express/decompiler.yaml](agent/express/decompiler.yaml), Express formats numbers like ECMAScript `Number.prototype.toString`: plain decimal for `1e-6 <= |v| < 1e21` and unpadded scientific notation (`1e-7`, `1e+21`) otherwise.
3. Keep `InferenceFormat` stateless across turns. `InferenceFormat` instances live for an entire session or agent lifetime, while `Parser` and `ResponseStream` hold per-response buffers. Storing stream state on `InferenceFormat` causes subtle cross-turn corruption that fails `parser_state_isolated` in `request_processor.yaml`.
4. Keep `unwrap` and `hasFormatContent` free of schema checks. Framing methods inspect only sentinel tags (`<a2ui-json>` or `<a2ui>`), Markdown code fences, and missing-opening-tag recovery rules. Several `response_parser.yaml` cases check that malformed payloads still unwrap cleanly into `RawA2uiPart` items before compilation runs.
5. Accept both reserved-key forms where the version allows. v1.0 catalogs and suites write `@path` and `@call`; a decompiler that reads only `path` and `call` renders a v1.0 catalog example in the prompt as a literal map instead of notation, and the skill goldens under `test_data/skills/` embed that output.

## Framework adapter harness

A framework adapter wraps a Core SDK and renders its surfaces with a UI framework (`@a2ui/lit`, `@a2ui/react`, `@a2ui/angular`, `a2ui_flutter`, or `A2UISwiftUI`). It gets Core protocol coverage through the Core harness of the SDK it wraps, and runs two suites that require a mounted view tree: `core/adapter_conformance.yaml` and `core/accessibility.yaml`. Headless Core runners skip both files (`UNRUNNABLE_SUITES` in Python and `SKIP_TEST_SUITES` in `web_core`).

### Surface rendering and interaction (`core/adapter_conformance.yaml`)

Each case in `core/adapter_conformance.yaml` (`action: render_surface`) loads `catalogPaths` (`catalogs/basic/v1/catalog.json`) plus any inline custom `catalogs` on the case (such as `StatusBadge` in `multi_catalog_mixed_surface_rendering`, which your harness registers with a small view implementation). Register a test `incrementCounter` function implementation for local `functionCall` cases and stub `openUrl` so activation-gated cases do not open a browser. Then run `steps` in order across five `op` types:

1. `process_messages` feeds `messages` into `MessageProcessor`, mounts the surface view if not yet mounted, and waits for framework rendering to settle.
2. `user_input` writes `inputValue` through the rendered input control for `targetNode` to verify two-way `@path` binding propagation to `DataModel` and dependent views.
3. `user_gesture` triggers `targetNode` with `userActivation: true` (such as a user click or tap).
4. `programmatic_invoke` triggers `targetNode`'s action programmatically with `userActivation: false` so functions with `requiresUserActivation: true` are blocked and report an error on the surface error channel.
5. `unmount_surface` unmounts and disposes the rendered surface view.

After each step settles, check whichever of the seven assertion fields are present on the step:

1. `expectViewTree` checks the rendered hierarchy (`id`, `type`, `state` of `resolved`, `pending`, `unknown-type`, or `cyclic`, rendered `text`, `value`, or custom props, `isValid`, `validationErrors`, `validationResults`, and ordered `children`). This covers single-message inline v1.0 surfaces, progressive placeholder upgrades, `List` repeaters with `${@index()}`, fallback placeholders, and check severity (`error` sets `isValid: false`, whereas `warning` keeps `isValid: true`).
2. `expectSameViewIdentity` lists node paths (`"root"`, `"root/children/0"`) whose underlying DOM element, widget state, or node instance must keep its identity across updates and list mutations rather than remounting.
3. `expectDataModel` checks the surface data model after inline initialization, two-way user input, or local `functionCall` mutations.
4. `expectActions` checks outbound action events (`name`, `surfaceId`, `sourceComponentId`, `context`); `[]` asserts that local `functionCall` or blocked programmatic calls emit no outbound event.
5. `expectErrors` checks surface diagnostics (`code` such as `UNKNOWN_COMPONENT_TYPE` or `CYCLIC_REFERENCE`, `surfaceId`, and `message`).
6. `expectAccessibilityTree` checks per-component accessibility attributes (`label`, `description`, `live`, `hidden`, `role`), including implicit button label inference from child `Text` and explicit `accessibility.label` overrides.
7. `expectActiveSubscriptions` checks the remaining reactive listener count held by the mounted surface (`0` after `unmount_surface`).

### Accessibility tree and axe-core (`core/accessibility.yaml`)

Each case in `core/accessibility.yaml` (`action: accessibility_check`) provides both v1.0 protocol `messages` (plus multi-step `steps` with `messages` and `assertions` on `test_accessibility_dynamic_label_and_hidden_binding` for live `updateDataModel` updates) and an inline `surface` map for non-DOM inspection. UI framework adapters (and `web_core`'s universal custom-element runner) mount from `messages` or `steps`, whereas Swift's headless [swift/core/Tests/A2UIConformanceTests/AccessibilityConformanceTests.swift](../swift/core/Tests/A2UIConformanceTests/AccessibilityConformanceTests.swift) inspects `Node.accessibilityAttributes` from `surface` (checking `{path}` binding maps on the top-level `assertions` block before data resolution). Each `assertions` block has two parts:

1. `accessibilityTree` maps each component ID to expected `label`, `description`, `live`, `hidden`, `role` (`button`, `textbox`, `checkbox`, `radiogroup`), and `checked` (`true`) values. Check ARIA attributes (`role`, `aria-label`, `aria-description`, `aria-live`, `aria-hidden`, `aria-checked`) on the DOM for Lit, React, and Angular, `SemanticsNode` properties for Flutter, and `A2UIAccessibilityModifier` state for SwiftUI.
2. `axeCore` lists axe-core rule IDs (`button-name`, `aria-valid-attr-value`, `aria-allowed-attr`, `aria-hidden-focus`) that the mounted DOM must pass. Web adapters run axe-core on the rendered container; non-web adapters skip `axeCore` with a reason.

Where a browser-based test runner cannot read YAML from disk at test time, parse the suite files in the runner configuration and inject them as JSON. For example, [typescript/renderers/angular/karma.conf.js](../typescript/renderers/angular/karma.conf.js) parses `accessibility.yaml`, `adapter_conformance.yaml`, and `catalogs/basic/v1/catalog.json` in Node and exposes them to Jasmine browser specs via `client.conformanceSuites`.

## Reference harnesses

Inspect these existing implementations for concrete code examples:

1. Core SDK:
   1. Python: [python/a2ui_core/tests/test_conformance.py](../python/a2ui_core/tests/test_conformance.py), [python/a2ui_core/tests/node_resolution_runner.py](../python/a2ui_core/tests/node_resolution_runner.py), and [python/a2ui_core/tests/timing_harness.py](../python/a2ui_core/tests/timing_harness.py)
   2. TypeScript: [typescript/core/web_core/tests/conformance/conformance_test.mjs](../typescript/core/web_core/tests/conformance/conformance_test.mjs), [typescript/core/web_core/tests/conformance/node-resolution.ts](../typescript/core/web_core/tests/conformance/node-resolution.ts), [typescript/core/web_core/tests/conformance/accessibility_conformance.test.ts](../typescript/core/web_core/tests/conformance/accessibility_conformance.test.ts), and [typescript/core/web_core/tests/timing/timing.mjs](../typescript/core/web_core/tests/timing/timing.mjs)
   3. Dart: [dart/a2ui_core/test/conformance/conformance_harness.dart](../dart/a2ui_core/test/conformance/conformance_harness.dart) and the per-suite `*_conformance_test.dart` files beside it
   4. Swift: [swift/core/Tests/A2UIConformanceTests/ConformanceTestHelper.swift](../swift/core/Tests/A2UIConformanceTests/ConformanceTestHelper.swift) and the per-suite `*ConformanceTests.swift` files beside it
2. Inference SDK, Python (`pytest` parametrized suites, builder and macro AST interpreters):
   1. [python/a2ui_agent/tests/conformance/conformance_helpers.py](../python/a2ui_agent/tests/conformance/conformance_helpers.py)
   2. [python/a2ui_agent/tests/conformance/test_conformance.py](../python/a2ui_agent/tests/conformance/test_conformance.py)
   3. [python/a2ui_agent/tests/conformance/test_catalog_conformance.py](../python/a2ui_agent/tests/conformance/test_catalog_conformance.py)
   4. [python/a2ui_agent/tests/conformance/test_skill_conformance.py](../python/a2ui_agent/tests/conformance/test_skill_conformance.py)
   5. [python/a2ui_agent/tests/conformance/test_scaling_conformance.py](../python/a2ui_agent/tests/conformance/test_scaling_conformance.py)
   6. [python/a2ui_agent/tests/conformance/builder_suite.py](../python/a2ui_agent/tests/conformance/builder_suite.py) and [python/a2ui_agent/tests/conformance/macro_suite.py](../python/a2ui_agent/tests/conformance/macro_suite.py)
   7. [python/a2ui_agent/tests/test_specification_roundtrip.py](../python/a2ui_agent/tests/test_specification_roundtrip.py)
3. Inference SDK, TypeScript (`vitest` suites with strict `KNOWN_FAILURES` vs `UNSUPPORTED` classification):
   1. [typescript/agents/a2ui_agent/tests/conformance/loader.ts](../typescript/agents/a2ui_agent/tests/conformance/loader.ts), [typescript/agents/a2ui_agent/tests/conformance/fixtures.ts](../typescript/agents/a2ui_agent/tests/conformance/fixtures.ts), and [typescript/agents/a2ui_agent/tests/conformance/suite-helpers.ts](../typescript/agents/a2ui_agent/tests/conformance/suite-helpers.ts)
   2. [typescript/agents/a2ui_agent/tests/conformance/direct-json-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/direct-json-conformance.test.ts) and [typescript/agents/a2ui_agent/tests/conformance/direct-json-response-streaming.test.ts](../typescript/agents/a2ui_agent/tests/conformance/direct-json-response-streaming.test.ts)
   3. [typescript/agents/a2ui_agent/tests/conformance/express-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/express-conformance.test.ts)
   4. [typescript/agents/a2ui_agent/tests/conformance/skill-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/skill-conformance.test.ts) and [typescript/agents/a2ui_agent/tests/conformance/streamed-answer.test.ts](../typescript/agents/a2ui_agent/tests/conformance/streamed-answer.test.ts)
   5. [typescript/agents/a2ui_agent/tests/timing/scaling_test.mjs](../typescript/agents/a2ui_agent/tests/timing/scaling_test.mjs)
4. Inference SDK, Dart (`package:test` suites with dual v0.9/v1.0 `SuiteVersion` lowering and lifting):
   1. [dart/a2ui_agent/test/conformance/suites.dart](../dart/a2ui_agent/test/conformance/suites.dart)
   2. [dart/a2ui_agent/test/conformance/direct_json_conformance_test.dart](../dart/a2ui_agent/test/conformance/direct_json_conformance_test.dart)
   3. [dart/a2ui_agent/test/conformance/express_conformance_test.dart](../dart/a2ui_agent/test/conformance/express_conformance_test.dart)
   4. [dart/a2ui_agent/test/conformance/request_processor_conformance_test.dart](../dart/a2ui_agent/test/conformance/request_processor_conformance_test.dart) and [dart/a2ui_agent/test/conformance/streamed_answer_conformance_test.dart](../dart/a2ui_agent/test/conformance/streamed_answer_conformance_test.dart)
   5. [dart/a2ui_agent/test/conformance/scaling_conformance_test.dart](../dart/a2ui_agent/test/conformance/scaling_conformance_test.dart)
   6. [dart/a2ui_agent/test/specification_round_trip_test.dart](../dart/a2ui_agent/test/specification_round_trip_test.dart)
5. Framework adapters (`adapter_conformance.yaml` and `accessibility.yaml`):
   1. Lit (`node:test` and JSDOM): [typescript/renderers/lit/src/tests/adapter_conformance.test.ts](../typescript/renderers/lit/src/tests/adapter_conformance.test.ts)
   2. React (`vitest` and Testing Library): [typescript/renderers/react/tests/adapter_conformance.test.tsx](../typescript/renderers/react/tests/adapter_conformance.test.tsx)
   3. Angular (Karma and Jasmine browser runner): [typescript/renderers/angular/src/adapter_conformance.spec.ts](../typescript/renderers/angular/src/adapter_conformance.spec.ts) and [typescript/renderers/angular/karma.conf.js](../typescript/renderers/angular/karma.conf.js)
   4. Flutter (`flutter_test` widget and `SemanticsNode` tree checks): [dart/a2ui_flutter/test/adapter_conformance_test.dart](../dart/a2ui_flutter/test/adapter_conformance_test.dart)
   5. SwiftUI (`Testing` on `Surface`, `SurfaceViewModel`, and `A2UIAccessibilityModifier`): [swift/swiftui/Tests/A2UISwiftUITests/AdapterConformanceTests.swift](../swift/swiftui/Tests/A2UISwiftUITests/AdapterConformanceTests.swift)

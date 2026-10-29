# Implementing inference conformance harnesses

This guide explains how to build a conformance test harness for an A2UI Inference SDK on a new platform. In the SDK architecture defined in [specification/v1_0/docs/sdks_spec.md](../specification/v1_0/docs/sdks_spec.md), the Inference SDK sits on top of the Core SDK. It generates system prompts, negotiates component catalogs, parses and streams model responses, compiles shorthand notations into A2UI messages, and exports agent skills.

Across this repository, packages and test suites name the Inference SDK tier `a2ui_agent`. Its language-agnostic YAML suites live under `conformance/agent/` and target the public interface in [blueprints/modules/a2ui_agent.blueprint.md](../blueprints/modules/a2ui_agent.blueprint.md).

A conformance harness is a thin adapter inside your language package's test directory. It reads the shared YAML files and constructs catalogs and formats through your SDK's public entry points. Then it invokes the `action` each test case names, normalizes the output to JSON values, and checks the expected fields or error categories.

## Prerequisites and scope

Before building the inference harness, complete the `conformance/core/` harness for your Core SDK first. The inference suites depend directly on four Core SDK capabilities:

1. Loading catalog JSON documents into `Catalog` objects and pruning them into derived catalogs.
2. Parsing and serializing `AgentToRendererMessage` envelopes without losing field types.
3. Checking a turn's messages with `validatePayload` (a stateless Core SDK utility function that validates message envelopes against active schemas and catalogs without needing a running session) and applying messages to a `MessageProcessor`.
4. Raising typed errors from the `A2uiError` hierarchy (`A2uiParseError`, `A2uiValidationError`, and `A2uiCatalogError`).

Do not implement a runner for the files under `conformance/agent/legacy/` (`parser.yaml`, `streaming_parser.yaml`, and `inference_format.yaml`). Those three files test an earlier pre-blueprint interface retained only for backward compatibility. Every rule for a new SDK lives in the suites directly under `agent/`, `agent/direct_json/`, and `agent/express/`.

## Repository layout and path resolution

The `conformance/` directory sits at the root of the monorepo alongside the specification, published catalogs, and language SDK directories:

```text
a2ui/
├── catalogs/basic/v1/                 # Published v1.0 basic catalog and JSON examples
├── specification/                     # Protocol JSON schemas (v0_8, v0_9, v0_9_1, v1_0)
├── conformance/
│   ├── conformance_schema.json        # JSON Schema checking all YAML test cases
│   ├── README.md                      # Overview of core, agent, and extension suites
│   ├── agent/                         # Format-independent inference SDK suites
│   │   ├── direct_json/               # Direct JSON format suites and scaling tests
│   │   ├── express/                   # Express format suites and scaling tests
│   │   ├── builder/                   # Fluent builder AST suite and golden JSON files
│   │   ├── macros/                    # Composite macro AST suite and golden JSON files
│   │   └── legacy/                    # Deprecated pre-blueprint suites (skip on new SDKs)
│   ├── extensions/                    # Optional A2A and ADK framework bridge suites
│   └── test_data/                     # Shared catalog, example, prompt, and skill fixtures
├── python/a2ui_agent/                 # Python reference SDK and conformance harness
├── typescript/agents/a2ui_agent/      # TypeScript reference SDK and conformance harness
└── dart/a2ui_agent/                   # Dart reference SDK and conformance harness
```

Locate the repository root dynamically rather than hardcoding `../` segments or requiring an environment variable. Walk upward from the test file directory or current working directory until you find `conformance/conformance_schema.json`. Store both `REPO_ROOT` (that ancestor directory) and `CONFORMANCE_ROOT` (`<REPO_ROOT>/conformance`).

Watch for two different base-path conventions when resolving fixture paths from YAML cases:

1. Almost all `conformance/agent/` suites write paths relative to `CONFORMANCE_ROOT`. For example, `test_data/catalogs/simplified_catalog_v1_0.json` resolves under `conformance/test_data/`, and `../specification/v0_9/catalogs/basic/catalog.json` steps up from `conformance/` into `specification/`.
2. Suites that reference workspace-level artifacts or skills write paths relative to `REPO_ROOT` instead. For example, [agent/skill.yaml](agent/skill.yaml) uses repository-root paths for `args.catalog`, `expected_file`, and `expected_skill_files`. Provide separate `conformancePath(rel)` and `repoPath(rel)` helpers so path resolution stays explicit.

Every standard YAML suite is a top-level list of test case objects checked in CI against [conformance_schema.json](conformance_schema.json) by [conformance/tests/test_conformance_yaml.py](tests/test_conformance_yaml.py). Two suites are exempted from that schema check: [agent/builder/builder.yaml](agent/builder/builder.yaml) and [agent/macros/macros.yaml](agent/macros/macros.yaml). Both use a top-level `{macros, tests}` map and identify cases by `id` rather than `name`.

## Staged implementation order

Implement the suites in six stages so each layer is tested before higher-level components depend on it:

| Stage                                 | Suites to add                                                                                                                    | SDK surface checked                                                                                                  |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| 1. Catalog plumbing                   | `agent/catalog_provider.yaml`, `agent/catalog_transformer.yaml`, `agent/catalog_resolution.yaml`                                 | `FileSystemCatalogProvider`, `InMemoryCatalogProvider`, `CatalogConfig`, pruning transformers, and `resolveCatalogs` |
| 2. Direct JSON format                 | `agent/direct_json/response_parser.yaml`, `compiler.yaml`, `decompiler.yaml`, `prompt_generator.yaml`, `response_streaming.yaml` | Sentinel framing (`<a2ui-json>`), single-block compilation, prompt golden matching, and incremental JSON streaming   |
| 3. Express format                     | `agent/express/response_parser.yaml`, `compiler.yaml`, `decompiler.yaml`, `prompt_generator.yaml`                                | Sentinel framing (`<a2ui>`), Express grammar parsing, compilation, decompilation, and prompt generation              |
| 4. Multi-catalog and session pipeline | `agent/multi_catalog_formats.yaml`, `agent/request_processor.yaml`, `agent/streamed_answer.yaml`                                 | Cross-catalog lookup, `InferenceFormatFactory`, `A2uiGenerator`, `A2uiRequestProcessor`, and `StreamedAnswer`        |
| 5. Specification round-trips          | `catalogs/basic/v1/examples/*.json` (and v0.9 examples if supported)                                                             | End-to-end `decompile` followed by `compile` across every published basic catalog example                            |
| 6. Skills, macros, and scaling        | `agent/skill.yaml`, `agent/builder/builder.yaml`, `agent/macros/macros.yaml`, `agent/*/scaling.yaml`, `extensions/*`             | Skill generation, typesafe fluent builders, macros, linear-time scaling, and optional A2A or ADK bridges             |

Notice that `agent/express/` has no `response_streaming.yaml` file. Express parses whole buffered blocks and does not implement `openStream`.

## Core harness plumbing

All three reference harnesses (Python, TypeScript, and Dart) centralize five shared responsibilities in a small helper module before writing per-suite test files.

### 1. YAML loading and plain-value conversion

Use a YAML 1.2 parser to load suite files. Older YAML 1.1 parsers convert unquoted words such as `yes`, `no`, `on`, or `off` into booleans. They also parse colon-separated digits as base-60 numbers, which corrupts test inputs.

Some YAML libraries return custom wrapper types such as `YamlMap` and `YamlList` in Dart. Recursively convert every loaded case into native maps, lists, strings, numbers, booleans, and nulls before running your SDK or deep-equality assertions.

### 2. Filtering, skip lists, and strict failure tracking

Configure two top-level constants in your runner as described in [README.md](README.md): `SUPPORTED_PROTOCOL_VERSIONS` and `SKIP_TEST_NAMES`. Note the protocol version strings used across `conformance_schema.json`: pre-1.0 versions carry a `v` prefix (`"v0.8"`, `"v0.9"`, `"v0.9.1"`), whereas version 1.0 is bare `"1.0"`.

Follow three safeguards so your test suite never hides regressions behind green results:

1. Assert in every suite file that the loaded case list is not empty. If a file path breaks during refactoring, the suite fails immediately instead of passing zero tests.
2. Throw an unhandled-action error in the `default` branch of every `action` dispatcher. Leaving out a `default` branch lets newly added actions pass without running any assertions.
3. Separate unimplemented capabilities from defects in implemented code, following [typescript/agents/a2ui_agent/tests/conformance/loader.ts](../typescript/agents/a2ui_agent/tests/conformance/loader.ts) and [python/a2ui_agent/tests/conformance/test_conformance.py](../python/a2ui_agent/tests/conformance/test_conformance.py). Mark unsupported versions or unbuilt modules as `[SKIPPED]`, and mark known bugs with a strict expected-failure marker (`pytest.mark.xfail(strict=True)` or Vitest `test.fails`). When a code change fixes a known bug, a strict expected failure fails CI right away so you delete the stale entry.

### 3. Loading catalog fixtures and registrations

Agent cases do not declare a top-level `protocolVersion` field. Instead, each case runs under the version its catalog document declares (almost always `"1.0"`).

In `args.catalog` and `args.catalogs`, a case specifies a catalog in one of three forms:

1. A string path relative to `CONFORMANCE_ROOT`, such as `"test_data/catalogs/simplified_catalog_v1_0.json"`.
2. An inline JSON object representing the catalog document directly in YAML.
3. A registration map `{"catalog": <path or inline object>, "transformers": [...]}` corresponding to `CatalogConfig`. Each entry in `transformers` specifies either `{"component_pruning": <list or null>}` or `{"function_pruning": <list or null>}`. Cases write allowlists literally: omitting a transformer keeps every entry, whereas an empty list `[]` or `null` keeps nothing.

Apply three fallback rules when building a shared catalog loader for test fixtures:

1. When a format case omits both `args.catalog` and `args.catalogs` (common in `unwrap` and `wrap`), load `test_data/catalogs/simplified_catalog_v1_0.json` to build the parser.
2. When a fixture document omits `catalogId` (outside `catalog_provider.yaml`, which tests missing IDs directly), supply its relative fixture path as the fallback `catalogId`.
3. When a fixture omits `protocolVersion`, default to `"1.0"`. Published v0.9 catalog files (paths containing `v0_9`) omit `protocolVersion` on disk and need `"v0.9"` instead.

### 4. Default surface IDs and `compileChecked`

In Express, an author can omit `surface(...)` when targeting a single default surface. Conformance expectations assume that default surface ID is `"default_surface"`. Pass `"default_surface"` when constructing your Express parser or compiler if your SDK uses a different default in production.

Implement a shared `compileChecked(parser, content)` helper for all `compile` cases and `decompile` round-trip checks:

1. Call `parser.compile(content)` to produce `AgentToRendererMessage` objects. If your compiler throws a raw JSON or grammar exception that does not inherit from `A2uiError`, wrap it in your compilation parse error type first.
2. Call `validatePayload(parser.catalogs, messages)` from your Core or Agent check layer. Unlike a fresh `MessageProcessor`, `validatePayload` checks one block in isolation and assumes any surface updated without `createSurface` was created in an earlier turn.
3. Return the checked messages and serialize them to plain JSON maps, omitting default optional values that v1.0 leaves out (such as `sendDataModel: false` on `createSurface`).

### 5. Mapping error categories

Test cases express failures through `expect_error` (or `expectError` in older extension suites) using language-agnostic category names from `ExpectError` in [conformance_schema.json](conformance_schema.json):

| Schema `category`  | Meaning in agent suites                                                                            | Typical SDK error classes                                                                           |
| :----------------- | :------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `ParseError`       | Malformed JSON, invalid Express syntax, unterminated sentinel block, or invalid file JSON          | `A2uiParseError`, `A2uiCompilationParseError`                                                       |
| `ValidationError`  | Valid syntax naming an unknown component, invalid property, duplicate ID, missing root, or cycle   | `A2uiValidationError`, `A2uiCompilationValidationError`, `A2uiIntegrityError`, `A2uiRecursionError` |
| `CatalogError`     | Missing catalog file, conflicting catalog ID or protocol version, or failed capability negotiation | `A2uiCatalogError`                                                                                  |
| `CompilationError` | General compilation failure not narrowed to syntax or schema checks                                | `A2uiCompilationError`                                                                              |

Pay close attention to class inheritance if your target language supports only single inheritance. In Python, `A2uiCompilationParseError` inherits from both `A2uiCompilationError` and `A2uiParseError`, so a single `isinstance(err, A2uiParseError)` check matches both core and compiler parse errors.

In single-inheritance languages (TypeScript, Dart, Kotlin, Swift, Java, or Rust), make `A2uiCompilationParseError` extend `A2uiParseError` directly. Alternatively, map `"ParseError"` and `"ValidationError"` in your runner to match both the core error class and its compiler counterpart. When `expect_error` also includes a `message` string, match it as a regular expression against the thrown error's message.

## Action reference by suite

Once your shared loader and error matcher are in place, implement handlers for each action group.

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

1. Skills (`agent/skill.yaml`): Dispatch five actions against `SkillGenerator` and `SkillSet`: `from_format` (`generateSkill`), `core_syntax` (`generateCoreSkill`), `from_catalog` (`generateCatalogSkill`), `skill_set` (`generateSkillSet`), and `export_to_directory` (`SkillSet.exportToDirectory`). Resolve all file paths in this suite from `REPO_ROOT`. Run `export_to_directory` in a temporary directory populated with `args.pre_existing_files` to check that exporting deletes only managed skill subdirectories and preserves sibling files (even on `expect_error`). If your platform integrates with specific agent frameworks (like Google ADK or A2A), implement the optional framework bridge suites under [extensions/](extensions/) as separate modules; these are not required for baseline inference conformance.
2. Fluent builders and macros (`agent/builder/builder.yaml` and `agent/macros/macros.yaml`): Interpret the `$`-prefixed AST nodes in [agent/builder/README.md](agent/builder/README.md) and [agent/macros/README.md](agent/macros/README.md). Map `$bind`, `$componentRef`, `$dynamicChildList`, `$action`, `$checkRule`, `$accessibility`, `$param`, and `$spreadParam` to your builder and macro APIs. Every non-error case must match `golden/<file>.json` and pass `MessageProcessor` checks under its `validation` flags (`allow_missing_root`, `allow_orphan_components`, `allow_dangling_references`).
3. Specification example round-trips: Iterate over `catalogs/basic/v1/examples/*.json` (skipping examples with `customComponents`), decompile and recompile each payload, and check equivalence. See [dart/a2ui_agent/test/specification_round_trip_test.dart](../dart/a2ui_agent/test/specification_round_trip_test.dart) and [python/a2ui_agent/tests/test_specification_roundtrip.py](../python/a2ui_agent/tests/test_specification_roundtrip.py) for two edge cases:
   1. Multi-turn examples such as `31_incremental-dashboard.json` replace placeholder components across turns, so split turns into separate payloads or compare final reachable surface state.
   2. Express round-trips on examples with hyphenated IDs or `sendDataModel: true` must replace hyphens with underscores and clear `sendDataModel`.
4. Timing suites (`agent/direct_json/scaling.yaml` and `agent/express/scaling.yaml`): Tag timing tests so regular unit test runs skip them and CI runs them in an isolated job. Follow [agent/direct_json/scaling.yaml](agent/direct_json/scaling.yaml) by building `InferenceFormat` and catalogs outside the timer and expanding `PayloadTemplate` (`repeat` segments replacing `{i}` joined by `separator`). Seed `RendererState` with `createSurface` messages for pre-existing surfaces, run one warmup pass, and alternate 5+ runs to check `median(measured) / median(baseline) <= max_ratio`.

## Patterns and pitfalls

The existing Python, TypeScript, and Dart harnesses show several reusable patterns and common cross-language pitfalls:

1. Only implement multi-version fixture translation if your SDK explicitly supports legacy protocol versions. If you are building a new SDK targeting protocol v1.0 exclusively, you can run the standard v1.0 suites directly without legacy adapters. However, if your SDK must support older versions like v0.9, do not duplicate test suites across protocol versions. Use a lowering and lifting adapter instead of copying YAML files: the Dart harness ([dart/a2ui_agent/test/conformance/suites.dart](../dart/a2ui_agent/test/conformance/suites.dart)) translates v1.0 test vectors into v0.9 equivalents at test execution time. In its v0.9 pass, the Dart runner converts `"1.0"` to `"v0.9"`, renames `@path` and `@call` outside `ChildList` templates, and injects a default `catalogId`. It also splits inline `createSurface` `components` and `dataModel` fields into follow-up messages before lifting SDK outputs back to v1.0.
2. Format numbers consistently in Express decompilation and prompt examples. JavaScript and TypeScript decode `1500.00` in JSON as `1500`, whereas Python, Kotlin, Swift, and Rust decode `1500.0` with a `.0` suffix. Per [agent/express/decompiler.yaml](agent/express/decompiler.yaml), Express formats numbers like ECMAScript `Number.prototype.toString`: plain decimal for `1e-6 <= |v| < 1e21` and unpadded scientific notation (`1e-7`, `1e+21`) otherwise.
3. Avoid forced major garbage collection inside timing loops. In V8 or the JVM, forcing a full GC between runs can deoptimize compiled code and push `4n` past `max_ratio`. See [typescript/core/web_core/tests/timing/timing.mjs](../typescript/core/web_core/tests/timing/timing.mjs) for details, and rely on untimed warmup runs plus median aggregation instead of manual GC calls.
4. Keep `InferenceFormat` stateless across turns. `InferenceFormat` instances live for an entire session or agent lifetime, while `Parser` and `ResponseStream` hold per-response buffers. Storing stream state on `InferenceFormat` causes subtle cross-turn corruption that fails `parser_state_isolated` in `request_processor.yaml`.
5. Keep `unwrap` and `hasFormatContent` free of schema checks. Framing methods inspect only sentinel tags (`<a2ui-json>` or `<a2ui>`), Markdown code fences, and missing-opening-tag recovery rules. Several `response_parser.yaml` cases check that malformed payloads still unwrap cleanly into `RawA2uiPart` items before compilation runs.

## Reference harnesses

Inspect these existing implementations for concrete code examples in three language styles:

1. Python (`pytest` parametrized suites, builder and macro AST interpreters):
   1. [python/a2ui_agent/tests/conformance/conformance_helpers.py](../python/a2ui_agent/tests/conformance/conformance_helpers.py)
   2. [python/a2ui_agent/tests/conformance/test_conformance.py](../python/a2ui_agent/tests/conformance/test_conformance.py)
   3. [python/a2ui_agent/tests/conformance/test_catalog_conformance.py](../python/a2ui_agent/tests/conformance/test_catalog_conformance.py)
   4. [python/a2ui_agent/tests/conformance/test_skill_conformance.py](../python/a2ui_agent/tests/conformance/test_skill_conformance.py)
   5. [python/a2ui_agent/tests/conformance/test_scaling_conformance.py](../python/a2ui_agent/tests/conformance/test_scaling_conformance.py)
   6. [python/a2ui_agent/tests/conformance/builder_suite.py](../python/a2ui_agent/tests/conformance/builder_suite.py) and [python/a2ui_agent/tests/conformance/macro_suite.py](../python/a2ui_agent/tests/conformance/macro_suite.py)
   7. [python/a2ui_agent/tests/test_specification_roundtrip.py](../python/a2ui_agent/tests/test_specification_roundtrip.py)
2. TypeScript (`vitest` suites with strict `KNOWN_FAILURES` vs `UNSUPPORTED` classification):
   1. [typescript/agents/a2ui_agent/tests/conformance/loader.ts](../typescript/agents/a2ui_agent/tests/conformance/loader.ts), [typescript/agents/a2ui_agent/tests/conformance/fixtures.ts](../typescript/agents/a2ui_agent/tests/conformance/fixtures.ts), and [typescript/agents/a2ui_agent/tests/conformance/suite-helpers.ts](../typescript/agents/a2ui_agent/tests/conformance/suite-helpers.ts)
   2. [typescript/agents/a2ui_agent/tests/conformance/direct-json-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/direct-json-conformance.test.ts) and [typescript/agents/a2ui_agent/tests/conformance/direct-json-response-streaming.test.ts](../typescript/agents/a2ui_agent/tests/conformance/direct-json-response-streaming.test.ts)
   3. [typescript/agents/a2ui_agent/tests/conformance/express-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/express-conformance.test.ts)
   4. [typescript/agents/a2ui_agent/tests/conformance/skill-conformance.test.ts](../typescript/agents/a2ui_agent/tests/conformance/skill-conformance.test.ts) and [typescript/agents/a2ui_agent/tests/conformance/streamed-answer.test.ts](../typescript/agents/a2ui_agent/tests/conformance/streamed-answer.test.ts)
   5. [typescript/agents/a2ui_agent/tests/timing/scaling_test.mjs](../typescript/agents/a2ui_agent/tests/timing/scaling_test.mjs)
3. Dart (`package:test` suites with dual v0.9/v1.0 `SuiteVersion` lowering and lifting):
   1. [dart/a2ui_agent/test/conformance/suites.dart](../dart/a2ui_agent/test/conformance/suites.dart)
   2. [dart/a2ui_agent/test/conformance/direct_json_conformance_test.dart](../dart/a2ui_agent/test/conformance/direct_json_conformance_test.dart)
   3. [dart/a2ui_agent/test/conformance/express_conformance_test.dart](../dart/a2ui_agent/test/conformance/express_conformance_test.dart)
   4. [dart/a2ui_agent/test/conformance/request_processor_conformance_test.dart](../dart/a2ui_agent/test/conformance/request_processor_conformance_test.dart) and [dart/a2ui_agent/test/conformance/streamed_answer_conformance_test.dart](../dart/a2ui_agent/test/conformance/streamed_answer_conformance_test.dart)
   5. [dart/a2ui_agent/test/conformance/scaling_conformance_test.dart](../dart/a2ui_agent/test/conformance/scaling_conformance_test.dart)
   6. [dart/a2ui_agent/test/specification_round_trip_test.dart](../dart/a2ui_agent/test/specification_round_trip_test.dart)

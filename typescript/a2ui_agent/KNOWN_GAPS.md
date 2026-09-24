# `@a2ui/agent` — Known Gaps

This document consolidates outstanding TODO items, deliberate scope decisions, and known limitations for the `@a2ui/agent` TypeScript SDK. It is grouped by the component or team responsible for the next action.

Most of these are deliberate scope boundaries rather than defects. However, a few represent genuine sharp edges that callers must navigate carefully.

## 1. `@a2ui/agent` (This package)

### Unvalidated Direct JSON parser output (Sharp edge)

- **What it is:** `DirectJsonParser.compile` bypasses Zod validation and directly casts the JSON output to `AgentToRendererMessage[]` via an unchecked `as` cast.
- **Why it exists:** The validation step was deferred to `A2uiRequestProcessor`, which runs `processMessages` on the output.
- **What it risks:** Callers who use the `Parser` directly rather than through the `A2uiRequestProcessor` facade will receive unvalidated payloads that might not adhere to the protocol schema, leading to unpredictable runtime errors downstream.
- **Done looks like:** Schema validation is enforced inside `compile` (e.g., using a direct Zod parse) before returning the payloads.

### State leakage across requests (Sharp edge)

- **What it is:** `A2uiRequestProcessor` holds a single `MessageProcessor` that accrues state across every `parseResponse` call.
- **Why it exists:** `MessageProcessor` is inherently stateful, tracking created surfaces to validate future updates.
- **What it risks:** Re-sending the same `createSurface` in a new payload across multiple turns of a conversational session using the same processor instance will throw an `A2uiStateError`. Callers must manually recreate and recycle the `A2uiRequestProcessor` per _request_ (turn), not per session.
- **Done looks like:** The request-scoped lifecycle is prominently documented, or the internal structure is changed to expose a clear `reset()` method.

### Partial protocol version support and unimplemented formats

- **What it is:** The package supports `v1.0` and `v0.9`. `v0.8` and the Elemental and Atom inference formats remain unimplemented. Direct JSON and Express are implemented; Express does not stream.
- **Why it exists:** An explicit scope decision to add protocol support incrementally, starting with `v1.0`. `v0.8` is out of scope for this SDK.
- **What it blocks:** Elemental and Atom use cases, and streaming Express output.
- **Done looks like:** The `InferenceFormat` seam is populated with implementations for Elemental and Atom.

### Express compilation errors have one parent class

- **What it is:** `A2uiCompilationParseError` and `A2uiCompilationValidationError` extend `A2uiCompilationError` only. In main's Python they also inherit from the core parse and validation errors, so an `except A2uiValidationError` there catches an Express validation failure. The Express compiler also raises its own `ExpressSyntaxError` where Python raises the built-in `SyntaxError`.
- **Why it exists:** TypeScript classes have a single parent.
- **What it risks:** Code that catches `ParseError` or `A2uiValidationError` to handle every format misses Express compilation errors. The conformance harness accepts either class for the `ParseError` and `ValidationError` categories.
- **Done looks like:** Callers have one documented way to catch a compile failure from any format, such as a shared interface or a `category` field checked by a type guard.

### Express number formatting differs from Python

- **What it is:** JavaScript has one number type, so Express `1.0` and `1` compile to the same value, where Python keeps an int and a float. When the prompt generator rewrites catalog JSON examples as Express, it keeps the `.0` of values such as `1500.00`, as Python does, by reading the source text of each number during `JSON.parse`. That needs Node 21 or later. On older runtimes those values are written without the `.0`, and the generated catalog instructions no longer match Python's.
- **Why it exists:** Python's decompiler prints floats with `repr`, and a JavaScript number does not record how it was written.
- **What it risks:** Small textual differences in prompts on old Node versions. The repository uses Node 22.
- **Done looks like:** Nothing, unless the package has to support Node 20, in which case example numbers need a custom JSON reader.

### Express decompiler skips components its catalog doesn't declare

- **What it is:** When `ExpressDecompiler` meets a component whose name is not in the catalog, it leaves it out of the output without an error (`decompiler.ts`, the `helper.components.has(compName)` check in `decompileSurfaceGroup`). Python does the same.
- **Why it exists:** Ported from Python. The compiler now rejects unknown components, but the decompiler was not changed to match. No specification or conformance case says what the decompiler should do here: `specification/inference_formats/express/` holds only the grammar, the Express proposals don't mention it, and `conformance/agent/express/decompiler.yaml` has no case for it.
- **What it risks:** An example that uses a component from another catalog, or a misspelled one, becomes a shorter Express example with no warning, and the model is shown something other than what the author wrote.
- **Done looks like:** The decompiler throws for an unknown component, and a conformance case pins it for both SDKs, which likely means changing Python to throw too. Throwing is our reading of two things the suite does state: the `decompiler.yaml` header requires every decompiled case to recompile to the messages it started from, which a dropped component breaks, and `compiler.yaml` makes an unknown component a validation error (`test_compile_express_unknown_component_is_a_validation_error`).

### Express logs the catalog fallback with `console.warn`

- **What it is:** When several catalogs are active and an Express block names none, the compiler uses the first catalog and calls `console.warn`. The package has no logger, so callers cannot route or silence the message.
- **Why it exists:** The user asked that the fallback be visible. `console.warn` is the only channel the package has.
- **What it risks:** Noise in server logs for agents that deliberately rely on the first catalog.
- **Done looks like:** A logging hook on the processor or format, if a caller needs one.

### The per-format conformance suites are not run

- **What it is:** Merging `main` into `v1_0` reorganized `conformance/agent/`. The parser, streaming parser and inference format suites this harness runs moved unchanged to `agent/legacy/`, and the harness reads them there, as Python's does. The suites added for the blueprint interface are not run: `agent/direct_json/*.yaml`, `agent/catalog_provider.yaml`, `agent/catalog_resolution.yaml`, `agent/catalog_transformer.yaml`, `agent/request_processor.yaml` and `agent/builder/`.
- **Why it exists:** Those suites arrived with the merge, after this harness was written.
- **What it risks:** Behaviour they pin can drift in this package without a failing test.
- **Done looks like:** The harness runs the new suites and stops reading `agent/legacy/`, which the conformance README keeps for the earlier agent interface.

### `no-explicit-any` lint warnings

- **What it is:** There are 26 eslint warnings for `no-explicit-any`: 24 in the Direct JSON streaming healer (`streaming.ts`) and 2 in `tests/conformance/conformance.test.ts`. The Express code has none.
- **Why it exists:** In the streaming healer, partial JSON chunks are untyped before they are repaired and compiled.
- **What it risks:** Mild technical debt.
- **Done looks like:** The partial JSON trees are given a more rigorous generic recursive type, or `unknown` with runtime type guards, allowing the warnings to be cleanly resolved.

### Basic catalog read from disk at runtime

- **What it is:** `basicCatalog()` reads `catalog.json` from disk inside `@a2ui/web_core` at runtime using `fs.readFileSync`.
- **Why it exists:** The compiled constants in `web_core` lack catalog instructions, and future v0.9 support requires reading from JSON to avoid coupling to Lit.
- **What it risks:** This will not survive bundling for a browser or execution in environments without local filesystem access to `node_modules`.
- **Status:** The package is Node-targeted, so synchronous filesystem reading from the resolved package location is accepted for now.
- **Done looks like:** Catalogs are bundled or compiled as headless constants containing instructions, or an asynchronous/pluggable catalog loader is introduced.

## 2. `web_core`

### Overtight generic constraints on `MessageProcessor`

- **What it is:** `MessageProcessor` demands `Catalog<any, FunctionImplementation>` even if it is initialized without an action handler.
- **Why it exists:** The generic typing in `web_core` does not differentiate between execution catalogs and schema-only catalogs.
- **What it risks:** Forces a double cast (`as unknown as Catalog<ComponentApi, FunctionImplementation>[]`) in `processor.ts` when passing schema-only catalogs.
- **Done looks like:** `MessageProcessor` relaxes its type constraint to allow omitting `FunctionImplementation` when no action handler is provided.

### Local shims for missing core exports

- **What it is:** `A2uiCatalogError` is defined locally in `src/errors.ts`, and `RemoveStrictValidationTransformer` is shimmed in `tests/conformance/fixtures.ts`.
- **Why it exists:** The blueprints specify them, and the conformance suite relies on the `remove_strict_validation` modifier, but `web_core` does not yet export them.
- **What it risks:** Duplicate definitions that might fall out of sync with future core updates. Both are tagged `TODO(web_core)` and listed in the README shim table.
- **Done looks like:** `web_core` exports `A2uiCatalogError` and an equivalent schema modifier, and the local shims are deleted.

### Inbound validation ignores processor version pinning

- **What it is:** Passing `{version: 'v1.0'}` to `MessageProcessor` has no observable effect on inbound validation; it only governs outgoing formatting.
- **Why it exists:** The internal adapter resolves from the payload's own `version` string.
- **What it risks:** The constructor argument is slightly misleading, and we cannot pin the version strictness via tests from our API surface.
- **Done looks like:** `web_core` documents this behaviour explicitly, or enforces the pinned version strictly for inbound payloads.

### Unreachable exports

- **What it is:** `loadCatalogFromSchema` is unreachable from the `./catalog` subpath.
- **Why it exists:** Tidy-up oversight in `web_core`.
- **What it risks:** None; `Catalog.fromSchema` works and is actively used instead.
- **Done looks like:** The export is properly wired in `web_core`, or the dead code is removed.

### Catalog loader keeps a second copy of the common types map

- **What it is:** `schema_loader.ts` resolves protocol `$ref`s through its own `COMMON_TYPE_SCHEMAS` table, a partial copy of the complete `CommonSchemas` map that `types/common-types.ts` already exports.
- **Why it exists:** The two grew independently.
- **What it risks:** The copy falls behind silently. It already has once: it lacked `Child`, so every v1.0 single-child reference resolved to nothing and the basic catalog lost its child references with no test noticing. That was fixed by adding the entry, not by removing the duplication, so the next new common type will hit the same wall.
- **Done looks like:** The loader resolves against `CommonSchemas` directly and the local table is deleted.

### Arrays of inline objects lose their child references

- **What it is:** The catalog loader converts an array of inline anonymous objects to `z.array(z.record(z.unknown()))` rather than building the inner object schema. Any component reference inside those objects is invisible to reference analysis.
- **Why it exists:** The loader handles named `$ref` item types but not inline `properties` on array items.
- **What it risks:** `Tabs.tabs` is affected on both the v0.9 and v1.0 basic catalogs. `@a2ui/agent` compensates with a name-matching fallback in `src/utils/legacy_child_refs.ts`, which on the shipped catalogs claims exactly that one property. Every other consumer of the reference map gets no child reference for `Tabs` at all.
- **Done looks like:** The loader builds a real object schema for inline array items, `Tabs.tabs` reports formal child references, and the fallback in `@a2ui/agent` can be deleted.

### Component payloads are structurally unchecked (Sharp edge)

- **What it is:** `AnyComponentSchema` is declared `z.ZodType<any>` and built with `.passthrough()` (`web_core/src/v1_0/schema/helpers.ts:95`). Validation therefore stops at the message envelope: `createSurface` and `updateComponents` are `.strict()` and reject unknown keys, but anything inside the `components` array is accepted as-is.
- **Why it exists:** The recursive component tree is catalog-dependent, so a single static schema cannot know which props a given `component` permits.
- **What it risks:** A misspelled or invented component prop passes both the TypeScript compiler and `MessageProcessor.processMessages` without complaint, and only fails at the renderer — or renders silently wrong. Typing example payloads as `AgentToRendererMessage[]` buys envelope-level safety only; do not read a passing typecheck as proof that component props are correct.
- **Done looks like:** Component payloads are validated against the negotiated catalog's per-component Zod schemas, rather than a permissive `any` passthrough.

## 3. Specification & Blueprints

### Truncation signal lost at compile boundary (Sharp edge)

- **What it is:** The blueprint drops the `is_final` flag at the compile boundary. Consumers cannot tell if a compiled `AgentToRendererMessage[]` payload is complete or was cut off mid-write.
- **Why it exists:** A deliberate design choice in the `a2ui_agent.blueprint.md` to split `RawResponsePart` (which has `is_final`) from `A2uiPart` (which does not).
- **What it risks:** Downstream consumers might receive a truncated but validly healed JSON object and render it as a completed response without throwing an error, leading to silent UI truncation.
- **Done looks like:** The specification amends the schema or blueprints to carry a termination signal on compiled parts.

### Python's codebase blueprint describes facades that have not landed

- **What it is:** `blueprints/codebases/python/a2ui_agent/codebase.blueprint.md` lists `A2uiGenerator` and `A2uiRequestProcessor` as part of the Python SDK. They are v1.0 work that has not landed in Python yet.
- **Why it exists:** The blueprint describes where the SDK is going, ahead of the code.
- **What it risks:** Someone porting from Python looks for a reference implementation that is not there yet. The TypeScript facades were written from the specification alone.
- **Done looks like:** The Python facades land, or the Python blueprint marks them as planned.

### Behaviours TypeScript enforces that no conformance case pins

- **What it is:** TypeScript's Express throws in several places where no conformance case says what should happen: an inline component id that collides with a declared variable (`ExpressIdCollisionError`); decompiling a component id that is not an Express identifier, such as `title-heading` or `true` (`ExpressInvalidIdentifierError`); a `surface(...)` line naming a catalog that is not active (`ExpressUnknownCatalogError`); decompiling messages for a catalog the decompiler was not given (`A2uiCatalogError`); and catalogs with different protocol versions (`A2uiCatalogError`). A block that names no catalog while several are active uses the first one and logs a warning.
- **Why it exists:** Each was decided while making TypeScript follow the suite: throwing is preferred to silently producing wrong output.
- **What it risks:** Python may choose differently, and nothing would catch the drift.
- **Done looks like:** Conformance cases pin each behaviour, so both SDKs are held to it.

### Basic catalog instructions missing programmatically

- **What it is:** The `v1.0` basic catalog JSON includes a large `instructions` string ("For layout, use the Row..."), but the compiled `BASIC_COMPONENTS` in `web_core` has no programmatic equivalent.
- **Why it exists:** A gap between the generated `web_core` schema and the JSON source.
- **Status in `@a2ui/agent`:** Resolved. `basicCatalog()` now builds the catalog directly from `@a2ui/web_core`'s shipped `catalog.json` instead of the compiled constants, supplying the full 2,880 character `instructions`.
- **Done looks like:** `web_core` exports the basic catalog instructions natively so consumers without filesystem access do not need to read `catalog.json`.

### Capabilities schema inconsistency

- **What it is:** `V10RendererCapabilities.supportedCatalogIds` is required in the v1.0 specification JSON, but is `.optional()` in `web_core`'s own helpers (`v1_0/schema/helpers.ts`).
- **Why it exists:** Internal inconsistency between the canonical spec and the hand-written `web_core` helpers.
- **What it risks:** Test fixtures have to cast `{}` to `V10RendererCapabilities` to pass.
- **Done looks like:** The spec owners settle the discrepancy and align `web_core` with the JSON schema.

## 4. Upstream Python & Conformance Suite

### `v1.0` has a single canonical streaming case

- **What it is:** `conformance/agent/legacy/streaming_parser.yaml` holds 41 `v0.9` streaming cases and one `v1.0` case. The `v1.0` streaming path is therefore covered by the `v0.9` cases, on the basis that the parser is version-independent in everything they exercise.
- **Why it exists:** Upstream has not written a `v1.0` streaming suite. The local hand-translations that stood in for one have been retired, because 19 of their 20 cases duplicated a canonical `v0.9` case.
- **What it risks:** Any streaming behaviour that differs between versions is untested. Today the known differences are small: the server-to-client file is named differently, and `v1.0` adds the `callRendererFunction` and `agentFunctionResponse` messages, which envelope validation accepts but no streaming case sends.
- **Done looks like:** Upstream publishes `v1.0` streaming cases in `conformance/agent/`, and they run here.

### Python's `has_format_content` contradicts conformance

- **What it is:** Python's `has_format_content` runs a naive substring search and returns true for an unterminated `<a2ui-json>` open tag. This contradicts the conformance case `test_has_a2ui_parts_false_only_open`, which expects `false`.
- **Why it exists:** A bug in the upstream Python implementation. Our TypeScript `hasA2uiParts` correctly parses the block and requires a closed tag.
- **What it risks:** The Python reference implementation is failing a conformance contract that we pass.
- **Done looks like:** Python's `parser.py` is patched to match the conformance suite.

### Python's trailing-comma repair rewrites string contents

- **What it is:** When a Direct JSON payload fails to parse, Python's `_remove_trailing_commas` in `payload_fixer.py` drops every comma followed by whitespace and a `]` or `}`, using the regex `,(?=\s*[\]}])`. It does not skip string literals, so a value such as `"a,}"` loses its comma. The TypeScript `removeTrailingCommas` skips string literals and keeps it.
- **Why it exists:** The TypeScript port started from the same regex. A review of this package pointed out the corruption, and only the TypeScript side was changed.
- **What it risks:** For the same model output, the two SDKs can emit different string values. Conformance does not catch it: `test_compile_json_trailing_commas_removed` has no comma inside a string.
- **Done looks like:** Python skips string literals as well, and a conformance case with a `,}` inside a string value pins the behaviour.

### Python's Express emits checks on components that take none

- **What it is:** Python's Express compiler writes a `checks` key on any component given a `?check`, whether or not the component's schema declares a check-rule property. `Text("hi", _, _, [?required])` compiles against the v1.0 basic catalog to a `Text` carrying `checks`, and because `Text` has no bound `value` the check's `args` are empty. The compiler never raises. The literal `"checks"` is also hardcoded rather than read from the schema (`compiler.py:502` and `:639` on `origin/main`).
- **Why it exists:** Python decides whether a component is checkable by matching the substring `"Checkable"` in an `allOf` `$ref`, but uses that result only for property ordering, not to validate checks.
- **What it risks:** The model gets no feedback from the compiler. Any error surfaces later, away from the line that caused it, and the check silently has nothing to check.
- **TypeScript:** The port reads the check-rule property from the schema and throws `ExpressValidationError` when a component has none. See `express_format.blueprint.md` §5.2 item 4. This is a deliberate difference from Python. The schema-based test also finds a check-rule property that a component declares itself instead of inheriting from `Checkable`: main's `forms_catalog_v1_0.json` declares `TextField.checks` that way, and Python's helper reports that `TextField` is not checkable while still compiling its checks.
- **Done looks like:** Python raises a validation error for checks on a component without a check-rule property, and a conformance case pins the behaviour for both SDKs.

### Python's Express rejects paths nested inside array items

- **What it is:** Python's Express compiler rejects a data binding anywhere inside a property whose top-level schema doesn't admit one. `Tabs([{title: $/t, child: c}])` raises `ExpressForbiddenDatabindingError` against the v1.0 basic catalog, even though `title` is a `DynamicString`.
- **Why it exists:** `_schema_allows_databinding` checks the property's top-level schema, and `_has_databinding` then searches the whole written value for a `path`, without following the schema down to where the path appears (`compiler.py:75-121` on `origin/main`).
- **What it risks:** Valid bindings inside arrays of objects cannot be written in Express. Tabs titles are the case in the basic catalog.
- **TypeScript:** When a property's schema doesn't admit a path as a whole, the port walks the written value alongside the schema and checks each path against the schema where it appears. A property that admits a path as a whole is not inspected further, as in Python. See `express_format.blueprint.md` §5.2 item 6. This is a deliberate difference from Python.
- **Done looks like:** Python checks bindings positionally, and a conformance case pins the behaviour for both SDKs.

### Python's Express fails conformance cases that TypeScript passes

- **What it is:** Main's Express suites under `conformance/agent/express/` contain cases Python fails. TypeScript used to follow Python and fail them too; it now follows the suite and passes all 86. Each group below could be filed as a Python issue.
  - Validation, in `compiler.py`: a component the catalog doesn't declare is dropped instead of failing (`test_compile_express_unknown_component_is_a_validation_error`, and through the response parser `test_parse_response_express_validation_failure_surfaces`); a call to an undeclared function compiles (`test_compile_express_unknown_function_is_a_validation_error`); a missing required property is not reported (`test_compile_express_missing_required_property_is_a_validation_error`).
  - Output shapes, in `compiler.py`: inline components get `_inline_N` ids instead of `<parent>_<property>`, or `<parent>_<property>_<index>` in arrays, emitted after the parent (`test_compile_express_inline_nesting`); an `Event` with no context compiles to `context: {}` instead of no `context` key (`test_compile_express_event_action`, `test_compile_express_event_variable_is_inlined_at_each_use`); a standalone function call compiles to a top-level `functionCallId`/`callFunction`, which `agent_to_renderer.json` rejects, instead of a `callRendererFunction` message (`test_compile_express_standalone_function_call`); a block that assigns components but no `root` raises "Root target 'root' is not defined" instead of compiling to `updateComponents`, which the round trip in `test_decompile_express_update_components` needs.
  - Decompilation, in `decompiler.py`: a standalone `updateComponents` writes no `surface` line and does not round-trip (`test_decompile_express_update_components`); `callRendererFunction` decompiles to an empty string (`test_decompile_express_renderer_function_call`); a standalone `updateDataModel` writes no `surface` line (`test_decompile_express_update_data_model`, `test_decompile_express_nested_data_model_is_one_assignment_per_leaf`); a string holding a quote is written triple-quoted instead of escaped (`test_decompile_express_escapes_a_quote_in_a_string`); a map key that is not an identifier is written unquoted, which the grammar rejects (`test_decompile_express_quotes_a_map_key_that_is_not_an_identifier`).
  - Several catalogs: Python marks `test_compile_express_surface_targeting_names_a_catalog` unsupported, because its `ExpressFormat` (`format.py`), `ExpressParser` (`parser.py`) and `ExpressCompiler` (`compiler.py`) each take a single `catalog`, and the compiler looks every name up in that catalog's `self.helper`, whatever the `surface(...)` line names. TypeScript takes several catalogs and looks names up only in the catalog a block names.
- **Why it exists:** These are behaviours of main's Python compiler and decompiler, written before the suite.
- **What it risks:** In Python, unknown components and missing required properties reach the renderer without a compile-time error, some compiled messages fail the protocol schema, and decompiled examples do not always compile back to the same messages.
- **Also passing in TypeScript only, for API reasons:** seven response-parser cases that Python's harness lists as gaps. Four `wrap` cases pass because TypeScript's `wrap` takes response parts where Python's takes strings, two text-between-blocks cases pass because the shared block lexer keeps text apart from payloads, and the unwrapped-body case passes because `parseResponse` accepts `wrapped`.
- **Done looks like:** Python passes these cases. `tests/unit/inference_formats/express/fixtures/conformance_overrides.json` lists every place TypeScript's output now differs from Python's recorded output; it can be emptied as Python catches up and the parity fixtures are regenerated.

### Python's Express defaults to v1.0 whatever the catalog

- **What it is:** Python's `ExpressFormat`, `ExpressParser` and `ExpressCompiler` default `version` to `"v1.0"`, so Express with a v0.9 catalog emits v1.0 messages unless the caller passes `version="v0.9"`, and a mismatched explicit version is not reported.
- **TypeScript:** The version defaults to the catalogs' own protocol version (`toWireProtocolVersion`), all active catalogs must share it, and an explicit `version` that differs throws `A2uiCatalogError`.
- **What it risks:** In Python, a v0.9 agent that forgets the argument sends messages its renderer rejects.
- **Done looks like:** Python derives the default from the catalog and rejects a mismatch.

### Express grammar rules name basic-catalog components

- **What it is:** The fixed Express rules that head every Express prompt in Python (`EXPRESS_RULES` in `prompt_generator.py`) name catalog-specific things. Rule 15's example is `root = Card(...)`, the dates rule mentions `DateTimeInput`, rule 11 uses `itemTemplate = Image($url)`, and rule 14 refers to parameters named `action`. With a catalog that has no `Card`, the prompt still shows one. Python fails `test_express_snippet_omits_a_pruned_component` for this reason (though Python's harness doesn't run that suite, so the failure is not visible there).
- **TypeScript:** The rules have been rewritten to be catalog-agnostic (using generic placeholder components such as `ComponentA(...)` and generic descriptions for date-time properties and action parameters). TypeScript now passes `test_express_snippet_omits_a_pruned_component`.
- **Contradiction in conformance suite:** The conformance suite contradicts itself: the skill golden `conformance/test_data/skills/express_base_rules.txt` still contains `Card(...)`, which the pruning conformance case `test_express_snippet_omits_a_pruned_component` forbids. The TypeScript unit test comparing base rules against `express_base_rules.txt` was adapted in favor of following the pruning case. Upstream needs to regenerate the golden when Python changes its rules.
- **Why it exists in Python:** The rules text was written against the basic catalog.
- **What it risks:** The model may be told to use components or properties that the negotiated catalog does not have. This conflicts with the repository rule that inference formats stay catalog-agnostic.
- **Done looks like:** Upstream Python rewrites its rules to be catalog-agnostic and regenerates the `express_base_rules.txt` golden.

### Python's Express decompiles a check without a condition as `?None`

- **What it is:** When the prompt generator rewrites catalog examples as Express, a check rule written as `{"call": "required"}` without the `condition` wrapper decompiles to `?None`. The v1.0 basic catalog has one such example, so the golden `express_catalog_instructions.txt` contains `?None` (line 197), and the port produces the same.
- **Why it exists:** Python's decompiler reads `rc.get("condition", {}).get("call")` and formats the missing value as `None`.
- **What it risks:** The model is shown an example that does not compile.
- **Done looks like:** The catalog example is corrected, or Python's decompiler handles a bare call, and the golden is regenerated.

### Python's Express ignores common properties defined inside a v0.9 catalog

- **What it is:** v0.9 basic catalog components get `weight` through a local `allOf` reference to `#/$defs/CatalogComponentCommon`. Python's schema helper does not follow that reference when listing a component's properties, so `weight` never appears in v0.9 Express signatures, and `Text("hi", weight=1)` fails with "Property 'weight' is not a valid property of component 'Text'".
- **TypeScript:** The port now resolves local `$defs` references, so `weight` and other common properties correctly appear in v0.9 component signatures, and `Text("hi", weight=1)` compiles successfully.
- **Why it exists:** Python's helper collects properties only from a component's own `properties` and from inline `allOf` entries, missing local `$ref`s.
- **Done looks like:** Python's helper follows local `$defs` references to match the TypeScript port.

### Python's Express cannot decompile the restaurant finder's v0.9 examples

- **What it is:** Decompiling `samples/agent/adk/restaurant_finder/examples/0.9/*.json` to Express gives text that does not compile in Python. Component ids such as `title-heading` are not Express identifiers, so the lexer stops at the `-`. In Python, `updateDataModel.path` is ignored, so `{"path": "/title", "value": "Found Restaurants"}` becomes `$ = "Found Restaurants"` instead of `$/title = ...`. `createSurface` and `updateComponents` each write a `surface("default")` line, and a program with two `surface` lines fails with "Root target 'root' is not defined". `createSurface.theme` is dropped without notice.
- **TypeScript:** The TypeScript decompiler honours `updateDataModel.path` (mapping non-root paths to `$/path` leaf assignments), groups messages per surface to emit a single `surface` block, decompiles standalone `updateComponents` into blocks without a `root`, quotes keyword dictionary keys, and throws `ExpressInvalidIdentifierError` on invalid component ids like `title-heading` or `true`. The TS compiler now successfully compiles blocks with component assignments but no `root` target into `updateComponents`. Python still fails all these cases.
- **Why it exists:** The decompiler handles each message on its own and was written against v1.0, where one `createSurface` carries the components and the data model.
- **What it risks:** Examples written for Direct JSON cannot be reused for Express as they are. In TypeScript the only remaining obstacle is ids that are not identifiers, which now throw instead of producing broken text; the Node sample keeps its own copies of the examples with underscore ids for that reason. It no longer drops `createSurface` before decompiling.
- **Done looks like:** Python's decompiler honours `updateDataModel.path`, writes one `surface` line per surface, and either rejects or rewrites ids that are not identifiers.

### Python's Express leaves v0.9 JSON examples untranslated

- **What it is:** When examples are given as text, Python's Express prompt generator rewrites each fenced `json` block as Express only if every message in it is a `createSurface`, `updateDataModel`, `deleteSurface` or `callFunction`. A v0.9 example always contains `updateComponents`, so the block is left as JSON in an Express prompt.
- **TypeScript:** The TypeScript prompt generator includes `updateComponents` in the list of recognized messages, correctly translating fenced v0.9 JSON example blocks to Express.
- **Why it exists:** The key list in Python matches v1.0, where components travel inside `createSurface`.
- **What it risks:** In Python, a v0.9 Express prompt shows the model JSON examples while asking for Express.
- **Done looks like:** `updateComponents` is added to the list, in Python first.

### Python's Express decompiler fails loosely on a non-object `context` or `args`

- **What it is:** When an event's `context` or a function call's `args` is present but is not an object, Python's decompiler either crashes with `AttributeError` or `TypeError`, or, for a string `args`, tests parameter names as substrings of the string and writes `_` placeholders.
- **TypeScript:** The decompiler throws `ExpressValidationError` naming the event or call and the field. Absent or `null` fields still decompile as empty.
- **Why it exists:** Python reads both fields with `.get(..., {})` and uses the result as a dict without checking it.
- **What it risks:** A malformed example gives Python users a stack trace, or a wrong Express example with no error.
- **Done looks like:** Python raises a validation error for both fields, and a conformance case in `agent/express/decompiler.yaml` pins it for both SDKs.

## 5. Node Sample (`samples/agent/node/restaurant_finder`)

### Only the first streamed message reaches the client (Resolved)

- **What it was:** `@a2a-js/sdk` ends the SSE stream at the first `message` event (`dist/server/index.js:290`: `if (event.kind === "message" || event.kind === "status-update" && event.final) break`). The sample published one `message` per chunk, so with a live model only the first reached the client.
- **Resolution:** The sample now publishes each batch of parts as a non-final `working` status update carrying `status.message`, as the Python sample does, and ends the turn with one final status update.

### The sample answers in A2UI when no A2UI extension is requested

- **What it is:** Python's sample answers with plain text when the client does not request an A2UI extension. The Node sample logs a warning and answers in its configured A2UI version, so curl works without the `X-A2A-Extensions` header. A request for a different A2UI version fails the task with a message that says how to restart the agent.
- **Why it exists:** Porting the text-only agent would double the sample for a path no sample client uses. Telling "none requested" from "another version requested" also needs a workaround: `DefaultRequestHandler` drops requested extensions the agent card does not advertise, so `index.ts` copies the header into `message.extensions`.
- **What it risks:** A client that wants text gets A2UI.
- **Done looks like:** A text-only mode, if a client needs one.

### `input-required` turns end with `final: true`

- **What it is:** Python marks only `completed` status updates as final. The Node sample also marks `input-required` as final.
- **Why it exists:** `@a2a-js/sdk` keeps the SSE stream open until it sees a final status update, so a non-final `input-required` would leave streaming clients waiting.
- **What it risks:** Nothing found so far. The multi-turn flow continues through `contextId`.
- **Done looks like:** Nothing, unless the SDK changes.

### `@google/adk` cannot be used in this monorepo

- **What it is:** `@google/adk@2.1.0` requires `zod ^4.2.1`. The root `resolutions` block pins `zod` to `^3.25.76`, so ADK fails at import time with `z.object(...).loose is not a function`. The sample uses `@google/genai` directly instead, losing the structural parallel with the Python ADK sample.
- **Why it exists:** `web_core` is built on Zod 3 APIs, and the v1.0 catalog that `@a2ui/agent` consumes is a tree of Zod 3 `ZodObject`s that web_core converts to JSON Schema for the prompt. The Zod major is load-bearing for the agent-side path, so the pin cannot simply be relaxed.
- **What it risks:** Any future JavaScript sample or downstream consumer wanting ADK hits the same wall. Working around it means either carrying two Zod majors and guaranteeing they never meet, or migrating `web_core` to Zod 4.
- **Status:** Deferred by decision. The Node sample is the only consumer affected, and modernising that sample is a separate question that can be answered later.
- **Untested assumption:** The "guarantee they never meet" option was never actually tried. `@a2ui/agent` imports Zod nowhere and declares no Zod dependency; `basicCatalog()` returns a catalog whose Zod schemas are built and consumed entirely inside `web_core`. ADK would use Zod 4 for its own tool schemas while `web_core` uses Zod 3 for catalogs, and the two may never exchange a Zod object. Whoever revisits this should test lifting the root `resolutions` pin before assuming a `web_core` migration is required, because the fallback to `@google/genai` was chosen without that check.
- **Done looks like:** Either the two majors are shown to coexist and the root pin is scoped rather than global, or `web_core` is migrated to Zod 4 and the pin is lifted, at which point ADK becomes usable and the Node sample can mirror the Python one.

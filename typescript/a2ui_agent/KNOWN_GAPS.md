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

### `no-explicit-any` lint warnings

- **What it is:** There are 26 eslint warnings for `no-explicit-any` in the codebase.
- **Why it exists:** These are heavily concentrated in the streaming healer (`streaming.ts`), where partial JSON chunks are genuinely untyped before being repaired and compiled.
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

### `codebase.blueprint.md` overclaims Python's implementation

- **What it is:** The `blueprints/codebases/python/a2ui_agent/codebase.blueprint.md` asserts that Python implements `A2uiGenerator` and `A2uiRequestProcessor`. It does not.
- **Why it exists:** Stale documentation. The design document knows they do not exist, but the codebase blueprint is out of sync.
- **What it risks:** Confuses cross-language portability efforts.
- **Done looks like:** The Python codebase blueprint is updated to reflect its true state.

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

- **What it is:** `conformance/agent/streaming_parser.yaml` holds 41 `v0.9` streaming cases and one `v1.0` case. The `v1.0` streaming path is therefore covered by the `v0.9` cases, on the basis that the parser is version-independent in everything they exercise.
- **Why it exists:** Upstream has not written a `v1.0` streaming suite. The local hand-translations that stood in for one have been retired, because 19 of their 20 cases duplicated a canonical `v0.9` case.
- **What it risks:** Any streaming behaviour that differs between versions is untested. Today the known differences are small: the server-to-client file is named differently, and `v1.0` adds the `callRendererFunction` and `agentFunctionResponse` messages, which envelope validation accepts but no streaming case sends.
- **Done looks like:** Upstream publishes `v1.0` streaming cases in `conformance/agent/`, and they run here.

### Python's `has_format_content` contradicts conformance

- **What it is:** Python's `has_format_content` runs a naive substring search and returns true for an unterminated `<a2ui-json>` open tag. This contradicts the conformance case `test_has_a2ui_parts_false_only_open`, which expects `false`.
- **Why it exists:** A bug in the upstream Python implementation. Our TypeScript `hasA2uiParts` correctly parses the block and requires a closed tag.
- **What it risks:** The Python reference implementation is failing a conformance contract that we pass.
- **Done looks like:** Python's `parser.py` is patched to match the conformance suite.

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

### Express follows Python's known conformance gaps

- **What it is:** Main's conformance suites for Express contain cases that Python's implementation fails, which its harness lists as known gaps. The TypeScript port follows Python, so it fails the same cases. They run as expected failures in `tests/conformance/express_conformance.test.ts`, with Python's reasons:
  - compiler: inline components get `_inline_N` ids rather than `<parent id>_<property>`; an Event with no context compiles `context: {}`; a standalone call compiles to a top-level `functionCallId`/`callFunction`, which `agent_to_renderer.json` rejects, rather than to `callRendererFunction`; unknown components are dropped instead of failing the compile; missing required properties are not reported; calls to unknown functions compile;
  - decompiler: a standalone `updateComponents` has no root line and a standalone `updateDataModel` has no surface line, so both fail the round trip; a string holding a quote is written triple-quoted instead of escaped; `callRendererFunction` decompiles to an empty string; a map key that is not an identifier is written unquoted, which the grammar rejects;
  - response parser: a component the catalog doesn't declare is dropped, so a response that should fail validation parses.
- **Why it exists:** These are behaviours of main's Python compiler and decompiler. The port matches Python rather than the conformance suite, so both SDKs change together when Python is fixed.
- **What it risks:** Unknown components and missing required properties reach the renderer without a compile-time error, and decompiled output does not always compile back to the same messages.
- **Differences from Python:** Seven response-parser cases that Python lists as gaps pass here. Four `wrap` cases pass because TypeScript's `wrap` takes response parts, where Python's takes strings; two text-between-blocks cases pass because the shared TypeScript block lexer keeps text separate from payloads; and the unwrapped-body case passes because `parseResponse` accepts `wrapped`. Python skips `test_compile_express_surface_targeting_names_a_catalog` as unsupported, and so does TypeScript.
- **Done looks like:** Python fixes each gap, the port follows, and the expected-failure entries are removed.

### Express grammar rules name basic-catalog components

- **What it is:** The fixed Express rules that head every Express prompt (`EXPRESS_RULES`, copied verbatim from Python) name catalog-specific things. Rule 15's example is `root = Card(...)`, the dates rule mentions `DateTimeInput`, and rule 14 refers to parameters named `action`. With a catalog that has no `Card`, the prompt still shows one. The prompt generator suite's `test_express_snippet_omits_a_pruned_component` fails for this reason and runs as an expected failure. Python's harness doesn't run that suite, so the failure is not visible there.
- **Why it exists:** The rules text was written against the basic catalog. The port keeps it verbatim (`express_format.blueprint.md` §5.2 item 5) so that the generated base rules equal the conformance golden `express_base_rules.txt`.
- **What it risks:** The model may be told to use components or properties that the negotiated catalog does not have. This conflicts with the repository rule that inference formats stay catalog-agnostic.
- **Done looks like:** The rules use placeholder names or text derived from the catalog, the golden is regenerated, and both SDKs pass the pruning case.

### Python's Express decompiles a check without a condition as `?None`

- **What it is:** When the prompt generator rewrites catalog examples as Express, a check rule written as `{"call": "required"}` without the `condition` wrapper decompiles to `?None`. The v1.0 basic catalog has one such example, so the golden `express_catalog_instructions.txt` contains `?None` (line 197), and the port produces the same.
- **Why it exists:** Python's decompiler reads `rc.get("condition", {}).get("call")` and formats the missing value as `None`.
- **What it risks:** The model is shown an example that does not compile.
- **Done looks like:** The catalog example is corrected, or Python's decompiler handles a bare call, and the golden is regenerated.

### Python's Express ignores common properties defined inside a v0.9 catalog

- **What it is:** v0.9 basic catalog components get `weight` through a local `allOf` reference to `#/$defs/CatalogComponentCommon`. Python's schema helper does not follow that reference when listing a component's properties, so `weight` never appears in v0.9 Express signatures, and `Text("hi", weight=1)` fails with "Property 'weight' is not a valid property of component 'Text'". The port does the same.
- **Why it exists:** The helper collects properties only from a component's own `properties` and from inline `allOf` entries. It reads `$ref`s only to detect `Checkable`, whose `checks` property it then appends by name. The v1.0 basic catalog inherits only `Checkable`, so it is not affected.
- **What it risks:** An Express author targeting v0.9 cannot set `weight`.
- **Done looks like:** Python's helper follows local `$defs` references, and the port follows.

## 5. Node Sample (`samples/agent/node/restaurant_finder`)

### Only the first streamed message reaches the client (Sharp edge)

- **What it is:** `@a2a-js/sdk` terminates the SSE stream on the first `message` event it sees (`dist/server/index.js:290` — `if (event.kind === "message" || event.kind === "status-update" && event.final) break`). The sample publishes one `message` per healed chunk, so with a live model only the first is delivered; the rest, and the terminal `completed`/`failed` status, are published to the bus but never reach the wire.
- **Why it exists:** The A2A event contract treats a `Message` as a terminal response. Progressive output is expected to travel as non-final `status-update` events carrying a `status.message`, not as repeated top-level `message` events.
- **What it risks:** Stub mode emits exactly one message, so the sample looks correct in the only mode that runs without an API key. The defect appears only against a real model, which is the harder case to notice. It also means the post-hoc validation failure is invisible to the client.
- **Done looks like:** Progressive chunks are published as non-final `TaskStatusUpdateEvent`s with the payload in `status.message`, reserving a terminal event for the end of the turn.

### `@google/adk` cannot be used in this monorepo

- **What it is:** `@google/adk@2.1.0` requires `zod ^4.2.1`. The root `resolutions` block pins `zod` to `^3.25.76`, so ADK fails at import time with `z.object(...).loose is not a function`. The sample uses `@google/genai` directly instead, losing the structural parallel with the Python ADK sample.
- **Why it exists:** `web_core` is built on Zod 3 APIs, and the v1.0 catalog that `@a2ui/agent` consumes is a tree of Zod 3 `ZodObject`s that web_core converts to JSON Schema for the prompt. The Zod major is load-bearing for the agent-side path, so the pin cannot simply be relaxed.
- **What it risks:** Any future JavaScript sample or downstream consumer wanting ADK hits the same wall. Working around it means either carrying two Zod majors and guaranteeing they never meet, or migrating `web_core` to Zod 4.
- **Status:** Deferred by decision. The Node sample is the only consumer affected, and modernising that sample is a separate question that can be answered later.
- **Untested assumption:** The "guarantee they never meet" option was never actually tried. `@a2ui/agent` imports Zod nowhere and declares no Zod dependency; `basicCatalog()` returns a catalog whose Zod schemas are built and consumed entirely inside `web_core`. ADK would use Zod 4 for its own tool schemas while `web_core` uses Zod 3 for catalogs, and the two may never exchange a Zod object. Whoever revisits this should test lifting the root `resolutions` pin before assuming a `web_core` migration is required, because the fallback to `@google/genai` was chosen without that check.
- **Done looks like:** Either the two majors are shown to coexist and the root pin is scoped rather than global, or `web_core` is migrated to Zod 4 and the pin is lifted, at which point ADK becomes usable and the Node sample can mirror the Python one.

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

- **What it is:** The package supports `v1.0` and `v0.9`. `v0.8` and inference formats other than Direct JSON (Express, Elemental, Atom) remain unimplemented.
- **Why it exists:** An explicit scope decision to add protocol support incrementally, starting with `v1.0`.
- **What it blocks:** Legacy `v0.8` agents and alternative format use cases.
- **Done looks like:** The `InferenceFormat` seam is populated with implementations for Express, Elemental, and Atom, and the `v0.8` conformance cases are enabled.

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

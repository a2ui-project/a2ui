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

### Unsupported protocol versions and formats

- **What it is:** The package targets `v1.0` exclusively, permanently skipping 88 of 131 conformance cases for `v0.8` and `v0.9`. Inference formats other than Direct JSON (Express, Elemental, Atom) are unimplemented.
- **Why it exists:** An explicit scope decision to limit the initial drop to the modern `v1.0` standard and the most common inference format.
- **What it blocks:** Legacy agents and alternative format use cases.
- **Done looks like:** The `InferenceFormat` seam is populated with implementations for Express, Elemental, and Atom, and the skipped conformance tests are enabled and passing.

### `no-explicit-any` lint warnings

- **What it is:** There are 34 eslint warnings for `no-explicit-any` in the codebase.
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

### Streaming conformance cases are non-canonical

- **What it is:** The streaming tests in `tests/streaming_cases/v1_0_direct_json.yaml` are local hand-translations of v0.9 cases.
- **Why it exists:** No upstream `v1.0` streaming conformance cases exist yet in `conformance/agent/`.
- **What it risks:** Our streaming implementation is verified against tests that are not shared with Python or other SDKs, risking divergent healing behaviour.
- **Done looks like:** The local cases are promoted to `conformance/agent/` and adopted as the canonical v1.0 streaming suite.

### Python's `has_format_content` contradicts conformance

- **What it is:** Python's `has_format_content` runs a naive substring search and returns true for an unterminated `<a2ui-json>` open tag. This contradicts the conformance case `test_has_a2ui_parts_false_only_open`, which expects `false`.
- **Why it exists:** A bug in the upstream Python implementation. Our TypeScript `hasA2uiParts` correctly parses the block and requires a closed tag.
- **What it risks:** The Python reference implementation is failing a conformance contract that we pass.
- **Done looks like:** Python's `parser.py` is patched to match the conformance suite.

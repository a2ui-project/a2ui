# `@a2ui/agent` — Known Gaps

This document consolidates outstanding TODO items, deliberate scope decisions, and known limitations for the `@a2ui/agent` TypeScript SDK. It is grouped by the component or team responsible for the next action.

Most of these are deliberate scope boundaries rather than defects. However, a few represent genuine sharp edges that callers must navigate carefully.

## 1. `@a2ui/agent` (This package)

### Unvalidated Direct JSON parser output (Sharp edge)

- **What it is:** `DirectJsonParser.compile` bypasses Zod validation and directly casts the JSON output to `AgentToRendererMessage[]` via an unchecked `as` cast.
- **Why it exists:** The validation step was deferred to `A2uiRequestProcessor`, which runs `processMessages` on the output.
- **What it risks:** Callers who use the `Parser` directly rather than through the `A2uiRequestProcessor` facade will receive unvalidated payloads that might not adhere to the protocol schema, leading to unpredictable runtime errors downstream.
- **Done looks like:** `compile` validates its output against the protocol schema and the parser's `catalogs`, which `DirectJsonFormat.createParser()` already passes in, before returning the payloads.

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

### Some blueprint conformance suites are not run

- **What it is:** Merging `main` into `v1_0` reorganized `conformance/agent/`. The parser, streaming parser and inference format suites this harness runs moved unchanged to `agent/legacy/`, and the harness reads them there, as Python's does. Of the suites added for the blueprint interface, `agent/catalog_provider.yaml`, `agent/catalog_resolution.yaml` and `agent/direct_json/prompt_generator.yaml` run. The rest do not: the other `agent/direct_json/*.yaml` files, `agent/catalog_transformer.yaml`, `agent/request_processor.yaml` and `agent/builder/`.
- **Why it exists:** Those suites exercise blueprint APIs this package does not implement yet.
- **What it risks:** Behaviour they pin can drift in this package without a failing test.
- **Done looks like:** The harness runs every blueprint suite and stops reading `agent/legacy/`, which the conformance README keeps for the earlier agent interface.

### `no-explicit-any` lint warnings

- **What it is:** There are 26 eslint warnings for `no-explicit-any` in the codebase.
- **Why it exists:** These are heavily concentrated in the streaming healer (`streaming.ts`), where partial JSON chunks are genuinely untyped before being repaired and compiled.
- **What it risks:** Mild technical debt.
- **Done looks like:** The partial JSON trees are given a more rigorous generic recursive type, or `unknown` with runtime type guards, allowing the warnings to be cleanly resolved.

## 2. `web_core`

### Overtight generic constraints on `MessageProcessor`

- **What it is:** `MessageProcessor` demands `Catalog<any, FunctionImplementation>` even if it is initialized without an action handler.
- **Why it exists:** The generic typing in `web_core` does not differentiate between execution catalogs and schema-only catalogs.
- **What it risks:** Forces a double cast (`as unknown as Catalog<ComponentApi, FunctionImplementation>[]`) in `processor.ts` when passing schema-only catalogs.
- **Done looks like:** `MessageProcessor` relaxes its type constraint to allow omitting `FunctionImplementation` when no action handler is provided.

### Local shim for a missing schema modifier

- **What it is:** `RemoveStrictValidationTransformer` is shimmed in `tests/conformance/fixtures.ts`.
- **Why it exists:** The conformance suite relies on the `remove_strict_validation` modifier, but `web_core` doesn't export common schema modifiers yet.
- **What it risks:** A duplicate definition that might fall out of sync with future core updates. It is tagged `TODO(web_core)` and listed in the README shim table.
- **Done looks like:** `web_core` exports an equivalent schema modifier, and the local shim is deleted.

### Catalog loader keeps a second copy of the common types map

- **What it is:** `schema_loader.ts` resolves protocol `$ref`s through its own `COMMON_TYPE_SCHEMAS` table, a partial copy of the complete `CommonSchemas` map that `types/common-types.ts` already exports.
- **Why it exists:** The two grew independently.
- **What it risks:** The copy falls behind silently. It already has once: it lacked `Child`, so every v1.0 single-child reference resolved to nothing and the basic catalog lost its child references with no test noticing. That was fixed by adding the entry, not by removing the duplication, so the next new common type will hit the same wall.
- **Done looks like:** The loader resolves against `CommonSchemas` directly and the local table is deleted.

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
- **Status in `@a2ui/agent`:** Not affected. The SDK bundles no catalog; agents load the published `catalog.json` through a catalog provider, which keeps the full `instructions` string.
- **Done looks like:** `web_core` exports the basic catalog instructions natively so consumers without filesystem access do not need to read `catalog.json`.

## 4. Upstream Python & Conformance Suite

### `v1.0` has a single canonical streaming case

- **What it is:** `conformance/agent/legacy/streaming_parser.yaml` holds 41 `v0.9` streaming cases and one `v1.0` case. The `v1.0` streaming path is therefore covered by the `v0.9` cases, on the basis that the parser is version-independent in everything they exercise.
- **Why it exists:** Upstream has not written a `v1.0` streaming suite. The local hand-translations that stood in for one have been retired, because 19 of their 20 cases duplicated a canonical `v0.9` case.
- **What it risks:** Any streaming behaviour that differs between versions is untested. Today the known differences are small: the server-to-client file is named differently, and `v1.0` adds the `callRendererFunction` and `agentFunctionResponse` messages, which envelope validation accepts but no streaming case sends.
- **Done looks like:** Upstream publishes `v1.0` streaming cases in `conformance/agent/`, and they run here.

### Python's `has_format_content` tests substrings

- **What it is:** With `complete=True`, Python's `has_format_content` checks that the opening and closing tags each appear somewhere in the content, so `</a2ui-json> <a2ui-json>` counts as a complete block. TypeScript's `hasFormatContent` runs the block lexer and requires a closing tag after an opening one. Without `complete`, both return true for an opening tag on its own, as the module blueprint specifies. The conformance `has_parts` cases check the `complete` form, and both SDKs pass them.
- **Why it exists:** TypeScript reuses the block lexer that `unwrap` already needs, rather than porting Python's substring test.
- **What it risks:** Content with a stray closing tag before the opening one is reported differently by the two SDKs.
- **Done looks like:** Python's `parser.py` checks tag order too, or the blueprint says that a substring test is enough.

### Python's trailing-comma repair rewrites string contents

- **What it is:** When a Direct JSON payload fails to parse, Python's `_remove_trailing_commas` in `payload_fixer.py` drops every comma followed by whitespace and a `]` or `}`, using the regex `,(?=\s*[\]}])`. It does not skip string literals, so a value such as `"a,}"` loses its comma. The TypeScript `removeTrailingCommas` skips string literals and keeps it.
- **Why it exists:** The TypeScript port started from the same regex. A review of this package pointed out the corruption, and only the TypeScript side was changed.
- **What it risks:** For the same model output, the two SDKs can emit different string values. Conformance does not catch it: `test_compile_json_trailing_commas_removed` has no comma inside a string.
- **Done looks like:** Python skips string literals as well, and a conformance case with a `,}` inside a string value pins the behaviour.

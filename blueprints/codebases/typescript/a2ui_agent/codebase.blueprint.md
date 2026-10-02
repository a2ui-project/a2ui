---
codebase_path: typescript/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: d562941e128e58f0e356f86f9e7309ec30f8a7a1
implemented_features: []
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **TypeScript Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`). The SDK supports A2UI protocol v0.9 and v1.0, and is structured so that later protocol versions can be added.

- **Parser and Lexer Layer**: Defines the foundational seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer uses sticky regexes and offset-based string matching (`String.startsWith`) for quadratic-free tokenization performance.
- **Prompt Generation**: Decomposed into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method to enable decoupled skill generation without duplicating logic.
- **Catalog Layer**: Includes `CatalogConfig`, catalog pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs` handling fallback rules based on renderer capabilities.
- **Direct JSON Inference Format**: Implements `<a2ui-json>` serialization via `DirectJsonFormat`, complete with a robust streaming healer (`DirectJsonStreamProcessorImpl`). The stream processor takes every active catalog and uses, for each surface, the catalog its `createSurface` message names. The streaming heuristic auto-heals fragmented chunks incrementally without blowing away intermediate references.
- **Processor Facades**: Features agent-lifetime (`A2uiGenerator`) and request-scoped (`A2uiRequestProcessor`) facades to cleanly orchestrate capability negotiation, prompt construction, parsing, and payload validation.
- **Conformance Harness**: A robust test runner that executes the upstream `conformance/agent/` YAML fixtures, dynamically mapping text and payload shapes across boundaries.

### Protocol versions

Protocol versions are handled in a few fixed places, and adding a version means extending each of them:

- All `@a2ui/web_core` imports, including the `v0_9` and `v1_0` subpaths, go through `src/internal/web_core.ts`. Code outside that file uses the version-neutral `RendererCapabilities` type.
- The version stamped on emitted messages comes from the catalog's `protocolVersion`, not from a literal.
- Envelope validation in `src/utils/envelope_validation.ts` selects the v0.9 or v1.0 message schemas from that version. v1.0 adds `callRendererFunction` and `agentFunctionResponse` to the four messages shared with v0.9.
- `MessageProcessor` picks a version adapter for each message from the message's own `version` field, so the SDK does not configure a protocol version on the processor.
- The conformance harness runs the versions listed in `SUPPORTED_PROTOCOL_VERSIONS` in `tests/conformance/loader.ts`, currently `v0.9` and `v1.0`.

## **Local Technical Decisions & Overrides**

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` are implemented matching the TypeScript design doc rather than porting directly from Python.
  > **Correction/Risk Signal**: The `python/a2ui_agent/codebase.blueprint.md` states as fact that the Python SDK implements `A2uiGenerator` and `A2uiRequestProcessor`. This is untrue; neither class exists in the Python codebase. As a result, the TypeScript facades were authored to specification with no reference implementation to check against, presenting a risk signal for reviewers.
- `Parser.hasFormatContent(content, {complete})` follows the blueprint's `has_format_content`, but runs the block lexer instead of a substring test, so `complete` also checks that the closing tag follows the opening one.
- Transformers (e.g., pruning) return _new_ catalogs rather than mutating them, preventing stale schemas from leaking across inherited contexts.
- `Parser` incorporates a `parseStream` async-generator sugar for iterating over streams naturally.
- Flat `ResponsePart` shapes from conformance tests are reassembled via the test harness (`adaptParts`) into structured, disjoint `TextPart` and `A2uiPart` types rather than bending the lexer to match the flat python-derived structure.

### **What is NOT Implemented (and Why)**

- **Express / Elemental / Atom Inference Formats**: Only Direct JSON (`<a2ui-json>`) is implemented. The `InferenceFormat` seam remains cleanly open for their future addition.
- **Extended Catalog Transformers and Utils**: Only the specific catalog transformers required by the baseline features are implemented. Extended `catalog_transformers` and `utils` packages described by the module blueprint are omitted until a concrete use case necessitates them.

## **Validation & Execution Recipes**

### **Test Posture**

- **Overall**: 230 passing tests, 60 skipped, 0 failing, 0 expected failures.
- **Conformance**: 106 passing cases and 60 skipped (out of 166), across the legacy suites and the `catalog_provider`, `catalog_resolution` and `direct_json/prompt_generator` suites. `KNOWN_FAILURES` in `tests/conformance/loader.ts` is empty.
- **Why cases are skipped**: 39 declare protocol `v0.8`, which is permanently out of scope, 14 are legacy cases superseded by the newer suites, 4 generate skills, and 3 use an unimplemented inference format (Express, Elemental, Atom). None are skipped for an implementation defect.

### **Streaming Coverage**

Streaming behaviour is verified entirely against the canonical cases in `conformance/agent/`. Those are almost all `v0.9`, with a single `v1.0` case, but the streaming parser is version-independent in everything they exercise, so the `v0.9` cases cover the `v1.0` path too. The hand-translated local fixtures that stood in before `v0.9` was enabled have been retired: 19 of their 20 cases have a direct `_v09` canonical counterpart, and the twentieth, `test_url_placeholders_with_hints`, asserted only full resolution of a complete tree, which the canonical suite covers repeatedly.

- **Test execution**: Run unit/integration tests with `yarn test`.
- **Linting check**: Check style boundaries with `yarn lint`.
- **Formatting**: Format codebase via `yarn format`.

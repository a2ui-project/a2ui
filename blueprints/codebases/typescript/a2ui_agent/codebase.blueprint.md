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

The reference TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`). This SDK targets the A2UI protocol v1.0 exclusively, optimizing for a clean API surface over backwards compatibility.

- **Parser and Lexer Layer**: Defines the foundational seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer uses sticky regexes and offset-based string matching (`String.startsWith`) for quadratic-free tokenization performance.
- **Prompt Generation**: Decomposed into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method to enable decoupled skill generation without duplicating logic.
- **Catalog Layer**: Includes `CatalogConfig`, catalog pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs` handling fallback rules based on renderer capabilities.
- **Direct JSON Inference Format**: Implements `<a2ui-json>` serialization via `DirectJsonFormat`, complete with a robust streaming healer (`DirectJsonStreamProcessorImpl`). The streaming heuristic auto-heals fragmented chunks incrementally without blowing away intermediate references.
- **Processor Facades**: Features agent-lifetime (`A2uiGenerator`) and request-scoped (`A2uiRequestProcessor`) facades to cleanly orchestrate capability negotiation, prompt construction, parsing, and payload validation.
- **Conformance Harness**: A robust test runner that executes the upstream `conformance/agent/` YAML fixtures, dynamically mapping text and payload shapes across boundaries.

## **Local Technical Decisions & Overrides**

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` are implemented matching the TypeScript design doc rather than porting directly from Python.
  > **Correction/Risk Signal**: The `python/a2ui_agent/codebase.blueprint.md` states as fact that the Python SDK implements `A2uiGenerator` and `A2uiRequestProcessor`. This is untrue; neither class exists in the Python codebase. As a result, the TypeScript facades were authored to specification with no reference implementation to check against, presenting a risk signal for reviewers.
- `Parser.hasA2uiParts` is implemented and used, though absent in the blueprint. It runs the lexer and requires a closed block, whereas Python's substring test contradicts some conformance assertions.
- Transformers (e.g., pruning) return _new_ catalogs rather than mutating them, preventing stale schemas from leaking across inherited contexts.
- `Parser` incorporates a `parseStream` async-generator sugar for iterating over streams naturally.
- Flat `ResponsePart` shapes from conformance tests are reassembled via the test harness (`adaptParts`) into structured, disjoint `TextPart` and `A2uiPart` types rather than bending the lexer to match the flat python-derived structure.

### **What is NOT Implemented (and Why)**

- **v0.8 / v0.9 Protocol Support**: The SDK targets v1.0 only. Implementing older protocols would complicate the API surface and duplicate efforts on obsolete specs.
- **Express / Elemental / Atom Inference Formats**: Only Direct JSON (`<a2ui-json>`) is implemented. The `InferenceFormat` seam remains cleanly open for their future addition.
- **Extended Catalog Transformers and Utils**: Only the specific catalog transformers required by the baseline features are implemented. Extended `catalog_transformers` and `utils` packages described by the module blueprint are omitted until a concrete use case necessitates them.

## **Validation & Execution Recipes**

### **Test Posture**

- **Overall**: 126 passing tests, 95 skipped, 0 failing.
- **Conformance**: 36 passing cases and 95 skipped (out of 131 total cases).
- **Why cases are skipped**: Cases are skipped dynamically based on protocol version and format declarations, rather than hardcoded skip lists. The 95 skipped cases are skipped because they depend on unsupported protocols (v0.8, v0.9) or formats (Express, Elemental, Atom), not because of implementation defects.

### **Locally-Authored Streaming Cases**

Hand-translated v1.0 streaming cases are temporarily located at `tests/streaming_cases/v1_0_direct_json.yaml` because no canonical v1.0 streaming cases currently exist upstream. These should be promoted to `conformance/agent/` or retired once upstream versions land.

- **Test execution**: Run unit/integration tests with `yarn test`.
- **Linting check**: Check style boundaries with `yarn lint`.
- **Formatting**: Format codebase via `yarn format`.

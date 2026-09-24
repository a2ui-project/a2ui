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

The TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`), published as `@a2ui/agent`. It targets A2UI protocol v0.9 and v1.0 and implements the Direct JSON and Express inference formats. The protocol version a request emits is taken from its catalog (`utils/protocol_version.ts`), and v1.0 is the default when a catalog does not say.

- **Parser and Lexer Layer**: Defines the seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer matches tags with sticky regexes and scans strings and comments with offset-based `String.startsWith`, so tokenization stays linear.
- **Prompt Generation**: `PromptGenerator` is split into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method, as the `skill_generator` feature requires of the base contract.
- **Catalog Layer**: `CatalogConfig`, the component and function pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs`, which applies the fallback rules for renderer capabilities. `basicCatalog(version)` loads the v0.9 or v1.0 basic catalog from `web_core`'s `catalog.json`. A `WeakMap` registry (`utils/catalog_document.ts`) keeps each catalog's source JSON next to the `SchemaCatalog` built from it, because Express reads property order, enums and examples from that JSON.
- **Direct JSON Inference Format**: `DirectJsonFormat` handles `<a2ui-json>` blocks and includes a streaming healer (`DirectJsonStreamProcessorImpl`) that repairs fragmented chunks without discarding intermediate references.
- **Express Inference Format**: `inference_formats/express/` holds `ExpressFormat`, `ExpressParser`, `ExpressCompiler`, `ExpressDecompiler`, `ExpressPromptGenerator` and a `CatalogSchemaHelper`, ported from main's Python. The lexer and parser in `generated/` come from `specification/inference_formats/express/Express.g4` via `antlr-ng` (`yarn generate:express`) and run on the `antlr4ng` runtime, so no Java is needed. A unit test checks that their serialized ATNs match Python's checked-in parser.
- **Processor Facades**: `A2uiGenerator` (agent lifetime) and `A2uiRequestProcessor` (one request) orchestrate capability negotiation, prompt construction, parsing and payload validation.
- **Conformance Harness**: Two test runners execute the shared YAML suites. `tests/conformance/conformance.test.ts` runs `conformance/agent/{parser,streaming_parser,inference_format,skill}.yaml`, and `tests/conformance/express_conformance.test.ts` runs `conformance/agent/express/*.yaml`.

## **Local Technical Decisions & Overrides**

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` follow the TypeScript design doc rather than a Python port.
  > **Correction/Risk Signal**: `python/a2ui_agent/codebase.blueprint.md` states that the Python SDK implements `A2uiGenerator` and `A2uiRequestProcessor`. Neither class exists in the Python codebase, so the TypeScript facades were written to the specification with no reference implementation to check against.
- `A2uiRequestProcessor.generatePrompt(options)` is added next to `promptSnippet`. It is the counterpart of Python's `generate_system_prompt`: it takes role and UI descriptions and can append examples, which `promptSnippet` never does.
- Examples are keyed by catalog id and may be either a message list or a string, where the module blueprint allows only message lists. A string is preformatted text: Direct JSON inserts it as is, the way Python inserts the raw contents of its example files, and Express converts the fenced `json` blocks inside it. `A2uiGenerator` checks only message-list examples against the negotiated catalogs.
- Express takes exactly one catalog and throws `A2uiCatalogError` otherwise. It does not stream (`supportsStreaming` is false). It lives under `inference_formats/express/`, not the `experimental/` path main's Python uses.
- `A2uiCompilationParseError` and `A2uiCompilationValidationError` extend only `A2uiCompilationError`. In Python they also inherit from the core parse and validation errors, which a single-parent class cannot do.
- `Parser.hasA2uiParts` is implemented and used, though the blueprint does not list it. It runs the lexer and requires a closed block, whereas Python's substring test contradicts some conformance assertions.
- Transformers such as pruning return new catalogs rather than mutating them, so stale schemas cannot leak across contexts.
- `Parser` adds a `parseStream` async generator for iterating over streams.
- Flat `ResponsePart` shapes from the conformance suites are reassembled by the harness (`adaptParts`) into disjoint `TextPart` and `A2uiPart` types, rather than bending the lexer to the flat Python-derived structure.

Where the port follows Python even though conformance disagrees, `typescript/a2ui_agent/KNOWN_GAPS.md` records the case (§4), so issues can be filed upstream.

### **What is NOT Implemented (and Why)**

- **v0.8 protocol support**: Permanently out of scope for this SDK.
- **Elemental and Atom inference formats**: The `InferenceFormat` seam stays open for them.
- **Express streaming and multiple catalogs**: Express compiles only complete blocks, and each Express parser holds one catalog.
- **Skill generation**: The `skill_generator` feature is not claimed. Only its first requirement, the three-hook `PromptGenerator` contract, is in place; there is no `SkillGenerator`, `Skill` or `SkillSet`.
- **A2A helpers**: There is no counterpart to Python's `a2ui.a2a` (part wrapping, extension negotiation). The Node sample at `samples/agent/node/restaurant_finder` does this itself.
- **Extended catalog transformers and utils**: Only the transformers the current features need are implemented. The wider `catalog_transformers` and `utils` packages the module blueprint describes wait for a concrete use.

## **Validation & Execution Recipes**

### **Test Posture**

- **Overall**: 582 tests: 519 pass, 15 are expected failures, 48 are skipped, none fail.
- **Main conformance runner**: 131 cases, 84 pass and 47 are skipped. Its `KNOWN_FAILURES` list (`tests/conformance/loader.ts`) is empty. Cases are skipped by the protocol version and format they declare, not by name: 45 declare `v0.8`, and one each uses Elemental and Atom. None is skipped for a defect.
- **Express conformance runner**: 86 cases, 70 pass, 15 are expected failures and 1 is skipped. The expected failures are cases Python also fails, registered with `test.fails` and Python's reason, so fixing one turns the test red: 7 compiler, 6 decompiler, 1 response parser and 1 prompt generator case. The skipped case is the one Python marks unsupported, a block that targets a second catalog.
- **Unit tests**: 365 pass. Express parity fixtures for the visitor, compiler, decompiler and schema helper were generated from main's Python and are checked in under `tests/unit/inference_formats/express/fixtures/`.

### **Streaming Coverage**

Streaming is verified against the canonical cases in `conformance/agent/`. Those are almost all `v0.9`, with a single `v1.0` case, but the streaming parser is version-independent in everything they exercise, so the `v0.9` cases cover the `v1.0` path too. The hand-translated local fixtures that stood in before `v0.9` was enabled have been retired: 19 of their 20 cases have a direct `_v09` canonical counterpart, and the twentieth, `test_url_placeholders_with_hints`, asserted only full resolution of a complete tree, which the canonical suite covers repeatedly.

- **Test execution**: `yarn test`, or `yarn test:conformance` for the conformance runners only.
- **Linting check**: `yarn lint`.
- **Formatting**: `yarn format`.
- **Express parser regeneration**: `yarn generate:express`, only when the grammar changes.

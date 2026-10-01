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

The TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`), published as `@a2ui/agent`. It targets A2UI protocol v0.9 and v1.0 and implements the Direct JSON and Express inference formats. The protocol version a request emits is taken from its catalog (`utils/protocol_version.ts`). There is no default: each catalog states its version, either in its document or through the provider that loads it.

- **Parser and Lexer Layer**: Defines the seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer matches tags with sticky regexes and scans strings and comments with offset-based `String.startsWith`, so tokenization stays linear.
- **Prompt Generation**: `PromptGenerator` renders only the prompt snippet that tells the model how to write A2UI for the active catalogs. The rest of the system prompt, such as the agent's role, belongs to the agent developer. The generator is split into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method, as the `skill_generator` feature requires of the base contract.
- **Catalog Layer**: `CatalogConfig`, the component and function pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs`, which applies the fallback rules for renderer capabilities. The SDK bundles no catalog, not even the basic one; agents load catalog documents through a provider. A `WeakMap` registry (`utils/catalog-document.ts`) keeps each catalog's source JSON next to the `SchemaCatalog` built from it, because Express reads property order, enums and examples from that JSON.
- **Direct JSON Inference Format**: `DirectJsonFormat` handles `<a2ui-json>` blocks and includes a streaming healer (`DirectJsonStreamProcessorImpl`) that repairs fragmented chunks without discarding intermediate references. The stream processor takes every active catalog and uses, for each surface, the catalog its `createSurface` message names. Payload validation follows a `web_core` `ValidationConfig`, and `DirectJsonFormat` uses `STRICT_VALIDATION` unless given another.
- **Express Inference Format**: `inference_formats/express/` holds `ExpressFormat`, `ExpressParser`, `ExpressCompiler`, `ExpressDecompiler`, `ExpressPromptGenerator` and a `CatalogSchemaHelper`, ported from main's Python. The lexer and parser in `generated/` come from `specification/inference_formats/express/Express.g4` via `antlr-ng` (`yarn generate:express`) and run on the `antlr4ng` runtime, so no Java is needed. A unit test checks that their serialized ATNs match Python's checked-in parser.
- **Processor Facades**: `A2uiGenerator` (agent lifetime) and `A2uiRequestProcessor` (one request) orchestrate capability negotiation, prompt construction, parsing and payload validation.
- **Conformance Harness**: Test runners under `tests/conformance/` execute the shared YAML suites. `conformance.test.ts` runs the legacy suites in `conformance/agent/legacy/`, `catalog-provider.test.ts`, `catalog-resolution.test.ts` and `direct-json-prompt-generator.test.ts` run the matching blueprint suites, and `express_conformance.test.ts` runs `conformance/agent/express/*.yaml`.

### Protocol versions

Protocol versions are handled in a few fixed places, and adding a version means extending each of them:

- All `@a2ui/web_core` imports, including the `v0_9` and `v1_0` subpaths, go through `src/internal/web_core.ts`. Code outside that file uses the version-neutral `RendererCapabilities` type.
- The version stamped on emitted messages comes from the catalog's `protocolVersion`, not from a literal.
- Envelope validation in `src/utils/envelope_validation.ts` selects the v0.9 or v1.0 message schemas from that version. v1.0 adds `callRendererFunction` and `agentFunctionResponse` to the four messages shared with v0.9.
- `MessageProcessor` picks a version adapter for each message from the message's own `version` field, so the SDK does not configure a protocol version on the processor.
- The conformance harness runs the versions listed in `SUPPORTED_PROTOCOL_VERSIONS` in `tests/conformance/loader.ts`, currently `v0.9` and `v1.0`.

## **Local Technical Decisions & Overrides**

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` follow the TypeScript design doc rather than a Python port.
  > **Note**: `python/a2ui_agent/codebase.blueprint.md` describes `A2uiGenerator` and `A2uiRequestProcessor` as part of the Python SDK. They belong to the v1.0 work, which has not landed in Python yet, so the TypeScript facades were written to the specification with no reference implementation to check against.
- Examples are keyed by catalog id and may be either a message list or a string, where the module blueprint allows only message lists. A string is preformatted text: Direct JSON inserts it as is, the way Python inserts the raw contents of its example files, and Express converts the fenced `json` blocks inside it. `A2uiGenerator` checks only message-list examples against the negotiated catalogs.
- Express accepts several catalogs, where Python's takes one. A `surface("id", catalogId="...")` line picks the catalog a block compiles against, and names are looked up only in that catalog, so two catalogs may define the same component. A catalog that is not active throws `ExpressUnknownCatalogError`. A block that names no catalog uses the first one and logs a warning when several are active, the same fallback `resolveCatalogs` applies. All catalogs must share one protocol version. Express does not stream (`supportsStreaming` is false). It lives under `inference_formats/express/`, not the `experimental/` path main's Python uses.
- Express follows the conformance suite where it disagrees with main's Python. Unknown components and functions, missing required properties, inline id collisions and component ids that are not Express identifiers all throw, where Python drops, overwrites or writes invalid output. `EXPRESS_RULES` names no catalog component. `KNOWN_GAPS.md` lists the conformance cases where the two SDKs differ.
- `A2uiCompilationParseError` and `A2uiCompilationValidationError` extend only `A2uiCompilationError`. In Python they also inherit from the core parse and validation errors, which a single-parent class cannot do.
- `Parser.hasFormatContent(content, {complete})` follows the blueprint's `has_format_content`, but runs the block lexer instead of a substring test, so `complete` also checks that the closing tag follows the opening one.
- Transformers such as pruning return new catalogs rather than mutating them, so stale schemas cannot leak across contexts.
- `Parser` adds a `parseStream` async generator for iterating over streams.
- Flat `ResponsePart` shapes from the conformance suites are reassembled by the harness (`adaptParts`) into disjoint `TextPart` and `A2uiPart` types, rather than bending the lexer to the flat Python-derived structure.

Where the port follows Python even though conformance disagrees, `typescript/a2ui_agent/KNOWN_GAPS.md` records the case (§4), so issues can be filed upstream.

### **What is NOT Implemented (and Why)**

- **Elemental and Atom inference formats**: Only Express was required for this release, so the other two formats were not ported. On main they are still experimental in Python (`inference_formats/experimental/`). Adding them later means implementing `InferenceFormat` again, not changing it.
- **Express streaming**: Python's Express does not stream either, and upstream has said there will be no Express streaming conformance suite while the format does not stream. Building it here would be original design with nothing to check it against.
- **Skill generation**: The `skill_generator` feature is not claimed. It is a composition layer on top of `InferenceFormat` and `PromptGenerator`, so it can be added later without changing either. The part that is not additive, splitting `PromptGenerator` into three hooks, is already done, because retrofitting that split after formats exist would mean rewriting each format. There is no `SkillGenerator`, `Skill` or `SkillSet`, and the four `skill.yaml` conformance cases are skipped.
- **A2A and ADK helpers**: There is no counterpart to Python's `a2ui.a2a` or `a2ui.adk` packages (part wrapping, extension negotiation). The package stays transport-agnostic: it produces `AgentToRendererMessage` objects and leaves delivery to the caller. Adding transport bindings now would double the public surface before the core API has settled.
- **Extended catalog transformers and utils**: Only the transformers the current features need are implemented. The wider `catalog_transformers` and `utils` packages the module blueprint describes are left until a concrete use defines what they must do, so their API is not guessed in advance.

## **Validation & Execution Recipes**

### **Test Posture**

- **Overall**: 664 tests: 605 pass, 59 are skipped, none fail, and there are no expected failures.
- **Main conformance runners**: 166 cases, 107 pass and 59 are skipped, across the legacy suites and the `catalog_provider`, `catalog_resolution` and `direct_json/prompt_generator` suites. The `KNOWN_FAILURES` list (`tests/conformance/loader.ts`) is empty. Cases are skipped by the protocol version, format or action they declare, not by name: 39 declare `v0.8`, 14 are legacy cases superseded by the newer suites, 4 generate skills (`UNIMPLEMENTED_ACTIONS`), and one each uses Elemental and Atom. None is skipped for a defect. An action the runner does not handle fails the test instead of passing without assertions.
- **Express conformance runner**: 86 cases, all pass. Its `KNOWN_FAILURES` and `UNSUPPORTED` lists are empty. That includes the cases Python fails and the multi-catalog case Python marks unsupported; `KNOWN_GAPS.md` lists them so Python issues can be filed.
- **Unit tests**: 412 pass. The Express unit tests state their expected values inline and record no output from Python. The schema helper tests derive each basic catalog component's property order, required properties, checkability and enums, and each function's argument order, from the catalog JSON. Cases already in `conformance/agent/express/` are left to the Express conformance runner.

### **Streaming Coverage**

Streaming is verified against the canonical cases in `conformance/agent/`. Those are almost all `v0.9`, with a single `v1.0` case, but the streaming parser is version-independent in everything they exercise, so the `v0.9` cases cover the `v1.0` path too. The hand-translated local fixtures that stood in before `v0.9` was enabled have been retired: 19 of their 20 cases have a direct `_v09` canonical counterpart, and the twentieth, `test_url_placeholders_with_hints`, asserted only full resolution of a complete tree, which the canonical suite covers repeatedly.

- **Test execution**: `yarn test`, or `yarn test:conformance` for the conformance runners only.
- **Linting check**: `yarn lint`.
- **Formatting**: `yarn format`.
- **Express parser regeneration**: `yarn generate:express`, only when the grammar changes.

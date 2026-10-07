---
codebase_path: typescript/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: 47f4988ab66c88be77bd48ca8c92dffb8b39ea11
implemented_features: []
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **TypeScript Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`), published as `@a2ui/agent`. It targets A2UI protocol v0.9 and v1.0 and implements the Direct JSON and Express inference formats. The protocol version a request emits is taken from its catalog (`src/utils/protocol_version.ts`). There is no default: each catalog states its version, either in its document or through the provider that loads it.

- **Parser and Lexer Layer**: Defines the seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer matches tags with sticky regexes and scans strings and comments with offset-based `String.startsWith`, so tokenization stays linear.
- **Prompt Generation**: `PromptGenerator` renders only the prompt snippet that tells the model how to write A2UI for the active catalogs. The rest of the system prompt, such as the agent's role, belongs to the agent developer. The generator is split into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method, as the `skill_generator` feature requires of the base contract.
- **Catalog Layer**: `CatalogConfig`, the component and function pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs`, which applies the fallback rules for renderer capabilities. The SDK bundles no catalog, not even the basic one; agents load catalog documents through a provider. A `WeakMap` registry (`src/utils/catalog-document.ts`) keeps each catalog's source JSON next to the `CatalogApi` built from it, because Express reads property order, enums and examples from that JSON.
- **Direct JSON Inference Format**: `DirectJsonFormat` handles `<a2ui-json>` blocks and includes a streaming healer (`DirectJsonStreamProcessorImpl`) that repairs fragmented chunks without discarding intermediate references. The stream processor takes every active catalog and uses, for each surface, the catalog its `createSurface` message names. Payload validation follows a `web_core` `ValidationConfig`, and `DirectJsonFormat` uses `STRICT_VALIDATION` unless given another.
- **Express Inference Format**: `src/inference_formats/express/` holds `ExpressFormat`, `ExpressParser`, `ExpressCompiler`, `ExpressDecompiler`, `ExpressPromptGenerator` and `CatalogSchemaHelper`, ported from main's Python. The lexer and parser in `src/inference_formats/express/generated/` come from `specification/inference_formats/express/Express.g4` via `antlr-ng` (`yarn generate:express`) and run on the `antlr4ng` runtime, so no Java is needed. A unit test checks that their serialized ATNs match Python's checked-in parser.
- **Processor Facades**: `A2uiGenerator` (agent lifetime) and `A2uiRequestProcessor` (one request) orchestrate capability negotiation, prompt construction, parsing and payload validation.
- **Conformance Harness**: Test runners under `tests/conformance/` execute the shared YAML suites. `conformance.test.ts` runs the legacy suites in `conformance/agent/legacy/`, `catalog-provider.test.ts`, `catalog-resolution.test.ts` and `direct-json-prompt-generator.test.ts` run the matching blueprint suites, and `express_conformance.test.ts` runs `conformance/agent/express/*.yaml`.

### Protocol versions

Protocol versions are handled in a few fixed places, and adding a version means extending each of them:

- All `@a2ui/web_core` imports, including the `v0_9` and `v1.0` subpaths, go through `src/internal/web_core.ts`. Code outside that file uses the version-neutral `RendererCapabilities` type.
- The version stamped on emitted messages comes from the catalog's `protocolVersion`, not from a literal.
- Envelope validation in `src/utils/envelope_validation.ts` selects the v0.9 or v1.0 message schemas from that version. v1.0 adds `callRendererFunction` and `agentFunctionResponse` to the four messages shared with v0.9.
- `MessageProcessor` picks a version adapter for each message from the message's own `version` field, so the SDK does not configure a protocol version on the processor.
- The conformance harness runs the versions listed in `SUPPORTED_PROTOCOL_VERSIONS` in `tests/conformance/loader.ts`, currently `v0.9` and `v1.0`.

## **Local Technical Decisions & Overrides**

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` follow the module blueprint specification directly rather than a Python port.
  > **Note**: `python/a2ui_agent/codebase.blueprint.md` describes `A2uiGenerator` and `A2uiRequestProcessor` as part of the Python SDK. They belong to the v1.0 work, which has not landed in Python yet, so the TypeScript facades were written to the specification with no reference implementation to check against.
- `CatalogProvider.load()` and `CatalogConfig.fromPath()` return promises (`Promise<CatalogApi>` and `Promise<CatalogConfig>`) instead of synchronous values, because `FileSystemCatalogProvider` reads files with `fs.promises.readFile`.
- `RawResponsePart` is an intersection type (`(TextPart | RawA2uiPart) & {isFinal: boolean}`) discriminated by `type: 'text' | 'a2ui'` instead of wrapping a nested `part` field, so TypeScript discriminated-union narrowing works directly on `part.type`.
- `DirectJsonFormat` and `DirectJsonFormatFactory` configure streaming through `DirectJsonStreamProcessorFactory` and `DirectJsonStreamProcessorOptions` (`progressiveKeys`, `validationConfig`) rather than taking `progressive_keys` and `allowed_messages` directly on the format constructor.
- Examples are a `Record<string, AgentToRendererMessage[] | string>` keyed by catalog id, where the module blueprint takes an ordered list of message-list example turns. A string is preformatted text: Direct JSON inserts it as is, the way Python inserts the raw contents of its example files, and Express converts the fenced `json` blocks inside it. `A2uiGenerator` checks only message-list examples against the negotiated catalogs.
- Express accepts several catalogs, where Python's takes one. A `surface("id", catalogId="...")` line picks the catalog a block compiles against, and names are looked up only in that catalog, so two catalogs may define the same component. A catalog that is not active throws `ExpressUnknownCatalogError`. A block that names no catalog uses the first one and logs a warning when several are active, the same fallback `resolveCatalogs` applies. All catalogs must share one protocol version. Express does not stream (`supportsStreaming` is false). It lives under `src/inference_formats/express/`, not the `experimental/` path main's Python uses.
- Express derives component and property behaviour from the catalog JSON schema by matching exact protocol definitions (`common_types.json#/$defs/<Name>`) rather than substring-matching `$ref` or hardcoding catalog property names:
  1. Action slots are properties referencing common `Action`.
  2. Option-object coercion (`"s"` to `{"label": "s", "value": "s"}`) triggers on array items declaring `label` and `value` properties, kept as the sole property-name check for parity with Python.
  3. Implicit check targets bind a check function's first declared parameter when the component binds a property of the same name to a path.
  4. A component's check-rule property is discovered from its own properties or an `allOf` common def as an array of common `CheckRule`; writing checks on a component with no check-rule property throws `ExpressValidationError`.
  5. `EXPRESS_RULES` names no catalog component.
  6. Data-binding allowance (`admitsPath`) checks structurally whether a schema is or combines an object declaring `path`, and compilation walks nested array items and object properties alongside the schema.
- Express follows the conformance suite where it disagrees with main's Python. Unknown components and functions, missing required properties, inline id collisions and component ids that are not Express identifiers all throw, where Python drops, overwrites or writes invalid output. `typescript/a2ui_agent/KNOWN_GAPS.md` lists the conformance cases where the two SDKs differ.
- `A2uiCompilationParseError` and `A2uiCompilationValidationError` extend only `A2uiCompilationError`. In Python they also inherit from the core parse and validation errors, which a single-parent class cannot do.
- `Parser.hasFormatContent(content, {complete})` follows the blueprint's `has_format_content`, but runs the block lexer instead of a substring test, so `complete` also checks that the closing tag follows the opening one.
- Transformers such as pruning return new catalogs rather than mutating them, so stale schemas cannot leak across contexts.
- `Parser` adds a `parseStream` async generator for iterating over streams.
- Flat `ResponsePart` shapes from the conformance suites are reassembled by the harness (`adaptParts`) into disjoint `TextPart` and `A2uiPart` types, rather than bending the lexer to the flat Python-derived structure.

Where the port follows Python even though conformance disagrees, `typescript/a2ui_agent/KNOWN_GAPS.md` records the case (§4), so issues can be filed upstream.

### **What is NOT Implemented (and Why)**

- **Elemental and Atom inference formats**: Only Express was required for this release, so the other two formats were not ported. On main they are still experimental in Python (`inference_formats/experimental/`). Adding them later means implementing `InferenceFormat` again, not changing it.
- **Express streaming**: Python's Express does not stream either, and upstream has said there will be no Express streaming conformance suite while the format does not stream. Building it here would be original design with nothing to check it against.
- **Skill generation**: The `skill_generator` feature is not claimed. It is a composition layer on top of `InferenceFormat` and `PromptGenerator`, so it can be added later without changing either. The part that is not additive, splitting `PromptGenerator` into three hooks, is already done, because retrofitting that split after formats exist would mean rewriting each format. There is no `SkillGenerator`, `Skill` or `SkillSet`, and the `skill.yaml` conformance cases are skipped.
- **A2A and ADK helpers**: There is no counterpart to Python's `a2ui.a2a` or `a2ui.adk` packages (part wrapping, extension negotiation). The package stays transport-agnostic: it produces `AgentToRendererMessage` objects and leaves delivery to the caller. Adding transport bindings now would double the public surface before the core API has settled.
- **Extended catalog transformers and utils**: Only the transformers the current features need are implemented. The wider `catalog_transformers` and `utils` packages the module blueprint describes are left until a concrete use defines what they must do, so their API is not guessed in advance.

## **Validation & Execution Recipes**

### **Test Structure & Coverage**

- **Main conformance runners** (`tests/conformance/`): Run the legacy suites (`conformance/agent/legacy/*.yaml`) alongside the `catalog_provider`, `catalog_resolution` and `direct_json/prompt_generator` blueprint suites. The `KNOWN_FAILURES` list (`tests/conformance/loader.ts`) is empty. Cases are skipped by the protocol version, format or action they declare, not by name: `v0.8` cases, legacy cases superseded by the newer suites, skill-generation actions (`UNIMPLEMENTED_ACTIONS`), and Elemental or Atom cases. None is skipped for a defect, and an unhandled action fails the test instead of passing without assertions.
- **Express conformance runner** (`tests/conformance/express_conformance.test.ts`): Runs all suites under `conformance/agent/express/*.yaml` (`compiler`, `decompiler`, `response_parser`, `prompt_generator`) with empty `KNOWN_FAILURES` and `UNSUPPORTED` lists. That includes the cases Python fails and the multi-catalog case Python marks unsupported; `typescript/a2ui_agent/KNOWN_GAPS.md` lists them so Python issues can be filed.
- **Unit tests** (`tests/unit/`): Cover the lexer, parsers, streaming healer, catalog providers and transformers, processor facades, and Express compiler/decompiler/prompt generator. The Express unit tests state their expected values inline and record no output from Python. The schema helper tests derive each basic catalog component's property order, required properties, checkability and enums, and each function's argument order, from the catalog JSON. Cases already in `conformance/agent/express/` are left to the Express conformance runner.
- **Streaming coverage**: Verified against the canonical streaming cases in `conformance/agent/` as well as unit tests in `tests/unit/inference_formats/direct_json/streaming.test.ts`. Although the canonical streaming cases are primarily `v0.9`, the streaming parser is version-independent in everything they exercise, so those cases cover the `v1.0` path too.

### **Commands**

- **Test execution**: `yarn test`, or `yarn test:conformance` for the conformance runners only.
- **Linting check**: `yarn lint`.
- **Formatting**: `yarn format`.
- **Express parser regeneration**: `yarn generate:express`, only when the grammar changes.

### **Express Parser Generation & ANTLR Parity**

The Express lexer, parser, and visitor in `src/inference_formats/express/generated/` are generated from `specification/inference_formats/express/Express.g4` and checked in so building, testing, and using the package never runs the generator.

- **Generator and runtime**: Uses [`antlr-ng`](https://www.antlr-ng.org/introduction.html) (devDependency, TypeScript port of ANTLR 4.13.2) targeting [`antlr4ng`](https://www.npmjs.com/package/antlr4ng) (runtime dependency). Both are pinned to exact versions because `antlr-ng` pins the `antlr4ng` version it generates for.
- **Command**: `yarn workspace @a2ui/agent generate:express` runs `antlr-ng -Dlanguage=TypeScript --generate-visitor --generate-listener false -o src/inference_formats/express/generated ../../specification/inference_formats/express/Express.g4`, matching Python's visitor-only flags. The generated directory is excluded from ESLint and Prettier.
- **ATN parity with Python**: `tests/unit/inference_formats/express/generated_parser.test.ts` compares the serialized lexer and parser ATNs against Python's checked-in parser (generated by the Java ANTLR 4.13.2 tool) and fails if either SDK is regenerated from a different grammar.
- **Visitor overrides and error columns**:
  - The generated TypeScript visitor declares each `visitX` as an optional property rather than a method. Assign overrides as instance properties, do not call `super.visitX(ctx)`, and use `this.visitChildren(ctx)` for the default behaviour (returning the last child's result, as in Python).
  - Error columns are zero-based in both languages because Python passes ANTLR's `charPositionInLine` through unchanged.
- **When `Express.g4` changes**:
  - Add a matching visitor override in both SDKs for any new parser rule; otherwise the visitor silently returns the last child's result.
  - If a lexer rule widens beyond ASCII (for example `IDENTIFIER`), check column and slicing logic (Python counts Unicode code points; JavaScript counts UTF-16 code units).
  - If an ignored token moves from `-> skip` to a hidden channel, recheck `getText()` callers.
  - If `NUMBER` or string delimiters change, recheck literal parsing in both visitors and formatting in both decompilers.
  - Regenerate both SDKs in the same change so the ATN parity test passes.


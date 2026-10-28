---
codebase_path: typescript/agents/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: 2e3d9bc434a34ba25498a11e0bfba079b52dcf29
implemented_features:
  skill_generator: c177173ca12a9d4739e16e56d6eb87b1e0608d85
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **TypeScript Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The TypeScript implementation of the A2UI Agent SDK (`a2ui_agent`), published as `@a2ui/agent`. It targets A2UI protocol v0.9 and v1.0 and implements the Direct JSON and Express inference formats. The protocol version a request emits is taken from its catalog (`src/utils/protocol-version.ts`). There is no default: each catalog states its version, either in its document or through the provider that loads it.

- **Parser and Lexer Layer**: Defines the seams (`Parser`, `BlockLexer`, `ResponsePart`, `RawResponsePart`) through which formats are implemented. The lexer matches tags with sticky regexes and scans strings and comments with offset-based `String.startsWith`, so tokenization stays linear.
- **Prompt Generation**: `PromptGenerator` renders only the prompt snippet that tells the model how to write A2UI for the active catalogs. The rest of the system prompt, such as the agent's role, belongs to the agent developer. The generator is split into three hooks (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`) under a template `generate()` method, as the `skill_generator` feature requires of the base contract.
- **Skill Generation**: `src/skill/` holds `Skill`, `SkillSet`, and `SkillGenerator`. `SkillGenerator` wraps an `InferenceFormat` (`generateSkill`, `generateCoreSkill`, `generateCatalogSkill`, `generateSkillSet`) to assemble monolithic or modular `SKILL.md` documents with YAML frontmatter (`toMarkdown`) and optional filesystem export (`exportToDirectory`).
- **Catalog Layer**: `CatalogConfig`, the component and function pruning transformers, in-memory and file-system `CatalogProvider` implementations, and `resolveCatalogs`, which applies the fallback rules for renderer capabilities. Agents never execute catalog functions, so catalogs are typed as schema-only `CatalogApi` (`Catalog<ComponentApi, FunctionApi>`). The SDK bundles no catalog, not even the basic one; agents load catalog documents through a provider. A `WeakMap` registry (`src/utils/catalog-document.ts`) keeps each catalog's source JSON next to the `CatalogApi` built from it: `web_core`'s regenerated `catalog.catalogSchema` inlines `checks` as the first property on Checkable components instead of appending it at the end like Python, which would shift every positional argument in Express by one if property order were read from `catalogSchema`.
- **Direct JSON Inference Format**: `DirectJsonFormat` handles `<a2ui-json>` blocks and includes a streaming healer (`DirectJsonResponseStream`) that repairs fragmented chunks without discarding intermediate references. The stream applies each block's messages as it emits them, with no transaction around a chunk, so a failing chunk's earlier parts stay applied and are returned in the error's `partialResults`. With `afterRejectedBlock: 'continue'` it keeps scanning a rejected block for its closing tag without reading it. The stream processor takes every active catalog, resolves components against their own `catalogId` (falling back to the surface's catalog), and buffers incomplete v1.0 components until closed. Payload validation follows a `web_core` `ValidationConfig`, and `DirectJsonFormat` uses `STRICT_VALIDATION` unless given another.
- **Express Inference Format**: `src/inference-formats/express/` holds `ExpressFormat`, `ExpressParser`, `ExpressCompiler`, `ExpressDecompiler`, `ExpressPromptGenerator` and `CatalogSchemaHelper`, ported from main's Python. `ExpressCompiler.compile` is stateless per call: a scope that assigns `root` folds its data path assignments (including in-scope list element overrides and canonical numeric-segment list auto-vivification) into a single root data model on `createSurface` (plus `updateComponents` and a single root `updateDataModel` on v0.9), while a non-creating scope emits `updateComponents` (when component assignments are present) and one targeted `updateDataModel` message per data path assignment at its JSON Pointer path. Sentinel `<a2ui>` tags are stripped both by `BlockLexer` in `unwrap` and inside `ExpressCompiler.compile` for direct compiler callers. Within a catalog, identifier lookup resolves in order: catalog components, built-ins (`_template`, `Event`), then catalog functions.
- **Agent and renderer in one app**: `RendererState.of(processor)` runs the state on a renderer's `MessageProcessor`, passing `IN_PROGRESS_VALIDATION` in each call's `ExecutionContext` instead of configuring its own processor, and holds `callRendererFunction` messages until the outermost frame of its undo log closes. `StreamedAnswer` (`src/processor/streamed-answer.ts`) builds on it.
- **Processor Facades**: `A2uiGenerator` (agent lifetime) and `A2uiRequestProcessor` (one request) orchestrate capability negotiation, prompt construction, parsing and payload validation. Validation runs through `MessageProcessor` rather than a standalone `PayloadValidator` because only `MessageProcessor` can validate across a mixed-catalog surface.
- **Conformance Harness**: Test runners under `tests/conformance/` execute the shared YAML suites. `conformance.test.ts` runs the legacy suites in `conformance/agent/legacy/`, `catalog-provider.test.ts`, `catalog-resolution.test.ts`, `catalog-transformer.test.ts`, `direct-json-conformance.test.ts`, `direct-json-prompt-generator.test.ts`, `direct-json-response-streaming.test.ts`, `multi-catalog-conformance.test.ts`, `skill-conformance.test.ts` and `streamed-answer.test.ts` run the matching blueprint suites (`catalog_provider.yaml`, `catalog_resolution.yaml`, `catalog_transformer.yaml`, `direct_json/*.yaml`, `multi_catalog_formats.yaml`, `request_processor.yaml`, `skill.yaml`, `streamed_answer.yaml`), and `express-conformance.test.ts` runs `conformance/agent/express/*.yaml`.

### Protocol versions and `@a2ui/web_core` seam

Protocol versions and core dependencies are handled in a few fixed places, and adding a version means extending each of them:

- All `@a2ui/web_core` imports, including the `v0_9` and `v1_0` subpaths, go through `src/internal/web-core.ts` using narrow subpath exports rather than the `@a2ui/web_core` root. When the framework-agnostic pieces of `web_core` are split into `@a2ui/a2ui_core`, only `src/internal/web-core.ts` needs to change. Code outside that file uses the version-neutral `RendererCapabilities` type.
- The version stamped on emitted messages comes from the catalog's `protocolVersion`, not from a literal.
- Envelope validation in `src/utils/envelope-validation.ts` selects the v0.9 or v1.0 message schemas from that version. v1.0 adds `callRendererFunction` and `agentFunctionResponse` to the four messages shared with v0.9.
- `MessageProcessor` picks a version adapter for each message from the message's own `version` field, so the SDK does not configure a protocol version on the processor.
- The conformance harness runs the versions listed in `SUPPORTED_PROTOCOL_VERSIONS` in `tests/conformance/loader.ts`, currently `v0.9` and `v1.0`.

## **Local Technical Decisions & Overrides**

### **Coding Rules**

- **File and directory naming (`kebab-case`)**: Name all source and test files and directories in `kebab-case` (for example `src/inference-formats/direct-json/prompt-generator.ts`, `src/catalog-transformers/`, `src/processor/catalog-config.ts`), never `snake_case`, even when the language-agnostic module blueprint (`blueprints/modules/a2ui_agent.blueprint.md`) writes module paths in `snake_case`. The only exception is `src/inference-formats/express/generated/`, whose `PascalCase` filenames (`ExpressLexer.ts`, `ExpressParser.ts`, `ExpressVisitor.ts`) come from `antlr-ng` and the `Express.g4` grammar name.

### **Deviations from the Module Blueprint**

- `A2uiGenerator` and `A2uiRequestProcessor` follow the module blueprint specification directly rather than a Python port.
  > **Note**: `python/a2ui_agent/codebase.blueprint.md` describes `A2uiGenerator` and `A2uiRequestProcessor` as part of the Python SDK. They belong to the v1.0 work, which has not landed in Python yet, so the TypeScript facades were written to the specification with no reference implementation to check against.
- `RawResponsePart` is an intersection type (`(TextPart | RawA2uiPart) & {isFinal: boolean}`) discriminated by `type: 'text' | 'a2ui'` instead of wrapping a nested `part` field, so TypeScript discriminated-union narrowing works directly on `part.type`.
- `DirectJsonFormat` and `DirectJsonFormatFactory` configure streaming through `progressiveKeys` and `validationConfig` options on the format and parser constructors rather than taking `progressive_keys` and `allowed_messages` positional arguments.
- Examples are a `Record<string, AgentToRendererMessage[] | string | (AgentToRendererMessage[] | string)[]>` keyed by catalog id, where the module blueprint takes an ordered list of message-list example turns. A string is preformatted text: Direct JSON inserts it as is, the way Python inserts the raw contents of its example files, and Express converts the fenced `json` blocks inside it. `A2uiGenerator` checks only message-list examples against the negotiated catalogs.
- Express derives component and property behaviour from the catalog JSON schema by matching exact protocol definitions (`common_types.json#/$defs/<Name>`) rather than substring-matching `$ref` or hardcoding catalog property names:
  1. Action slots are properties referencing common `Action`.
  2. Option-object coercion (`"s"` to `{"label": "s", "value": "s"}`) triggers on array items declaring `label` and `value` properties, kept as the sole property-name check for parity with Python.
  3. Implicit check targets bind a check function's first declared parameter when the component binds a property of the same name to a path.
  4. A component's check-rule property is discovered from its own properties or an `allOf` common def as an array of common `CheckRule`; writing checks on a component with no check-rule property throws `ExpressValidationError`.
  5. `EXPRESS_RULES` names no catalog component.
  6. Data-binding allowance (`admitsPath`) checks structurally whether a schema is or combines an object declaring `path`, and compilation walks nested array items and object properties alongside the schema.
- Express follows the conformance suite where it disagrees with main's Python. Unknown components and functions, missing required properties, and inline id collisions all throw, where Python drops or overwrites. `typescript/agents/a2ui_agent/KNOWN_GAPS.md` lists the conformance cases where the two SDKs differ.
- `A2uiCompilationParseError` and `A2uiCompilationValidationError` extend only `A2uiCompilationError`. In Python they also inherit from the core parse and validation errors, which a single-parent class cannot do.
- `Parser.hasFormatContent(content, {complete})` follows the blueprint's `has_format_content`, but runs the block lexer instead of a substring test, so `complete` also checks that the closing tag follows the opening one.
- Transformers such as pruning return new catalogs rather than mutating them, so stale schemas cannot leak across contexts.
- `Parser` adds a `parseStream` async generator for iterating over streams.
- `ResponseStream` takes the type of the parts it returns as a parameter, and `openStream` is overloaded so that only a stream opened with `afterRejectedBlock: 'continue'` is typed to return `ErrorPart`s.
- Flat `ResponsePart` shapes from the conformance suites are reassembled by the harness (`adaptParts`) into disjoint `TextPart` and `A2uiPart` types, rather than bending the lexer to the flat Python-derived structure.

Where the port follows Python even though conformance disagrees, `typescript/agents/a2ui_agent/KNOWN_GAPS.md` records the case (§4), so issues can be filed upstream.

### **What is NOT Implemented (and Why)**

- **Elemental and Atom inference formats**: Only Express was required for this release, so the other two formats were not ported. On main they are still experimental in Python (`inference_formats/experimental/`). Adding them later means implementing `InferenceFormat` again, not changing it.
- **Express streaming**: Python's Express does not stream either, and upstream has said there will be no Express streaming conformance suite while the format does not stream. Building it here would be original design with nothing to check it against.
- **A2A and ADK helpers**: There is no counterpart to Python's `a2ui.a2a` or `a2ui.adk` packages (part wrapping, extension negotiation). The package stays transport-agnostic: it produces `AgentToRendererMessage` objects and leaves delivery to the caller. Adding transport bindings now would double the public surface before the core API has settled.
- **Extended catalog transformers and utils**: Only the transformers the current features need are implemented. The wider `catalog_transformers` and `utils` packages the module blueprint describes are left until a concrete use defines what they must do, so their API is not guessed in advance.

## **Validation & Execution Recipes**

### **Test Structure & Coverage**

- **Main conformance runners** (`tests/conformance/`): Run the legacy suites (`conformance/agent/legacy/*.yaml`) alongside the `catalog_provider`, `catalog_resolution`, `catalog_transformer`, `direct_json/*`, `multi_catalog_formats`, `request_processor`, and `skill` blueprint suites. The `KNOWN_FAILURES` list (`tests/conformance/loader.ts`) is empty. Cases are skipped by the protocol version, format or action they declare, not by name: `v0.8` cases, legacy cases superseded by the newer suites, and Elemental or Atom cases. None is skipped for a defect, and an unhandled action fails the test instead of passing without assertions.
- **Express conformance runner** (`tests/conformance/express-conformance.test.ts`): Runs all suites under `conformance/agent/express/*.yaml` (`compiler`, `decompiler`, `response_parser`, `prompt_generator`) with empty `KNOWN_FAILURES` and `UNSUPPORTED` lists. That includes the cases Python fails; `typescript/agents/a2ui_agent/KNOWN_GAPS.md` lists them so Python issues can be filed.
- **Unit tests** (`tests/unit/`): Cover the lexer, parsers, streaming healer, catalog providers and transformers, processor facades, and Express compiler/decompiler/prompt generator. The Express unit tests state their expected values inline and record no output from Python. The schema helper tests derive each basic catalog component's property order, required properties, checkability and enums, and each function's argument order, from the catalog JSON. Cases already in `conformance/agent/express/` are left to the Express conformance runner.
- **Streaming coverage**: Verified against the canonical streaming cases in `conformance/agent/` as well as unit tests in `tests/unit/inference-formats/direct-json/streaming.test.ts`. Canonical cases cover both `v0.9` and `v1.0`, including multi-catalog resolution and buffering incomplete components.

### **Commands**

- **Test execution**: `yarn test`, or `yarn test:conformance` for the conformance runners only.
- **Linting check**: `yarn lint`.
- **Formatting**: `yarn format`.
- **Express parser regeneration**: `yarn generate:express`, only when the grammar changes.

### **Express Parser Generation & ANTLR Parity**

The Express lexer, parser, and visitor in `src/inference-formats/express/generated/` are generated from `specification/inference_formats/express/Express.g4` (which takes precedence over the prose proposal whenever the two disagree, such as newline handling) and checked in so building, testing, and using the package never runs the generator.

- **Generator and runtime**: Uses [`antlr-ng`](https://www.antlr-ng.org/introduction.html) (devDependency, TypeScript port of ANTLR 4.13.2) targeting [`antlr4ng`](https://www.npmjs.com/package/antlr4ng) (runtime dependency). Both are pinned to exact versions because `antlr-ng` pins the `antlr4ng` version it generates for. The official `antlr4` npm runtime is not used because its type declarations fail under `"moduleResolution": "nodenext"` (extensionless relative re-exports in its ESM `.d.ts` files), its `AbstractParseTreeVisitor.visitChildren` returns an array instead of the last child's result, and the official tool requires Java.
- **Command**: `yarn workspace @a2ui/agent generate:express` runs `antlr-ng -Dlanguage=TypeScript --generate-visitor --generate-listener false -o src/inference-formats/express/generated ../../../specification/inference_formats/express/Express.g4`, matching Python's visitor-only flags (`python/a2ui_agent/scripts/generate_express_parser.py`). The generated directory is excluded from ESLint and Prettier.
- **ATN parity with Python**: `tests/unit/inference-formats/express/generated-parser.test.ts` compares the serialized parser ATN value-for-value and the deserialized lexer ATN state, rule, mode, and transition graph against Python's checked-in `express_lexer.py` and `express_parser.py` (generated by the Java ANTLR 4.13.2 tool, whose ICU4J table targets Unicode 15.0 while `antlr-ng` 1.0.10 targets Unicode 16.0 for `\p{XID_Start}` and `\p{XID_Continue}`) and fails if either SDK is regenerated from a different grammar.
- **Visitor overrides and error columns**:
  - The generated TypeScript visitor declares each `visitX` as an optional property rather than a method. Assign overrides as instance properties, do not call `super.visitX(ctx)`, and use `this.visitChildren(ctx)` for the default behaviour (returning the last child's result, as in Python).
  - Error columns are zero-based in both languages because Python passes ANTLR's `charPositionInLine` through unchanged. Each runtime words syntax errors its own way, so conformance cases assert on error category, line, and column rather than message wording.
- **Reviewer checklist when `Express.g4` changes**:
  - Did a parser rule get added? Add a matching visitor override in both SDKs; otherwise the visitor silently returns the last child's result.
  - Did a lexer rule's character class widen beyond ASCII (for example `IDENTIFIER`)? Check column and slicing logic: Python counts Unicode code points while JavaScript counts UTF-16 code units.
  - Did an ignored token move from `-> skip` to a hidden channel? Recheck `getText()` callers.
  - Did `NUMBER` (for example gaining an exponent) or string delimiters change? Recheck literal parsing in both visitors and formatting in both decompilers. Since issue 3019, `NUMBER` is `[+-]? ([0-9]+ ('.' [0-9]*)? | '.' [0-9]+) ([eE] [+-]? [0-9]+)?` (a JSON number plus an optional `+`), an out-of-range literal is a `ParseError`, and decompilers write doubles as ECMAScript `Number.prototype.toString` does; the `*_number_*` and `*_integers_*` cases in `conformance/agent/express/compiler.yaml` and `decompiler.yaml` pin this.
  - Were both SDKs regenerated in the same change? The ATN parity test fails until they are.

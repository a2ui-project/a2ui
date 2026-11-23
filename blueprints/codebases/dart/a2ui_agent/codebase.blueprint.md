---
codebase_path: dart/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
implemented_features:
  agent_functions: 87b945802660c507bc84f7f47a25199b4939efbe
  agent_renderer_app: 21e8df7f8e67619c30682ede25f17f0a9cfa96f8
  skill_generator: e4e8ee409b5dc32f97e3f452bafc07897fa6a05b
local_development:
  test_command: 'dart test'
  lint_command: 'dart analyze --fatal-infos'
  format_command: 'dart format .'
---

# **Dart Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Dart implementation of the A2UI Agent SDK (`a2ui_agent`), targeting A2UI protocols v0.9 and v1.0 across Direct JSON and Express inference formats.

- **Inference Formats & Prompt Generation**: Implements `InferenceFormat` and `PromptGenerator` (`lib/src/inference_format.dart`, `lib/src/prompt/generator.dart`) with concrete strategies for Direct JSON (`lib/src/inference_formats/direct_json/`) and Express (`lib/src/inference_formats/express/`). A format implements `catalogs` and three sections (`generateBaseRules`, `generateCatalogInstructions`, `generateExamples`); the `@nonVirtual` `generate()` joins them with `assembleInstructions`, as the `skill_generator` feature requires of the base contract.
- **Skill Generation**: `lib/src/skill/` holds `Skill`, `SkillSet`, and `SkillGenerator`. `SkillGenerator` wraps an `InferenceFormat` (`generateSkill`, `generateCoreSkill`, `generateCatalogSkill`, `generateSkillSet`) to build monolithic or modular `SKILL.md` documents with YAML frontmatter (`toMarkdown`) and export them to disk (`exportToDirectory`).
- **Parser & Streaming Layer**: `Parser`, `ResponsePart`, and `ResponseStream` (`lib/src/parser/`) tokenize sentinel-wrapped model responses and support incremental Direct JSON and Express streaming.
- **Express Compiler & Decompiler**: `ExpressCompiler` and `ExpressDecompiler` (`lib/src/inference_formats/express/`) compile A2UI Express DSL scopes into protocol messages and decompile messages back into Express syntax using an ANTLR-generated parser (`generated/`).
- **Processor Facades & Catalog Negotiation**: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`, `CatalogProvider`, `readRendererCapabilities` (with `a2uiClientCapabilitiesKey` and `a2uiRendererCapabilitiesKey` in `lib/src/utils/renderer_capabilities.dart`), `resolveCatalogs`, and `RendererState` (`lib/src/processor/`, `lib/src/utils/`) manage capability extraction and negotiation, pruning transformers (`lib/src/catalog_transformers/`), and multi-catalog surface validation against `a2ui_core`.
- **Bidirectional Function RPC**: `RendererToAgentMessageProcessor` and `RendererFunctionCalls` (`lib/src/rpc/`) dispatch `callAgentFunction` requests against registered catalog `AgentFunction` implementations and manage pending `callRendererFunction` invocations.

## **Local Technical Decisions & Overrides**

- **Protocol Version Selection from Active Catalogs**: Emitted message envelopes take their protocol version from the active `Catalog` instances negotiated for the request rather than a hardcoded default.
- **Skill API in Dart terms**: `Skill` is immutable, including `metadata`. `SkillSet` takes an `Iterable<Skill>` rather than a filename-keyed map, so a key always equals its skill's `filename`; it exposes the skills as an unmodifiable `skills` map and serializes with `toMap()`. `generateCatalogInstructions` and `generateExamples` take no `include_schema` or `validate` flag, since nothing in the package uses them. The frontmatter writer follows PyYAML's quoting and its line wrapping at column 80, which `agent/skill.yaml` checks.
- **Skill export without `dart:io`**: `SkillSet.exportToDirectory` writes through a conditional import (`skill_files_io.dart`), so the package still compiles for the web, where the export throws `UnsupportedError`.
- **ANTLR-Generated Express Grammar**: The Express lexer and parser under `lib/src/inference_formats/express/generated/` are generated from the canonical `specification/inference_formats/express/Express.g4` grammar.
- **Prompt Generators Exported from the Package**: `lib/a2ui_agent.dart` exports `DirectJsonPromptGenerator` and `ExpressPromptGenerator` directly rather than keeping them internal to their format directories.
- **No Built-in Transport Adapters**: `dart/a2ui_agent` stays transport-agnostic and does not bundle A2A or ADK framework wrappers; callers pass decoded `RendererToAgentMessage` payloads to `RendererToAgentMessageProcessor` and read transport metadata through `readRendererCapabilities`.
- **Component Envelope Keys**: On v1.0 components, `ExpressCompiler` (`lib/src/inference_formats/express/compiler.dart`) emits `@catalogId`, `@metadata`, and `@checks`; `CatalogSchemaHelper` (`lib/src/inference_formats/express/schema_helper.dart`) strips `@catalogId`, `@metadata`, `@accessibility`, and `@checks` (plus standard bare mixins) from Express signatures while keeping custom bare properties; `ExpressDecompiler` (`lib/src/inference_formats/express/decompiler.dart`) dual-reads `@`-prefixed and undeclared legacy bare `catalogId`, `metadata`, and `checks`; and `MessageReader` (`lib/src/utils/message_reader.dart`) and `RendererState` (`lib/src/utils/renderer_state.dart`) accept `@catalogId` alongside legacy bare `catalogId` during validation and surface tracking.

## **Validation & Execution Recipes**

- **Test execution**: Run `dart test` to execute unit and conformance test suites.
- **Linting check**: Run `dart analyze --fatal-infos` to verify zero analyzer issues.
- **Formatting**: Format source files with `dart format .`.

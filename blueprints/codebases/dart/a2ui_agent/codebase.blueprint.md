---
codebase_path: dart/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: a641e84f2861d1ff068df7616e06d08bfd4d0a88
implemented_features:
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
- **Parser & Streaming Layer**: `Parser`, `BlockLexer`, `ResponsePart`, and `ResponseStream` (`lib/src/parser/`) tokenize sentinel-wrapped model responses and support incremental Direct JSON streaming.
- **Express Compiler & Decompiler**: `ExpressCompiler` and `ExpressDecompiler` (`lib/src/inference_formats/express/`) compile A2UI Express DSL scopes into protocol messages and decompile messages back into Express syntax using an ANTLR-generated parser (`generated/`).
- **Processor Facades & Catalog Negotiation**: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`, `CatalogProvider`, `readRendererCapabilities` (with `a2uiClientCapabilitiesKey` and `a2uiRendererCapabilitiesKey` in `lib/src/utils/renderer_capabilities.dart`), `resolveCatalogs`, and `RendererState` (`lib/src/processor/`, `lib/src/utils/`) manage capability extraction and negotiation, pruning transformers (`lib/src/catalog_transformers/`), and multi-catalog surface validation against `a2ui_core`.

## **Local Technical Decisions & Overrides**

- **Protocol Version Selection from Active Catalogs**: Emitted message envelopes take their protocol version from the active `Catalog` instances negotiated for the request rather than a hardcoded default.
- **Skill API in Dart terms**: `Skill` is immutable, including `metadata`. `SkillSet` takes an `Iterable<Skill>` rather than a filename-keyed map, so a key always equals its skill's `filename`; it exposes the skills as an unmodifiable `skills` map and serializes with `toMap()`. `generateCatalogInstructions` and `generateExamples` take no `include_schema` or `validate` flag, since nothing in the package uses them. The frontmatter writer follows PyYAML's quoting and its line wrapping at column 80, which `agent/skill.yaml` checks.
- **Skill export without `dart:io`**: `SkillSet.exportToDirectory` writes through a conditional import (`skill_files_io.dart`), so the package still compiles for the web, where the export throws `UnsupportedError`.
- **ANTLR-Generated Express Grammar**: The Express lexer and parser under `lib/src/inference_formats/express/generated/` are generated from the canonical `specification/inference_formats/express/Express.g4` grammar.

## **Validation & Execution Recipes**

- **Test execution**: Run `dart test` to execute unit and conformance test suites.
- **Linting check**: Run `dart analyze --fatal-infos` to verify zero analyzer issues.
- **Formatting**: Format source files with `dart format .`.

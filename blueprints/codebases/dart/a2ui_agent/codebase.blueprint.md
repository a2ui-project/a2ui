---
codebase_path: dart/a2ui_agent
associated_module: a2ui_agent
module_blueprint_commit: ccf5dc20d0b0ed041b03e3913d807420ff45e178
implemented_features: {}
local_development:
  test_command: 'dart test'
  lint_command: 'dart analyze --fatal-infos'
  format_command: 'dart format .'
---

# **Dart Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Dart implementation of the A2UI Agent SDK (`a2ui_agent`), targeting A2UI protocols v0.9 and v1.0 across Direct JSON and Express inference formats.

- **Inference Formats & Prompt Generation**: Implements `InferenceFormat` and `PromptGenerator` (`lib/src/inference_format.dart`, `lib/src/prompt/generator.dart`) with concrete strategies for Direct JSON (`lib/src/inference_formats/direct_json/`) and Express (`lib/src/inference_formats/express/`).
- **Parser & Streaming Layer**: `Parser`, `BlockLexer`, `ResponsePart`, and `ResponseStream` (`lib/src/parser/`) tokenize sentinel-wrapped model responses and support incremental Direct JSON streaming.
- **Express Compiler & Decompiler**: `ExpressCompiler` and `ExpressDecompiler` (`lib/src/inference_formats/express/`) compile A2UI Express DSL scopes into protocol messages and decompile messages back into Express syntax using an ANTLR-generated parser (`generated/`).
- **Processor Facades & Catalog Negotiation**: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`, `CatalogProvider`, and `RendererState` (`lib/src/processor/`, `lib/src/utils/`) manage capability negotiation, pruning transformers (`lib/src/catalog_transformers/`), and multi-catalog surface validation against `a2ui_core`.

## **Local Technical Decisions & Overrides**

- **Protocol Version Selection from Active Catalogs**: Emitted message envelopes take their protocol version from the active `Catalog` instances negotiated for the request rather than a hardcoded default.
- **ANTLR-Generated Express Grammar**: The Express lexer and parser under `lib/src/inference_formats/express/generated/` are generated from the canonical `specification/inference_formats/express/Express.g4` grammar.

## **Validation & Execution Recipes**

- **Test execution**: Run `dart test` to execute unit and conformance test suites.
- **Linting check**: Run `dart analyze --fatal-infos` to verify zero analyzer issues.
- **Formatting**: Format source files with `dart format .`.

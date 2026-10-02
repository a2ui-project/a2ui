# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## Unreleased

- Exclude `accessibility` and `weight` common properties from Express positional component properties.

## 0.0.1-wip005

- Declared the rest of the agent SDK blueprint API for protocol v0.9. These
  parts are stubs that throw `UnimplementedError`:
  - `CatalogProvider`, `FileSystemCatalogProvider`, `InMemoryCatalogProvider`
    and `CatalogConfig.fromPath`.
  - The direct JSON format: `DirectJsonFormatFactory`, `DirectJsonFormat`,
    `DirectJsonPromptGenerator` and `DirectJsonParser`. The factory takes
    `allowedMessages` and `progressiveKeys` and passes them to each format it
    creates.
  - Express decompilation, and prompt examples in the Express prompt.
  - Inline catalogs in `resolveCatalogs`.
- Added `CatalogTransformer`, `ComponentPruningTransformer`,
  `FunctionPruningTransformer` and `CatalogConfig.transformers`.
- Added `resolveCatalogs`, which `A2uiGenerator.createProcessor` now uses. The
  active catalogs are the transformed ones.
- Added `examples` to `A2uiGenerator`, `A2uiRequestProcessor`,
  `ExpressPromptGenerator` and `InferenceFormatFactory.createFormat`. A
  processor checks each example against its active catalogs when it is
  created.
- `A2uiGenerator.createProcessor` takes an `inferenceFormatFactory` that
  overrides the generator's.
- `Parser` has new members: `hasFormatContent`, `wrap`, `decompile`,
  `supportsStreaming` and `parseChunk`. The Express parser implements
  `hasFormatContent` and `wrap`.
- Breaking: `A2uiGenerator.inferenceFormatFactory` and
  `A2uiRequestProcessor.formatFactory` default to `DirectJsonFormatFactory`
  instead of being required, as in the blueprint.
- Breaking: custom `Parser` subclasses must implement the new abstract
  members.

## 0.0.1-wip004

- Implement full Express format compiler, parser, syntax lexer, and prompt generator for protocol v0.9:
  - `ExpressCompiler`: Compiles Express blocks (`components`, `updateComponents`, `dataModel`, `updateDataModel`, `deleteSurface`) into canonical A2UI v0.9 message payloads.
  - `ExpressParser`: Parses streaming LLM output into structured `ResponsePart` chunks (`TextBlock`, `ExpressBlock`), validating message boundaries and syntax.
  - `ExpressPromptGenerator` / `A2uiRequestProcessor.promptSnippet`: Dynamically generates system prompt instructions describing Express syntax, active catalog components, functions, and positional signatures.
  - `ExpressSyntax`: Grammar, token definitions, keywords, and AST representation for Express blocks.
- Add shared conformance test harness integration running cross-language `conformance/agent/express` test suites (`express_conformance_test.dart`).
- Add end-to-end integration test runner in `e2e_test/` targeting Gemini models (`gemini-3.6-flash`).
- Bump dependency on `a2ui_core` to `^0.2.2`.

## 0.0.1-wip003

- Added the initial API scaffolding for one agent turn in the Express format, limited
  to protocol v0.9: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `InferenceFormatFactory`, `ExpressFormatFactory` and the `ResponsePart`
  types.
- `InferenceFormatFactory.createFormat` binds a format to the active catalogs
  as an `InferenceFormat`, which provides a `PromptGenerator` and a `Parser`.
- Removed the placeholder `Awesome` class.

## 0.0.1-wip002

- Requires `a2ui_core` `^0.2.0`, which takes two type parameters on `Catalog`.
- Dropped an unnecessary `library;` directive.

## 0.0.1-wip001

- Initial version.

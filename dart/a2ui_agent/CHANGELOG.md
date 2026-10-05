# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## Unreleased

- The Direct JSON message reader and the Express decompiler continue to
  reject a `createSurface` message without a `catalogId` with
  `A2uiValidationError`. The check moved into the agent SDK now that
  `a2ui_core` makes the field optional for v1.0; previously `a2ui_core`
  rejected the message during parsing.

## 0.0.1-wip005

- Catalogs are typed `CatalogApi`, the new name of `a2ui_core`'s
  `SchemaCatalog`.
- Implemented the rest of the agent SDK blueprint API for protocol v0.9:
  - `CatalogProvider`, `FileSystemCatalogProvider`, `InMemoryCatalogProvider`
    and `CatalogConfig.fromPath`. A document's id and version are settled with
    the provider's; on the web, `FileSystemCatalogProvider` cannot read files.
  - The direct JSON format: `DirectJsonFormatFactory`, `DirectJsonFormat`,
    `DirectJsonPromptGenerator` and `DirectJsonParser`. The prompt carries the
    v0.9 message schema pruned to `allowedMessages`, the common types and the
    catalogs. `parseChunk` emits each message once it reads and satisfies the
    catalogs, healing `progressiveKeys` while their values stream.
  - Express decompilation, through `Parser.decompile`, and prompt examples
    in the Express prompt.
  - Inline catalogs in `resolveCatalogs`, when `acceptsInlineCatalogs` is
    true. An inline catalog whose id is already active is dropped.
- Added `CatalogTransformer`, `ComponentPruningTransformer`,
  `FunctionPruningTransformer` and `CatalogConfig.transformers`.
- Added `resolveCatalogs`, which `A2uiGenerator.createProcessor` now uses. The
  active catalogs are the transformed ones. Renderer capabilities of null,
  for a request that carries none, activate every registered catalog.
- Added `allowedMessages` to `ExpressFormatFactory`. The Express prompt
  describes only the statements that compile to the allowed message types.
- Added `examples` to `A2uiGenerator`, `A2uiRequestProcessor`,
  `ExpressPromptGenerator` and `InferenceFormatFactory.createFormat`. A
  processor checks each example against its active catalogs when it is
  created, and renders its prompt then, so an example the format cannot
  write fails there.
- `A2uiGenerator.createProcessor` takes an `inferenceFormatFactory` that
  overrides the generator's.
- `Parser` has new members: `hasFormatContent`, `wrap`, `decompile`,
  `supportsStreaming` and `parseChunk`. Only the direct JSON parser
  implements `parseChunk`.
- The Express compiler reads a block that assigns components but no `root`
  as an update of a surface created earlier, and compiles it to
  `updateComponents` alone.
- A payload whose `createSurface` names an inactive catalog is an
  `A2uiValidationError` rather than an `A2uiCatalogError`.
- The Express syntax rules no longer show `Card(...)`, so a pruned `Card`
  never reaches the prompt.
- Breaking: the Express parser reads a direct JSON block (`<a2ui-json>`) as
  text instead of throwing `A2uiParseError`. A parser reads only its own
  format's tags.
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

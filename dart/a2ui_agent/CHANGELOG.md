# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

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

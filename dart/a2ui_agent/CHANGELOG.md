# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## 0.0.1-wip003

- Added the minimal API for one agent turn in the Express format, limited
  to protocol v0.9: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `InferenceFormatFactory`, `ExpressFormatFactory` and the `ResponsePart`
  types.
- `InferenceFormatFactory.createFormat` binds a format to the active catalogs
  as an `InferenceFormat`, which provides a `PromptGenerator` and a `Parser`.
  `A2uiRequestProcessor` works through it rather than through Express
  directly.
- `A2uiRequestProcessor.promptSnippet` describes the Express syntax and the
  active catalogs' components and functions as positional signatures.
- `A2uiRequestProcessor.parseResponse` compiles each Express block into v0.9
  messages and checks them with `a2ui_core`'s `MessageProcessor`, the way a
  renderer would.
- Removed the placeholder `Awesome` class.

## 0.0.1-wip002

- Requires `a2ui_core` `^0.2.0`, which takes two type parameters on `Catalog`.
- Dropped an unnecessary `library;` directive.

## 0.0.1-wip001

- Initial version.

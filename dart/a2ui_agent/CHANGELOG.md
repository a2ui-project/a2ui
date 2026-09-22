# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## 0.0.1-wip003

- Defined the minimal API for one agent turn in the Express format, limited
  to protocol v0.9: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `InferenceFormatFactory`, `ExpressFormatFactory` and the `ResponsePart`
  types. Prompt generation and response parsing are not implemented yet.
- Removed the placeholder `Awesome` class.

## 0.0.1-wip002

- Requires `a2ui_core` `^0.2.0`, which takes two type parameters on `Catalog`.
- Dropped an unnecessary `library;` directive.

## 0.0.1-wip001

- Initial version.

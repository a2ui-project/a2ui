# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## 0.0.2-wip001

- Defined the agent SDK API surface described by the a2ui_agent blueprint,
  limited to protocol v0.9: `A2uiGenerator`, `A2uiRequestProcessor`,
  `CatalogConfig`, `FileSystemCatalogProvider`, `InMemoryCatalogProvider`,
  `CatalogTransformer` with component and function pruning, `PromptGenerator`,
  `Parser` with `TextPart`, `RawA2uiPart` and `A2uiPart`, `InferenceFormat` and
  `InferenceFormatFactory`, and the DIRECT_JSON and EXPRESS formats.
- Catalog loading, catalog transformers, format wiring, response parts and
  `Parser.parseResponse` are implemented. Prompt generation, response parsing,
  streaming, capability negotiation and the EXPRESS format throw
  `UnimplementedError`; the tests that describe them are marked `skip:` with the
  reason.

## 0.0.1-wip001

- Initial version.

# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## 0.0.2-wip001

- The agent SDK types are no longer generic over the catalog's component and
  function types. `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `CatalogProvider`, `InferenceFormat`, `PromptGenerator`, the DIRECT_JSON and
  EXPRESS types and `resolveCatalogs` work over `SchemaCatalog`; a catalog of
  any shape is assignable, because `Catalog` is covariant in both parameters.
  `CatalogTransformer.transform` is generic as a method, so it still returns a
  catalog of the type it was given.
- The inference format factory is a required parameter of `A2uiGenerator` and
  `A2uiRequestProcessor` rather than defaulting to DIRECT_JSON.
- `CatalogConfig` carries the `protocolVersion` its catalog is registered for.
  A catalog document is version-agnostic to `a2ui_core`, so the version belongs
  to the registration; it is what `agentCapabilities` groups by. Catalog
  providers keep the version gate, rejecting a document that declares a version
  this SDK does not implement.
- `CatalogValidators` holds one `PayloadValidator` per active catalog and
  resolves them by catalog id, replacing the multi-catalog validator that
  `a2ui_core` scoped down to a single catalog.
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

## 0.0.1-wip002

- Requires `a2ui_core` `^0.2.0`, which takes two type parameters on `Catalog`.
- Dropped an unnecessary `library;` directive.

## 0.0.1-wip001

- Initial version.

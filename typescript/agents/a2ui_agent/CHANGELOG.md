## Unreleased

- `ComponentPruningTransformer` and `FunctionPruningTransformer` now accept `null` for `allowedComponents` and `allowedFunctions` to prune all components or functions from a catalog, matching `[]` ([#3242](https://github.com/a2ui-project/a2ui/pull/3242)).
- **BREAKING**: `resolveCatalogs` and `A2uiGenerator.createProcessor` now accept the version-keyed renderer capabilities object sent by renderers (such as `{"v1.0": {"supportedCatalogIds": [...]}}`) directly without requiring callers to unwrap the version entry first, and throw `A2uiValidationError` when capabilities omit an entry for the registered catalogs' protocol version ([#3134](https://github.com/a2ui-project/a2ui/issues/3134), [#3219](https://github.com/a2ui-project/a2ui/issues/3219), [#3266](https://github.com/a2ui-project/a2ui/pull/3266)). Single unkeyed `RendererCapabilities` entries remain supported.
- **BREAKING**: `DirectJsonParser.unwrap` and `parseResponse` now return `[]` for an empty model response, a single text part for a plain-text response without `<a2ui-json>` tags, and the extracted payload for an unclosed `<a2ui-json>` block instead of throwing `ParseError`. Passing an empty string directly to `DirectJsonParser.compile` now throws `ParseError` ([#3314](https://github.com/a2ui-project/a2ui/pull/3314)).

## 0.0.1

- Initial release of `@a2ui/agent` ([#2814](https://github.com/a2ui-project/a2ui/pull/2814), [#2916](https://github.com/a2ui-project/a2ui/pull/2916), [#2815](https://github.com/a2ui-project/a2ui/pull/2815)):
  - Support for A2UI protocol versions v0.9 and v1.0.
  - Direct JSON and Express inference formats (prompt generation, streaming/batch parsing, compilation, and decompilation).

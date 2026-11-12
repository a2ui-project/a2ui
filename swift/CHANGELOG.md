# Changelog

## Unreleased

- **BREAKING CHANGE**: Enforce object-level (`anyOf`, `additionalProperties: false`) and
  array-level (`minItems`, `maxItems`, `prefixItems`) JSON Schema constraints on function arguments
  containing dynamic bindings in `PayloadValidator`, validate declared `returnType` values on nested
  function calls against the catalog function definition on pre-1.0 surfaces, disallow undeclared
  arguments across all `BasicCatalog` functions, and enforce RFC 3986 scheme-prefixed URI syntax on
  `openUrl.args.url`. Recommended migration: remove undeclared function arguments, supply at least
  one bound on `length` and `numeric`, pass a scheme-prefixed URI to `openUrl.url`, and match or
  omit `returnType` on nested function calls.
  [#4173](https://github.com/a2ui-project/a2ui/issues/4173),
  [#4187](https://github.com/a2ui-project/a2ui/pull/4187)
- Report the component definition ID rather than the synthesized `:index` instance ID as
  `sourceComponentID` on actions dispatched from template-expanded components.
  [#4043](https://github.com/a2ui-project/a2ui/pull/4043)
- Deprecate `A2UICatalogsKey`, `A2UIDefaultCatalogIDKey`, and `A2UIThemeKey` in `A2UISwiftUI` in
  favor of `EnvironmentValues.a2uiCatalogs`, `EnvironmentValues.a2uiDefaultCatalogID`, and
  `EnvironmentValues.a2uiTheme`, and update `BasicCatalogSwiftUI` components (`A2UIIcon` and
  `A2UIChoicePicker` Dynamic Type scaling, multi-line `TextField(axis: .vertical)` for `longText`
  `A2UITextField`, and SVG path parsing improvements in `SVGPathParser` / `SVGPathShape`).
  [#4023](https://github.com/a2ui-project/a2ui/pull/4023)

## 0.10.0

- Initial release of the A2UI Swift SDK for iOS 17+ and macOS 14+, supporting protocol versions
  v0.9, v0.9.1, and v1.0:
  - `A2UISwiftCore` (`A2UICore`, `A2UIJSON`): stateful message processor, surface and data models,
    JSON pointer bindings, schema validation, and bidirectional function calls.
  - `BasicCatalog`: component schemas and standard functions for the A2UI Basic Catalog.
  - `A2UISwiftUI` and `BasicCatalogSwiftUI`: declarative SwiftUI `Surface` rendering adapter and
    Basic Catalog component views.

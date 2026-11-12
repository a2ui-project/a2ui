# Changelog

## Unreleased

- Report the component definition ID rather than the synthesized `:index` instance ID as
  `sourceComponentID` on actions dispatched from template-expanded components.
  [#4043](https://github.com/a2ui-project/a2ui/pull/4043)
- Deprecate `A2UICatalogsKey`, `A2UIDefaultCatalogIDKey`, and `A2UIThemeKey` in `A2UISwiftUI` in
  favor of `EnvironmentValues.a2uiCatalogs`, `EnvironmentValues.a2uiDefaultCatalogID`, and
  `EnvironmentValues.a2uiTheme`, and update `BasicCatalogSwiftUI` components (`A2UIIcon` and
  `A2UIChoicePicker` Dynamic Type scaling, multi-line `TextField(axis: .vertical)` for `longText`
  `A2UITextField`, and SVG path parsing improvements in `SVGPathParser` / `SVGPathShape`).
  [#4023](https://github.com/a2ui-project/a2ui/pull/4023)
- Send the message of an error thrown by a renderer function in the `rendererFunctionResponse`
  error, falling back to the generic execution-error text only when that message is empty.
  [#4105](https://github.com/a2ui-project/a2ui/pull/4105)
- Announce visible text changes in `live` regions: a live component or container now announces its
  explicit `label` followed by the text its subtree reports with the new `.a2uiAccessibleText(_:)`
  modifier (collected through `A2UIAccessibleTextKey`). `A2UIText` reports its text without
  Markdown syntax, and custom components that render text can call the modifier too.
  [#4021](https://github.com/a2ui-project/a2ui/pull/4021)

## 0.10.0

- Initial release of the A2UI Swift SDK for iOS 17+ and macOS 14+, supporting protocol versions
  v0.9, v0.9.1, and v1.0:
  - `A2UISwiftCore` (`A2UICore`, `A2UIJSON`): stateful message processor, surface and data models,
    JSON pointer bindings, schema validation, and bidirectional function calls.
  - `BasicCatalog`: component schemas and standard functions for the A2UI Basic Catalog.
  - `A2UISwiftUI` and `BasicCatalogSwiftUI`: declarative SwiftUI `Surface` rendering adapter and
    Basic Catalog component views.

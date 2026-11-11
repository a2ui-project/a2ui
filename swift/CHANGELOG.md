# Changelog

## Unreleased

- Report the component definition ID rather than the synthesized `:index` instance ID as
  `sourceComponentID` on actions dispatched from template-expanded components.
  [#4043](https://github.com/a2ui-project/a2ui/pull/4043)

## 0.10.0

- Initial release of the A2UI Swift SDK for iOS 17+ and macOS 14+, supporting protocol versions
  v0.9, v0.9.1, and v1.0:
  - `A2UISwiftCore` (`A2UICore`, `A2UIJSON`): stateful message processor, surface and data models,
    JSON pointer bindings, schema validation, and bidirectional function calls.
  - `BasicCatalog`: component schemas and standard functions for the A2UI Basic Catalog.
  - `A2UISwiftUI` and `BasicCatalogSwiftUI`: declarative SwiftUI `Surface` rendering adapter and
    Basic Catalog component views.

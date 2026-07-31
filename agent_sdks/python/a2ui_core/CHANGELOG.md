## Unreleased

- Source the arithmetic, comparison and string operator APIs from the generated
  catalog schemas. The hand-written `basic_catalog.operator_apis` module is
  removed; its classes are now generated into `basic_catalog.function_apis` and
  remain re-exported from `a2ui.core.basic_catalog` under the same names, with
  identical argument types — `equals`/`not_equals` keep untyped `a`/`b`
  arguments, matching the `z.any()` contract of the TypeScript implementation,
  so `null` comparisons and exact integer comparisons behave as before (#302).

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1

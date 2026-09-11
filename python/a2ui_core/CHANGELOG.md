## Unreleased

- `Catalog.from_json` accepts a `common_types_schema` argument and rewrites
  cross-document references such as `common_types.json#/$defs/ChildList` into
  local `#/$defs/...` pointers, satisfying them from the supplied document or
  from the built-in definitions. Catalogs that reference the published shared
  types now load without the `specification/` tree on disk, and the validator
  no longer reads schema files at runtime.
- Deleting a list index past the end of the list is now a no-op. It previously
  padded the list with `None` up to that index, so deleting `/items/10` from a
  three-element list produced an eleven-element list.
- The shared type definitions used to satisfy `common_types.json` references
  are now checked against the published document by a test, with an explicit
  list of the definitions that intentionally differ. Descriptions on
  `AccessibilityAttributes`, `DynamicString`, `DynamicNumber` and
  `DynamicBoolean` were brought back into line with the specification.
- The conformance harness now fails, rather than silently skipping, when a
  suite cannot be parsed, when a case has no `name` or `action`, or when an
  action has no handler. Suites the core library cannot run are named in
  `UNRUNNABLE_SUITES` with a reason.

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1

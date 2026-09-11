## Unreleased

- `DataModel` now runs the shared `conformance/core/data_model.yaml` suite,
  alongside the Dart client and `web_core`. It was the only implementation of
  the data model measured solely by its own tests.
- **Writing through a primitive is rejected instead of destroying it.** With
  `/user/name` holding a string, `set('/user/name/first', 'Alice')` replaced
  that string with `{"first": "Alice"}` and reported nothing. The Dart client
  and `web_core` both raise for the same write. Auto-vivification now fills in
  absent and null segments only, and a primitive in the way raises
  `A2uiDataError`.
- Added `A2uiDataError`, the `DataError` category of the shared suite. Writes
  that address a list with a non-numeric segment raised a bare `ValueError`,
  which is outside the `A2uiError` hierarchy consumers catch.
- A trailing slash no longer addresses a child under an empty key: `/foo/` and
  `/foo` are the same path, as they are in the Dart client and `web_core`.
- An observer is only notified when the value it watches actually changes. The
  cascade reaches every ancestor and descendant of the written path, so an
  observer of `/a/b` woke up whenever anything under `/a` moved, and rewriting
  a value with itself notified everyone.

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1

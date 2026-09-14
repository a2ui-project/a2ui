## Unreleased

- The v0.9 and v1.0 basic catalogs no longer register `add`, `subtract`, `multiply`,
  `divide`, `equals`, `not_equals`, `greater_than`, `less_than`, `contains`,
  `starts_with` or `ends_with`. The published catalogs declare exactly 14
  functions, and none of these operators is among them, so an agent had no way to know
  they were callable. `a2ui.core.basic_catalog` no longer exports their
  API classes or implementations, aligning Python engine behavior with the
  reference typescript implementation.

- The v1.0 `formatDate` `ISO` pattern now returns the UTC instant with exactly
  three fractional digits, as `web_core` does. It previously echoed back
  whichever offset the input carried, so `2025-01-01T12:00:00+02:00` formatted
  as itself instead of `2025-01-01T10:00:00.000Z`. A timestamp without an
  offset is read as UTC, so the result no longer depends on the host time zone.

- The v1.0 `pluralize` function now falls back to the `other` form only when
  the selected category is absent, not when its value is empty. A caller that
  supplies `zero: ""` gets an empty string, matching `web_core`; previously the
  empty form was discarded and the `other` form rendered in its place.

- `ExpressionParser.MAX_DEPTH` is 100, up from 10, matching `web_core` and the
  Swift engine. An expression nested between 11 and 100 levels deep was
  rejected here and accepted there.

- A function-call argument now counts toward the expression parser's recursion
  depth, as it does in `web_core`. Only nested interpolations were counted
  before, so `${f(a: ${f(a: ...)})}` written as `${f(a: f(a: ...))}` recursed
  unchecked and raised `RecursionError` from the interpreter rather than a
  parse error.

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

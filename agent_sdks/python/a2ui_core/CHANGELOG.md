## Unreleased

- Negative and exponent number literals are now parsed as numbers. `${-1}` used to
  bind to the path `-1`, because `-` is a valid path character, and
  `${round(value: -1)}` handed the function a path where the author wrote a number.
  Exponents were rejected outright. A number starts only on a digit, or on `-`
  followed by a digit, so `${a-b}` and `${-a}` remain paths. A literal whose
  exponent overflows to infinity is rejected rather than returned (#2575).

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1

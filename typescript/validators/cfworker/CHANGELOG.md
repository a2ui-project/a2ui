# Changelog

## Unreleased

- `format` is an annotation by default, as with the Ajv adapter; pass `{formats: true}` to `createCfWorkerValidator` to assert formats.
- `@cfworker/json-schema` is pinned to 4.1.6: the adapter reads issue params from its error text, and a canary test fails if a new version words it differently.

## 0.1.0

- Initial release.

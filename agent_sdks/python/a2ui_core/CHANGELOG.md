## Unreleased

- Add SemVer parsing and comparison utilities (`SemVer`, `compare_semver`, `is_at_least_version`, `normalize_version_string`, `parse_semver`, `to_canonical_version`, `to_semver`) in `a2ui.core.common.semver`.
- Add `A2uiProtocolVersion` and `ProtocolVersion` enum in `a2ui.core.schema`.
- Remove `A2uiCompileError` from `a2ui_core` exception hierarchy.

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1

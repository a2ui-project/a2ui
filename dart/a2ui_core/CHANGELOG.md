# [a2ui_core](https://pub.dev/packages/a2ui_core) Changelog

## 0.2.0

- **Breaking:** `Catalog` now takes two type parameters,
  `Catalog<C extends ComponentApi, F extends FunctionApi>`, so that agents can
  hold catalogs whose functions declare a signature without an implementation.
  Renderers use `Catalog<C, FunctionImplementation>`.
- Added `A2uiProtocolVersion`, which gates every entry point on protocol v0.9
  and rejects payloads that declare another version or omit it.
- Added `Catalog.fromJson`, `Catalog.catalogSchema` and `Catalog.copyWith`, plus
  the schema-only `CatalogComponent` and `CatalogFunction` and the
  `SchemaCatalog` alias, so catalog documents round trip through the core layer.
  A pruned catalog renders a pruned document, with the `$defs/anyComponent` and
  `$defs/anyFunction` unions narrowed to match.
- Added `A2uiRendererCapabilities` and `A2uiVersionCapabilities`, mirroring
  `client_capabilities.json` and the `web_core` client capability types.
- Added `A2uiValidator`, which parses payload envelopes and gates them on the
  supported protocol version. Structural and catalog schema checks are declared
  but not implemented yet.
- Added the `A2uiParseError`, `A2uiCompileError`, `A2uiCatalogError`,
  `A2uiIntegrityError` and `A2uiRecursionError` categories.
- Fixed `DataModel.set` silently dropping a write whose parent path resolves to
  a primitive; it now throws `A2uiDataError`.
- **Behaviour change:** `DataModel` observers no longer fire when a write leaves
  their own value unchanged. Notifications previously bypassed the signal's
  equality check, so an observer on a path merely related to the write was woken
  even when nothing it observes had changed. Containers are now handed to the
  signal as a copy, so a container mutated in place still compares unequal and
  still notifies, while unchanged primitive and absent values no longer do. This
  matches the `web_core` renderer, and the shared behaviour is pinned by
  `conformance/core/data_model.yaml`.

## 0.1.1

- The source code is moved from genui repo to a2ui repo.

## 0.1.0

- Initial version.

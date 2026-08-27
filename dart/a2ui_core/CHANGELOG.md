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
- Added `A2uiValidator`, which validates a payload in three stages:
  `parseMessages` gates envelopes on the supported protocol version,
  `validateStructure` checks the component graph, and `validateAgainstCatalogs`
  checks each component against its catalog's schema. A payload that creates a
  surface is treated as a full render, so it must declare a `root` component,
  resolve every reference and leave nothing unreachable; a payload that only
  updates components is incremental, so it may reference components the client
  already holds, while duplicate ids, self-references and cycles still fail.
  Which properties reference other components is read from the catalog schema,
  through either the `$ref` pointers a catalog document uses or the `REF:`
  description pointers a catalog built in Dart carries.
- Added `A2uiValidator.commonTypesSchema`. Catalogs reference
  `common_types.json` for their shared definitions; supplying it lets those
  definitions be enforced. A reference this SDK cannot resolve is treated as
  unconstrained rather than fetched, so validation never performs I/O.
- `A2uiValidator` is exercised by the shared `conformance/core/validator.yaml`
  suite. All 20 of its v0.9 cases pass; the 25 v0.8 cases are skipped with a
  reason, as this SDK implements v0.9 only.
- **Behaviour change:** `A2uiMessage.fromJson` now throws
  `A2uiValidationError` for a message body that is not an object, a missing
  required field, or a field of the wrong type. It previously let those fail
  as a `TypeError`, which is an `Error` rather than an `Exception` and so was
  not catchable as a payload defect.
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

# [a2ui_core](https://pub.dev/packages/a2ui_core) Changelog

## 0.2.0

- **Breaking:** `MessageProcessor` validates messages as it processes them.
  A message that does not match its catalog now throws instead of being
  applied. Added `processPayload` and an optional `validator` constructor
  parameter.
- **Breaking:** `MessageProcessor` checks each batch of components as a graph
  against the surface it joins, so duplicate ids, references naming no
  component, cycles and over-deep chains now throw. References resolve against
  the components the surface already holds, so an incremental update that
  names a component arriving in a later message is rejected where it was
  previously applied.
- **Breaking:** `Catalog` now takes two type parameters,
  `Catalog<C extends ComponentApi, F extends FunctionApi>`.
- **Breaking:** `ComponentApi` and `FunctionApi` are concrete classes with
  generative constructors, and `FunctionImplementation` forwards to
  `FunctionApi`'s. Subclasses of all three pass `name`, `schema` or
  `argumentSchema`, and `returnType` to `super` rather than overriding
  getters.
- **Behaviour change:** `A2uiMessage.fromJson` throws `A2uiValidationError`
  rather than `TypeError` for a malformed message body.
- **Behaviour change:** `DataModel` observers no longer fire when a write
  leaves their own value unchanged.
- Added `A2uiProtocolVersion`. Every entry point accepts protocol v0.9 only.
- Added `Catalog.fromJson`, `Catalog.catalogSchema` and `Catalog.copyWith`, plus
  the `SchemaCatalog` alias for `Catalog<ComponentApi, FunctionApi>`.
- `Catalog` carries the document's `$id`, `title` and `description` as
  `schemaId`, `title` and `description`, and `catalogSchema` emits them along
  with `$schema`, so a catalog document round trips with its identity intact.
- The shared `conformance/core/catalog.yaml` suite gains a `catalog_schema`
  action, exercised by `test/conformance/catalog_schema_conformance_test.dart`.
- Added `A2uiRendererCapabilities` and `A2uiVersionCapabilities`.
- Added `A2uiValidator`, which validates a payload in three synchronous
  stages, and `A2uiValidator.commonTypesSchema`.
- `A2uiValidator.validate`, `validateStructure` and `validateAgainstCatalogs`
  take an optional `surfaceCatalogs` map naming the catalog each surface uses.
  A payload that only updates a surface carries no catalog id, so without it a
  validator holding several catalogs now throws `A2uiCatalogError` where it
  previously skipped those components and reported the payload valid.
- The package now publishes the specification's `common_types.json` as
  `A2uiValidator.commonTypesFor`, and `commonTypesSchema` defaults to it, so
  the shared types are checked without the caller supplying the document.
- Added the `A2uiParseError`, `A2uiCompileError`, `A2uiCatalogError`,
  `A2uiIntegrityError` and `A2uiRecursionError` categories.
- Fixed `DataModel.set` silently dropping a write whose parent path resolves to
  a primitive; it now throws `A2uiDataError`.
- `A2uiValidator` and `DataModel` are exercised by the shared
  `conformance/core/validator.yaml` and `conformance/core/data_model.yaml`
  suites.

## 0.1.1

- The source code is moved from genui repo to a2ui repo.

## 0.1.0

- Initial version.

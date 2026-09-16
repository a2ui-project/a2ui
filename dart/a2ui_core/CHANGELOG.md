# [a2ui_core](https://pub.dev/packages/a2ui_core) Changelog

## 0.2.0

- **Breaking:** `MessageProcessor.processMessages` validates messages as it
  processes them, and is the single entry point for validation as well as for
  processing. A message that does not match its catalog now throws instead of
  being applied. Added the required `protocolVersion` constructor parameter
  and `commonTypesSchema`, which configure the validators it builds. It keeps
  one validator per catalog, reachable through `validatorFor`, resolves the
  catalog for each item through `catalogFor`, and checks each component
  against the catalog it resolves to rather than against every catalog the
  processor supports.
- **Breaking:** `MessageProcessor.processMessages` checks every surface the
  payload creates as one graph once the payload has been applied: a `root`
  component exists, every reference resolves, and every component is reachable
  from the root. These three cannot be checked as each message arrives,
  because a payload may declare a parent before its child, so they answer for
  the surface the payload leaves behind. A surface the payload only updates is
  an incremental update to a render it does not own, and is not checked that
  way.
- **Breaking:** Added `ValidationConfig`, with `allowOrphanComponents`,
  `allowDanglingReferences` and `allowMissingRoot`, and the `strict` and
  `relaxed` presets. `MessageProcessor` takes one, defaulting to `strict`. A
  caller whose transport delivers one surface across several payloads relaxes
  the checks that span them; a caller that receives a whole render in one
  payload leaves them on. Everything else stays unconditional: the catalog
  schema, duplicate ids, self-references, cycles, depth and data-model paths
  are not waiting on a later message.
- **Breaking:** `A2uiMessage` is renamed `AgentToRendererMessage`, the name the
  `a2ui_core` blueprint gives the type a payload parses into and
  `MessageProcessor.processMessages` accepts. It says which direction the
  message travels, which the old name left open: the renderer-to-agent
  direction is reported through `A2uiClientAction` and `A2uiClientError`, which
  are not messages of this type.
- **Breaking:** Envelope parsing moved to `AgentToRendererMessage.parseAll`, from
  `PayloadValidator.parseMessages`. Parsing needs no catalog, so it belongs to
  the message model rather than to a validator.
- An invalid number literal in an expression, such as `${1.2.3}`, now throws
  `A2uiExpressionError` instead of a `FormatException` from `num.parse` — an error
  outside the `A2uiError` hierarchy that `avoid_catching_errors` discourages catching.
  The accepted shape is stated in the parser rather than inherited from the platform's
  number parser, so every implementation accepts the same literals.
- The expression parser now runs the shared conformance suite at
  `conformance/core/expressions.yaml`, alongside the TypeScript client.
- The expression parser's nesting limit is now enforced. The depth guard sat in
  `parse()`, which is only entered at depth 0, so neither nested interpolations nor
  function-call arguments were ever counted: a deeply nested template recursed until
  the stack overflowed, raising `StackOverflowError` rather than the intended
  `A2uiExpressionError`. The limit is also raised from 10 to 100, matching web_core.
- **Breaking:** `MessageProcessor` checks each batch of components as a graph
  against the surface it joins, so duplicate ids, cycles and over-deep chains
  now throw. Whether a reference resolves is not checked there: a payload may
  declare a parent before its child, as the basic catalog's `00_incremental`
  example does, so references are resolved once the payload that created the
  surface has been applied in full.
- **Breaking:** `Catalog` now takes two type parameters,
  `Catalog<C extends ComponentApi, F extends FunctionApi>`.
- **Breaking:** `ComponentApi` and `FunctionApi` are concrete classes with
  generative constructors, and `FunctionImplementation` forwards to
  `FunctionApi`'s. Subclasses of all three pass `name`, `schema` or
  `argumentSchema`, and `returnType` to `super` rather than overriding
  getters.
- **Behaviour change:** `AgentToRendererMessage.fromJson` throws `A2uiValidationError`
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
- Added `PayloadValidator`, which checks one component, one function call or
  one theme against one catalog, through `validateComponent`,
  `validateFunction` and `validateTheme`. It is scoped to a single `catalog`,
  since a component belongs to exactly one, and it takes a required
  `protocolVersion`.
- Deciding which catalog an item belongs to is `MessageProcessor`'s job, not
  the validator's. From v1.0 one surface may mix catalogs — a component or
  function call may carry a `catalogId` overriding the surface-level default —
  so the catalog is resolved per item, in the order: the item's own
  `catalogId`, the surface's default, then the sole supported catalog.
  `A2uiCatalogError` is thrown when none of those settles it, or when the
  resolved id is not one the processor supports.
- Added `PayloadValidator.parseMessages`, a static that checks envelopes
  without a catalog, so a payload can be parsed before each message is matched
  to a surface.
- The package now publishes the specification's `common_types.json` as
  `PayloadValidator.commonTypesFor`, and `commonTypesSchema` defaults to it, so
  the shared types are checked without the caller supplying the document.
- Added the `A2uiParseError`, `A2uiCompileError`, `A2uiCatalogError`,
  `A2uiIntegrityError` and `A2uiRecursionError` categories.
- Fixed `DataModel.set` silently dropping a write whose parent path resolves to
  a primitive; it now throws `A2uiDataError`.
- **Behaviour change:** `MessageProcessor` throws `A2uiCatalogError` rather
  than `A2uiStateError` for a `createSurface` naming a catalog it does not
  support, which is what the blueprint's validation matrix calls for.
- `MessageProcessor` and `DataModel` are exercised by the shared
  `conformance/core/validator.yaml` and `conformance/core/data_model.yaml`
  suites.

## 0.1.1

- The source code is moved from genui repo to a2ui repo.

## 0.1.0

- Initial version.

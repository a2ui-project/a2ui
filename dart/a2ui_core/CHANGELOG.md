# [a2ui_core](https://pub.dev/packages/a2ui_core) Changelog

## Unreleased

- `DataContext` adds `parent`, `index`, `childContext(path, {index})`, and
  `subscribeDynamicValue`, which returns a `DataSubscription`. `nested` now
  returns a child context linked to its parent. In v1.0 contexts, the
  `@index` system function returns the enclosing template item's index plus
  an optional `offset`, and throws `A2uiValidationError` outside a collection
  template. Dynamic values nested deeper than `maxDynamicValueDepth` (1000)
  fail with `A2uiExpressionError`. `DataModel` adds `has(path)`.
- `NodeResolver` links each node's data context to its parent node's context
  and gives template children their item index. `ComponentNode.context`
  exposes the node's `ComponentContext` (null for placeholders), which the
  package barrel now exports, and
  `NodeResolver` accepts an optional `catalog:` that must be the surface's
  default catalog. `ChildNode` adds `index` for template-expanded entries.
- **Behavior change:** A data binding to a path missing from the data model
  emits one `MISSING_DATA_BINDING` warning per path on `SurfaceModel.onWarning`.
  `NodeResolver` delivers these after the tree update commits, and
  `ComponentContext` takes an `onMissingData` reporter to override delivery.
- **Behavior change:** `GenericBinder` binds the `accessibility` envelope
  property's `label` and `description` as dynamic strings on every component,
  including components whose schema does not declare `accessibility`.
- **Behavior change:** Template `ChildList`s in v1.0 surfaces bind their
  `path` with the v1.0 `@path` key, so v1.0 templates expand.
- `PayloadValidator` takes its rules from the catalog: `Catalog.protocolVersion`
  (parsed from the document's `protocolVersion`) selects the v1.0 rules for
  v1.0 and later and the v0.9 rules otherwise, and the embedded
  `common_types.json` for that version. `protocolVersion` and
  `commonTypesSchema` become optional overrides, and the validator gains a
  `config`. `MessageProcessor` no longer forces its v0.9 common types onto
  each catalog unless a `commonTypesSchema` is passed. Adds
  `commonTypesForProtocolVersion(A2uiProtocolVersion?)`,
  `ValidationConfig.allowUnknownElements`, `A2uiValidationError.surfaceId`,
  and `ComponentApi.allowedParents` / `allowedChildren`.
- **Breaking:** `Catalog.protocolVersion` is an `A2uiProtocolVersion?` rather
  than a `String?`. `Catalog.fromJson` reads the document's value as a
  semantic version (`1.0`, `v1.0` and `1.0.0` all name v1.0; pre-release and
  build suffixes are ignored) and throws `A2uiCatalogError` for a value it
  cannot parse or a version this SDK does not implement. `catalogSchema`
  writes the version back as the bare form the catalog definition schema
  requires (`1.0`, not `v1.0`). `A2uiProtocolVersion` adds `semverValue` and
  `tryParseSemVer`. `PayloadValidator.commonTypesForProtocolVersion(String?)`
  is removed; `PayloadValidator.commonTypesFor(A2uiProtocolVersion)` is the
  one entry point.
- The package now embeds both `specification/v0_9/json/common_types.json` and
  `specification/v1_0/json/common_types.json`. `CommonSchemas` gains
  `dynamicNumber`, `dynamicStringList`, `dynamicValue`,
  `accessibilityAttributes`, `checkRule` and `componentCommon`, and the new
  `CommonSchemasV1` holds the v1.0 shapes keyed on `@path` and `@call`; its
  `dynamicValue` rejects literal objects with reserved single-`@` keys.
- **Behavior change:** envelope keys (`id`, `component`, `catalogId`, plus
  `accessibility` and `metadata` from v1.0) are stripped from every component,
  and from its schema's requirements, before the schema check. A closed
  (`additionalProperties: false`) schema using `allOf` now validates, and v1.0
  component `metadata` is never rejected for being undeclared; from v1.0,
  `accessibility` and `metadata` are checked against `ComponentCommon`.
- **Behavior change:** composition constraints. `allowedParents` and
  `allowedChildren` in a catalog are enforced by `MessageProcessor`, with the
  surface (`Surface`) as the implicit parent of the surface's root id;
  violations throw `A2uiValidationError` with code `UNALLOWED_PARENT` or
  `UNALLOWED_CHILD`, the `surfaceId`, and a JSON Pointer `path` into the
  message when the offending parent arrived in it.
- **Behavior change:** `validateComponent` checks every nested function call
  against the catalog's schema for it, keyed on `@call` for v1.0 catalogs and
  `call` below that, and rejects calls passing more than 1000 arguments (also
  checked when `DataContext` evaluates a call). For v1.0 catalogs, a call to a
  function the catalog does not declare passes with its arguments unchecked,
  because a renderer forwards it to the agent; below v1.0 it is rejected
  unless `ValidationConfig.allowUnknownElements`.
- **Behavior change:** v1.0 catalogs require UAX #31 identifiers for component
  ids, component and property names, function names and argument names, and
  reject objects with unrecognized single-`@` keys (code
  `INVALID_RESERVED_KEY`); `@@name` remains an escaped literal key.
- **Behavior change:** a `$ref` into a document the SDK holds that names
  nothing now throws `A2uiCatalogError("Unresolvable schema reference:
'<ref>'")` instead of silently leaving the subschema unconstrained, and
  pointers follow array indices (`#/$defs/X/oneOf/0`). A local
  `#/$defs/<Name>` the catalog does not define falls back to
  `common_types.json`. A shared type that only the other protocol version's
  `common_types.json` defines (such as the v1.0 `Child` in a catalog that
  declares no version) resolves against that document; types both versions
  define, such as `DataBinding` and `FunctionCall`, always resolve against
  the catalog's own version, so a v0.9 catalog does not accept `@path` or
  `@call` shapes.
- Validation errors carry JSON Pointer `path`s and per-error `errors` details;
  a dangling reference reports `/components/<index>/children/<n>`.
- Added `MessageProcessor.getRendererCapabilities(CapabilitiesOptions)`,
  which returns an `A2uiRendererCapabilities` with one entry per requested
  version and raises `A2uiValidationError` for an empty version list. Inline
  catalogs use the legacy shape below v1.0 and a copy of the standalone
  catalog schema document from v1.0.
- **Breaking:** `A2uiVersionCapabilities.toJson` takes a required `version`
  and shapes inline catalogs for it; `A2uiRendererCapabilities.toJson` and
  `getRendererCapabilities` use the same code.
- **Behavior change:** Legacy inline catalogs are derived from
  `Catalog.catalogSchema`, so a component's properties and required list
  match the catalog document (which merges `allOf` members). `id` and
  `component` are left to the `ComponentCommon` envelope, bundled common-type
  refs become `common_types.json#/$defs/...` refs again, other local refs are
  inlined when they resolve and dropped otherwise, and function entries carry
  `description`.
- **Breaking:** Removed `MessageProcessor.getClientCapabilities` and
  `getClientDataModel`. Use
  `getRendererCapabilities(CapabilitiesOptions(versions: [A2uiProtocolVersion.v0_9], includeInlineCatalogs: ...)).toJson()`
  and `getRendererDataModel()`.
- **Behavior change:** `getRendererDataModel` takes an optional `version`.
  With one, it returns only the surfaces compatible with that version. Without
  one, it reports the version the surfaces share, defaults to `v1.0` when none
  records a version, and raises `A2uiValidationError` when the surfaces record
  different versions. It returns `Map<String, Object?>?`.
- Added the RPC layer: `RpcHandler` sends `callAgentFunction` messages
  through an `OutboundMessageListener` and settles them from
  `agentFunctionResponse`, and answers `callRendererFunction` with a
  `rendererFunctionResponse`. `CallOptions` sets a call's `functionCallId`,
  `timeout`, envelope `version` and `CancellationSignal`; `ExecutionContext`
  says whether an inbound call runs within a user activation. `RpcErrorCode`
  lists the protocol's codes and `A2uiRpcError` carries one with the
  `functionCallId` and any agent-reported details. An inbound call is refused
  with `INVALID_FUNCTION_CALL` when its catalog or function is missing, the
  catalog's protocol version does not match the message's, the function is
  `rendererOnly`, it requires a user activation the call lacks, or its
  arguments fail the schema; a function that throws answers `EXECUTION_ERROR`.
- `MessageProcessor` owns an `RpcHandler` as `rpc`, takes an
  `outboundListener` (`OutboundMessageListener`) for the messages it sends
  and a `defaultTimeout` for outbound calls, mirrors `callAgentFunction`, and
  adds `dispose`, which cancels pending calls and disposes every surface.
  **Behavior change:** `callRendererFunction` and `agentFunctionResponse`
  messages are now executed rather than ignored. `processMessages` and
  `processMessagesAsync` take `isUserActivated`; the latter completes once
  every `callRendererFunction` in the payload has been answered.
- `FunctionApi` adds `allowedCallers` (`AllowedCallers.rendererOnly`,
  `agentOnly` or `rendererOrAgent`, default `rendererOnly`) and
  `requiresUserActivation`, read by `Catalog.fromJson` from both function
  forms and emitted by `catalogSchema` when they differ from the defaults.
  `BasicFunction` carries them, so `BasicCatalog.v1_0().functions['openUrl']`
  requires a user activation.
- On a v1.0 surface, a function call that no available catalog implements
  (an unknown catalog, no default catalog, or an unknown function; never an
  argument or execution failure) is sent to the agent as `callAgentFunction`
  through the new `SurfaceModel.callAgentFunction` (`AgentFunctionCaller`)
  hook, which `MessageProcessor` wires to its `RpcHandler`. A dynamic value
  resolves to null until the response arrives and then updates; a `checks`
  rule that is waiting is left out of `isValid`, `validationErrors` and
  `validationResults`, and the resolved props gain `validationPending`, true
  while any rule waits. An action awaits the agent's result. An agent error
  or timeout (`A2uiRpcError`) is reported on `SurfaceModel.onError` as
  `EXECUTION_ERROR` with the `functionCallId`, and a non-RPC listener
  exception in a dynamic value or check as `EXPRESSION_ERROR`; the value
  stays null and a waiting rule then fails with its message. v0.9 and v0.9.1
  surfaces keep reporting `EXPRESSION_ERROR`. `A2uiCatalogResolutionError`, a
  subclass of `A2uiCatalogError`, is what `SurfaceModel.resolveCatalog` and
  `Catalog.invoke` throw for such a lookup miss.
- `DataContext` adds `isUserActivated`, `withUserActivation()`,
  `evaluateFunctionCall` (what an action runs: locally when possible,
  otherwise through the agent), `isPendingAgentCall` and
  `resolveListenableWithPending` (returning a signal of `DynamicValueState`),
  and takes `callAgentFunction` (`AgentFunctionCaller`).
  `CatalogInvokerExtension.argumentErrors` returns a function's argument
  schema failures without throwing. **Behavior change:** `Catalog.invoke`
  refuses a function that is `agentOnly`, or one with `requiresUserActivation`
  unless the context is user activated. The binder runs actions with
  `withUserActivation()`, so `openUrl` works from an action and is refused
  from a dynamic value.

- **Breaking:** `MessageProcessor` routes each message through the
  `VersionAdapter` for the version it declares, so one processor holds v0.9,
  v0.9.1 and v1.0 surfaces side by side. The required `protocolVersion`
  parameter and field are replaced by an optional `defaultVersion`, and
  `commonTypesSchema` is nullable: null uses the copy this package publishes
  for each message's version. `validatorFor` takes a required `version`.
- **Breaking:** `processMessages`, `process` and the new
  `processMessagesAsync` take `Object?`: raw decoded JSON (a lone envelope, a
  list of envelopes or the `{messages: [...]}` wrapper) or parsed messages
  (`AgentToRendererMessagePayload`, one `AgentToRendererMessage`, or a list of
  them). Every message is parsed before any is applied.
- **Behavior change:** `createSurface` raises `A2uiCatalogError` when its
  catalog declares a `protocolVersion` incompatible with the message's
  version. A catalog that declares none is pre-v1.0: accepted by a v0.9 or
  v0.9.1 message and rejected by a v1.0 one. `MinimalCatalog` declares `v0.9`.
- **Behavior change:** a v1.0 `createSurface` writes its inline `dataModel` as
  one root write, then applies its inline `components` (checked as one batch
  before the surface is added, so a batch that fails creates nothing).
  Without a `catalogId` it creates a surface with no default catalog; there
  is no fallback to the processor's catalogs. A v0.9 `createSurface` without
  a `catalogId` is rejected, as the v0.9 schema requires one.
- `SurfaceModel.protocolVersion` is the version of the message that created
  the surface, so `DataContext.isV10` follows each surface's own version.
- New `InternalOperation` (`CreateSurfaceOp`, `UpdateComponentsOp`,
  `UpdateDataModelOp`, `DeleteSurfaceOp`, `CallRendererFunctionOp`,
  `AgentFunctionResponseOp`), `VersionAdapter`, `V0_9Adapter` (v0.9 and
  v0.9.1), `V1_0Adapter`, and `VersionAdapterRegistry`, which
  `MessageProcessor` takes as `adapterRegistry`.
- `Catalog` adds `protocolVersion`, read from the document by
  `Catalog.fromJson`, which takes an `A2uiProtocolVersion` fallback for
  documents that declare none. `catalogSchema` emits it and, from `1.0`, names
  functions under `@call` instead of `call`.
- `SurfaceModel` adds `metadata`, from v1.0 `createSurface`.
- **Breaking:** `SurfaceModel.catalog` is replaced by a nullable
  `defaultCatalog`, and the constructor's `catalog:` argument by
  `defaultCatalog:`. `SurfaceModel` adds `availableCatalogs`, `metadata`,
  `onWarning`/`dispatchWarning` (with the new `A2uiWarning`), and
  `resolveCatalog(catalogId)`, which resolves an item's own `catalogId`, then
  the default, and otherwise throws `A2uiCatalogError`. There is no fallback to
  a sole catalog. A catalog whose `protocolVersion` is incompatible with the
  surface's throws `A2uiCatalogError` at construction. A catalog without a
  `protocolVersion` is pre-v1.0: a v0.9 or v0.9.1 surface accepts it and a
  v1.0 or later surface rejects it.
- **Behavior change:** `NodeResolver`, `GenericBinder` and `DataContext`
  resolve components and function calls through `surface.resolveCatalog`, so a
  component or function call naming another catalog's `catalogId` renders or
  runs with that catalog. `FunctionCall` adds `catalogId`, and `DataContext`
  adds `invokerForCatalog`.
- **Behavior change:** `MessageProcessor` gives each surface the processor
  catalogs compatible with its protocol version as `availableCatalogs`, and
  `createSurface` without a `catalogId` creates a surface with no default
  catalog instead of throwing. A component that names no catalog on such a
  surface throws `A2uiCatalogError`, even when the processor supports one
  catalog. `createSurface` metadata is kept on `SurfaceModel.metadata`.
- **Behavior change:** `SurfaceGroupModel.addSurface` throws `A2uiStateError`
  for a surface id it already holds, instead of ignoring the new surface.
- **Behavior change:** `Catalog` throws `A2uiCatalogError` for two components
  or two functions with one name, for a component named `Surface`, for a
  function name starting with `@`, and for a function declaring
  `returnType: 'validationResult'` when the catalog's effective
  `protocolVersion` is below `1.0` (an omitted `protocolVersion` defaults to
  `'0.9'`).
- **Behavior change:** `Catalog.invoke` checks arguments against the
  function's argument schema and throws `A2uiExpressionError` on a mismatch
  before the function runs. Parameters that reference `common_types.json` or
  a definition the catalog bundles are checked against the referenced
  definition. Null arguments, such as bindings to missing data, are not
  checked.
- `SurfaceModel.dispatchAction` copies the action's `catalogId` onto
  `A2uiClientAction.catalogId`.
- `Catalog` adds `protocolVersion` and `instructions`, read by
  `Catalog.fromJson` and written by `catalogSchema`. `catalogSchema` requires
  `args` only for functions with required parameters.
- **Breaking:** `Catalog.fromJson` inlines and flattens `allOf` component envelopes (`ComponentCommon`, `CatalogComponentCommon`, `Checkable`), maps `accessibility` and `checks` mixins, omits envelope keys (`id`, `component`, `catalogId`) from `ComponentApi.schema`, and replaces `REF:` description prefixes in `CommonSchemas` with `commonTypesRef` metadata.
- Adds `Catalog.protocolVersion`, `FunctionApi.description`, and `FunctionImplementation.description`, and updates `Catalog.catalogSchema` to rebuild component envelopes, emit `anyComponent.discriminator` and function `description`, and restore `common_types.json#/$defs/...` references.
- Allows the `catalogId` envelope property during component validation in `PayloadValidator`.
- Resolves local `#/...` pointers that are absent from the catalog document against `commonTypes` in `resolveSchemaRefs`.
- Support non-ASCII data model keys in templates.
- `A2uiVersionCapabilities.fromJson` throws `A2uiCatalogError` when `inlineCatalogs` is present but isn't an array, or contains an entry that isn't an object.
- **Breaking:** `UpdateDataModelMessage` adds `hasValue` (defaulting to `true`) so `toJson()` emits `'value': null` for explicit null deletions while `fromJson()` distinguishes an omitted `value` from an explicit `null`.
- **Breaking:** `SurfaceModel.dispatchAction` records action timestamps in UTC (`DateTime.now().toUtc()`) and `A2uiClientAction.toJson()` serializes timestamps in UTC (`timestamp.toUtc().toIso8601String()`) so serialized timestamps always end with `Z` per RFC 3339.
- **Breaking:** `A2uiClientError` validates in its constructor (not only in debug assertions) that a `VALIDATION_FAILED` error provides a non-empty `path`, throwing `A2uiValidationError`.
- `ComponentModel.toJson` writes `id` and `component` after the component's properties, so a property named `id` or `component` no longer replaces the model's own.
- **Breaking:** Removed `DataPath`. `DataModel` parses JSON Pointers itself,
  as web_core and the Python core do, and every path API (`get`, `set`,
  `delete`, `hasPath`, `watch`) takes a `String`. Parsing validates RFC 6901
  `~0`/`~1` escape sequences and rejects prototype-pollution segment names
  (`__proto__`, `constructor`, `prototype`) with `A2uiDataError`.
- **Breaking:** `DataModel` takes a modifiable deep copy of incoming data on
  initialization and `set`, normalizing string-keyed maps (including untyped
  `Map<dynamic, dynamic>`) to `Map<String, Object?>` and lists to
  `List<Object?>` so external mutations do not alias internal state and
  untyped maps are traversable.
- Add `DataModel.delete`, `DataModel.hasPath`, and `DataModel.resolvePath`.
- `EventNotifier.emit` isolates listener exceptions, logging them via
  `Logger('a2ui.EventNotifier')` and continuing delivery to remaining
  listeners.
- Validate `DataBinding`, `FunctionCall`, `Action`, and `ChildListTemplate` fields during JSON deserialization (`A2uiValidationError`), preserve `reservedKeys` (`@path`/`@call`) and `catalogId` across `toJson` (the `@call` form omits `returnType`, which the v1.0 schema does not declare), default `FunctionCall.returnType` to `A2uiReturnType.any`, treat a non-list `checks` value as no rules (as web_core and the Python core do) and guard dynamic map casts against `TypeError`, and throw `A2uiStateError` from `ComponentContext.childContext` and `A2uiCatalogError` from `CatalogInvokerExtension.invoke`.
- Add `isValidUax31Identifier` and `assertUax31Identifier` for UAX #31 identifier validation, `A2uiErrorDetail`, `cause` chaining on `A2uiError` subclasses, and `code`/`path`/`errors` on `A2uiValidationError`. `A2uiError` now takes `code` as a named parameter, and `A2uiValidationError` aligns its default code to `'VALIDATION_FAILED'`.
- Add `Catalog.refMap`, a cached `ComponentRefMap` of each component type's
  child-reference properties. `MessageProcessor` graph validation and
  `NodeResolver` both read it, so a property the validator checks is one the
  resolver mounts. `ComponentRefMap`, `RefFields` and the `RefKind` types
  (`SingleRef`, `ListRef`, `NestedRef`) are now exported.
- Recognize v1.0 `common_types.json#/$defs/Child` (and `#/$defs/Child`) as a
  single child reference, for dangling-reference and orphan checks and for
  resolution.
- Add `Catalog.commonTypesSchema` (internal to the package), the embedded
  `common_types.json` document selected by the catalog's `protocolVersion`
  (v1.0 for 1.0 and later, v0.9 otherwise, including when undeclared),
  decoded once per catalog.
  `Catalog.refMap` and `GenericBinder` resolve `common_types.json#/$defs/...`
  pointers against it, and `ComponentRefMap` takes the same optional
  `commonTypes` document, so a v1.0 catalog's shared types (such as the
  v1.0 `CheckRule`) read the v1.0 definitions rather than the v0.9 default.
- **Behavior change:** `NodeResolver` now mounts an unmarked string `child`
  and string-array `children`, which graph validation already checked.
  Previously such a catalog validated but rendered its children as plain ids.
- **Behavior change:** a dangling id inside a child list is reported with its
  index (`children[2]` rather than `children`), and only an object with both a
  string `componentId` and a string `path` is read as a `ChildList` template.
- **Breaking:** `MessageProcessor.validationConfig` is nullable and defaults
  to `null`. Without a config the processor still rejects duplicate ids
  within an `updateComponents` batch and checks declared component types and
  themes against their catalog schemas, accepts undeclared types, and skips
  the root, dangling-reference, reachability, cycle, depth and data-model
  path checks, so a surface may arrive across several messages in any order.
  `ValidationConfig.strict` is the opt-in to those checks.
- **Behavior change:** under a `ValidationConfig`, `MessageProcessor` checks
  the component graph on every `updateComponents` message rather than once
  per payload. Each batch is applied to a copy of the surface's components
  first, and the result must pass the root, dangling-reference, cycle, depth
  and reachability checks the config's flags require before anything is
  committed. A surface streamed across several messages under a config needs
  `ValidationConfig.relaxed` or the individual `allow*` flags.
- `ValidationConfig` adds `allowUnknownElements`, `targetVersion`,
  `allowedMessages`, `rootId` and `maxDepth`. `ValidationConfig.relaxed` now
  also sets `allowUnknownElements`.
- An `updateComponents` entry that omits `component` is checked against the
  existing component's type and catalog schema; its properties still replace
  the existing ones.
- `ComponentModel` adds `catalog` (the component's `catalogId`) and `metadata`,
  and `properties` no longer holds `catalogId` or `metadata`. A component whose
  `catalogId` changes is recreated, as for a change of type.
- `SurfaceModel` adds `rootId`, defaulting to `root` or to
  `ValidationConfig.rootId`, and `NodeResolver` roots the tree at it.
- `SurfaceComponentsModel` adds `getAll()`, `has()`, `size`, `entries`, `keys`,
  `values`, `getChildIds()`, `validateTopology()`, `detectCycles()`,
  `validateReferences()` and `validateComponentsUpdate()`.
- Added `ValidationResult` and `A2uiReturnType.validationResult` for structured
  client-side validation outcomes (`valid`, `message`, `code`, `severity`), and
  exposed `validationResults` alongside `isValid` and `validationErrors` on
  resolved component properties. `A2uiReturnType.validationResult` is an
  API-level value; the v0.9 `CommonSchemas.functionCall` wire schema still
  accepts only the seven v0.9 return types. `ValidationResult.validityOf`
  exposes the rule the binder uses to read a check result's validity.
- Fixed `checks` evaluation in `GenericBinder`:
  - Rules evaluate once during initial binding without a duplicate object-branch
    pass.
  - `_subscribe` skips invoking its reactive callback during the initial
    synchronous pass so rebuilds do not write into stale property maps.
  - Non-map rule entries emit a `VALIDATION_FAILED` client error on the surface
    instead of throwing a `TypeError`.
  - Checkable properties are classified from schema markers or `CheckRule` item
    structure rather than matching the property name `'checks'`.
- `ReferenceSchemaReader` resolves external `common_types.json#/$defs/...`
  pointers against the `common_types.json` document the caller supplies (the
  embedded v0.9 document by default) so catalogs loaded via `Catalog.fromJson`
  classify `Checkable`, `DynamicValue`, `Action`, and `ChildList` properties
  identically to code-constructed catalogs. `extractRefFields` forwards the
  same optional `commonTypes` document.
- **Breaking:** Message constructors no longer default `version` to
  `'v0.9'`; every `AgentToRendererMessage` and `RendererToAgentMessage`
  subclass takes a required `version`. `A2uiClientAction.fromJson` and
  `A2uiClientError.fromJson` take a required `protocolVersion`.
- `A2uiProtocolVersion` adds `v0_9_1` and `v1_0`. `'v0.9.1'` now parses to
  `v0_9_1` instead of `v0_9`. The enum adds `parse`, `major`, `minor`,
  `compareTo` and `isAtLeast`. Payload parsers and `PayloadValidator` accept
  v0.9.1 envelopes where v0.9 is configured, and the reverse.
  `A2uiRendererCapabilities.forVersion` falls back to a compatible declared
  version in the same way.
- Added `isCatalogVersionCompatible` and `compareVersions`, matching the
  TypeScript and Python SDKs. `isCatalogVersionCompatible` accepts a null
  catalog version, which is compatible with versions below 1.0 only.
- Added the v1.0 messages `CallRendererFunctionMessage`,
  `AgentFunctionResponseMessage`, `CallAgentFunctionMessage` and
  `RendererFunctionResponseMessage`, with `A2uiFunctionResponse` and
  `A2uiFunctionResponseError` for function results. They are rejected in
  v0.9 and v0.9.1 envelopes.
- `CreateSurfaceMessage.catalogId` is optional, as v1.0 allows. The class adds
  the v1.0 `components`, `dataModel` and `metadata` fields. v1.0 rejects
  `theme`, and v0.9 rejects the v1.0 fields.
- `A2uiClientAction` adds `catalogId` and `metadata`.
- `A2uiClientError` follows the v1.0 rules. `UNALLOWED_PARENT` and
  `UNALLOWED_CHILD` are path errors like `VALIDATION_FAILED`, and path errors
  reject extra fields. A generic error names exactly one of `surfaceId` and
  the new `functionCallId`, and keeps its other fields in
  `additionalProperties`. `surfaceId` is now nullable.
- Envelope parsing checks each version's allowed and required keys. It
  rejects unknown envelope and body keys, an empty `components` list, and a
  v1.0 `updateDataModel` without `value`. A new oracle test checks the parsers
  against the specification's envelope schemas.
- Harden `ExpressionParser` to clamp scanner bounds at EOF, reject unclosed
  string literals and trailing backslashes with `A2uiExpressionError`, accept
  `@`-prefixed function names (such as `${@index()}` and
  `${@index(offset: 1)}`), and accept `~0` and `~1` JSON Pointer escapes inside
  `${}` paths while rejecting malformed `~` escapes and non-leading `@` tokens.
- Added `BasicCatalog.v0_9()` and `BasicCatalog.v1_0()`, which carry the
  basic catalog's 14 functions (`required`, `regex`, `length`, `numeric`,
  `email`, `formatString`, `formatNumber`, `formatCurrency`, `formatDate`,
  `pluralize`, `openUrl`, `and`, `or`, `not`). Each function's argument schema
  and return type are read from an embedded copy of the published catalog
  document, so they cannot drift from it. Components follow in a later
  release.
  - v0.9 validation rules return `bool`; v1.0 rules return a
    `ValidationResult` with a failure message.
  - In v1.0, `and`, `or`, and `not` read the validity of a `ValidationResult`
    (or a map with a `valid` key) instead of treating every object as truthy,
    so the v1.0 spec's nested `and(required, or(required, required))` check
    blocks a submit when a field is empty. v0.9 keeps plain truthiness, since
    its validators return booleans.
  - Formatting uses `package:intl` for the `locale` argument (default
    `en-US`). `formatDate` reads a timestamp without an offset as UTC, keeps
    the wall-clock time of one with an offset, and emits the UTC instant for
    the `ISO` pattern. It returns an empty string for a date that does not
    exist, such as `2026-02-30`, instead of rolling it into the next month.
  - `openUrl` accepts only absolute `http`, `https`, `mailto` and `tel` URLs
    and passes them to an `OpenUrlCallback`. Without a callback it throws,
    which a binder reports as `EXECUTION_ERROR`.
  - The embedded v1.0 document matches `catalogs/basic/v1/catalog.json`,
    whose instruction examples write bindings and calls as `@path` and
    `@call` and use full `CheckRule` objects.
- `FormatStringFunction` now delegates to the basic catalog's `formatString`:
  it coerces a non-string `value` instead of throwing, renders integral
  doubles without `.0`, and resolves template bindings and calls on a v1.0
  surface.
- Added a conformance runner for `conformance/core/functions.yaml`. Its
  `validate` cases are skipped until basic-catalog components and v1.0
  message processing land.
- Add `DataContext.isDataBinding`, `DataContext.isFunctionCall`, `DataContext.bindingFor`, and `DataContext.adaptExpressionPart` for protocol-version-aware binding and function-call detection; adapt `FormatStringFunction` parser AST nodes (`@path`/`@call`) in v1.0 mode, pre-build function argument signals outside `computed` in `DataContext.resolveListenable`, skip binding/call validation inside `updateDataModel.value` in `checkPathsAndRecursion`, and report unrecognized or invalid action payloads on `SurfaceModel.onError` with code `INVALID_ACTION`.
- Add `DataContext.resolveAction` method for resolving dynamic values inside action payloads.
- Added `actions_conformance_test.dart` running the shared `conformance/core/actions.yaml` suite.
- `FormatStringFunction` coerces null expression arguments to empty strings and encodes maps and lists as JSON.
- **Deprecated:** `SchemaCatalog` is renamed `CatalogApi`, matching
  `ComponentApi` and `FunctionApi`. `SchemaCatalog` stays as a deprecated alias
  and will be removed in a later release.
- Support reserved protocol key prefix (`@path`, `@call`) in `DataBinding` and `FunctionCall`, dynamic prefix doubling unescaping (`@@path` → `@path`) during dynamic evaluation, and `@path` in dynamic setter generation.
- Lower SDK floor constraint to `">=3.5.0 <4.0.0"` (replacing post-3.5 null-aware collection element syntax with collection-if) to support Flutter 3.24+ and Dart 3.5+ environments.
- Execute `functionCall` and `call` component actions locally in
  `GenericBinder`, against the component's data context. A function that
  throws, fails asynchronously or is missing from the catalog is reported
  through `SurfaceModel.onError` with code `EXECUTION_ERROR` rather than
  escaping the action callback.
- **Behavior change:** `SurfaceModel.dispatchAction` only emits agent-bound
  `event` and `name` actions. A direct caller that passes a `functionCall`
  payload previously had the function run against the root data context; the
  call is now ignored. Run local functions through the binder or
  `DataContext.resolveSync` instead.
- Action `context` values are resolved one entry at a time, so a context key
  named `path` or `call` reaches the agent as a literal key instead of being
  read as a data binding or function call.
- Added optional `userMessage` field to `A2uiClientAction`.
- Remove `A2uiCompileError` from `a2ui_core` (compilation is an agent SDK responsibility).
- `ExpressionParser` accepts number literals with a leading decimal point
  (`.5`, `-.5`, `+.5`, `.5e2`), including as function-call arguments. A `.`
  inside a path such as `a.5` is still part of the path, and `.foo` is still a
  path. This matches the TypeScript, Python and Swift parsers.
- `ExpressionParser` rejects a number literal outside the double range, such as
  `1e999`, with `A2uiExpressionError`. It used to return `double.infinity`,
  which `jsonEncode` can't encode.
- `MessageProcessor`, `PayloadValidator`, and `Catalog` align surface lifecycle
  error reporting (`A2uiIntegrityError` and `A2uiRecursionError` extending
  `A2uiValidationError`, per-message completeness validation, safe no-op
  `deleteSurface` on unknown surfaces), support `"v0.9.1"` in
  `A2uiProtocolVersion.tryParse`, and pass the `message_processor_v0_9.yaml`,
  `validator_v0_9.yaml`, and `catalog.yaml` conformance suites.
- `ExpressionParser` enforces recursion depth (`maxDepth = 100`), template
  length (`maxTemplateLength = 10000`), and template parts
  (`maxTemplateParts = 1000`) limits across nested interpolations and
  function arguments.
- `DataModel` and `DataContext` enforce JSON Pointer validation (`A2uiDataError`
  on non-pointer paths, forbidden prototype-pollution segments, primitive
  traversal/root mutation, and array index bounds), support `DataContext.index`
  and `DataContext.dispose`, and pass the `data_model.yaml` and
  `data_context.yaml` conformance suites.
- **Breaking:** `GenericBinder`, `Behavior`, `BehaviorNode` and `ComponentContext`
  are no longer exported. Renderers read components through `NodeResolver` and
  `ComponentNode`, whose props carry dynamic properties as `ResolvedBinding`
  values instead of raw values, with no synthesized `set<Property>` setter
  entries. A property bound to a data path is a `WritableBinding`, even when the
  path holds no data; writes go through `WritableBinding.set`, and
  `WritableBinding.path` is the path as authored.
- **Breaking:** `SurfaceModel.dispatchAction` no longer executes `functionCall`
  payloads and emits an action only for `event` payloads. A node's action runs
  its function call itself.
- Added: `DataContext` accepts an optional `ExpressionErrorReporter` through
  `onError`. With a reporter, a missing or failing catalog function resolves to
  null and the reporter receives the error; without one, the error propagates.
- Added: `NodeResolver(surface)` builds a reactive tree of read-only
  `ComponentNode`s with resolved child references, scoped templates, dynamic
  bindings, callable actions, and placeholder states for unresolved nodes.
  It owns node subscriptions and cleanup; consumers dispose the resolver
  before its surface. Node props and container-valued bindings are detached,
  recursively unmodifiable snapshots.
- Node bindings report a missing or failing catalog function as an
  `EXPRESSION_ERROR` client error on the surface and resolve to null.
- Validation and node resolution recognize wire/local `$ref` pointers and
  `REF:` description markers. Resolution additionally recognizes unmarked
  structural `ChildList` schemas, which validation deliberately ignores so a
  batch is never rejected on that guess. Resolution mounts top-level child
  references and lists, including single-reference fields within arrays of
  objects.
- A `ChildList` expands to at most `maxDynamicChildListSize` (10,000) items,
  matching the TypeScript core's `MAX_DYNAMIC_CHILD_LIST_SIZE`.
- Changed: `ChildNode` descriptors compare by component id and data scope
  and serialize as plain JSON in node props. Nested `ChildList` values remain
  scoped descriptors rather than mounted nodes.
- Fixed: `DataContext.resolveListenable` resolves array and map payloads per
  entry and tracks nested bindings reactively; previously a container holding
  bindings (such as a function argument list or a nested `{path}` value) was
  passed through as a static literal.

## 0.2.2

- `ExpressionParser` accepts signed number literals (`-42`, `+1`, `-3.5`) and
  exponent notation (`1e5`, `1E5`, `1.5e-3`, `2.5E+4`), including as
  function-call arguments. Previously `-42` parsed as the path `-42` and `1e5`
  failed with `Unexpected characters at end of expression`. A `-` inside a path
  such as `a-1` is still part of the path. This matches the TypeScript and
  Python parsers.
- Fixed `DataModel.set` with a `null` value (a delete) at a list index at or
  past the end of the list padding the list with `null` up to that index. It
  now leaves the list unchanged; only a write extends a list.
- Remove `A2uiCompileError` from `a2ui_core` (compilation is an agent SDK responsibility).
- Validate that catalog function definitions have a non-empty `name` string in `Catalog.fromJson`, throwing `A2uiCatalogError` if missing or empty.
- Validate that message object fields and `theme` maps have string keys in `AgentToRendererMessage.fromJson`, throwing `A2uiValidationError` when encountering non-string keys.
- Enhanced child reference detection in `ComponentRefs` to recognize string-typed `child` properties and string list `children` properties as component references.
- Expanded conformance test coverage for validator, expressions, and data model suites across protocol versions v0.8, v0.9, and v1.0.

## 0.2.1

- Widen `preact_signals` dependency constraint to `">=1.9.4 <8.0.0"` to support `preact_signals: ^7.0.0` and downstream modern signal-based ecosystems.

## 0.2.0

- **Breaking:** `MessageProcessor.processMessages` takes an
  `AgentToRendererMessagePayload` rather than a `List<AgentToRendererMessage>`,
  and `AgentToRendererMessage.parseAll` returns one. The processor is where
  untrusted wire data enters the SDK, so the accepted set is every shape an
  agent or a transport realistically sends — a batch of parsed messages, a lone
  message through `AgentToRendererMessagePayload.of`, or raw decoded JSON
  through `AgentToRendererMessagePayload.fromJson`, which takes a lone
  envelope, a list of envelopes or the `{messages: [...]}` wrapper. Naming that
  set lets a signature reference it rather than restate it, and keeps trivial
  normalization out of every transport. A payload holds its messages
  unmodifiably, so the list a caller passed cannot change under a processor
  part-way through applying it.
- Added `RendererToAgentMessage`, with `ActionMessage` and `ErrorMessage`, and
  the symmetric `RendererToAgentMessagePayload`. The renderer-to-agent
  direction had bodies but no envelope: `A2uiClientAction` and
  `A2uiClientError` matched `client_to_server.json`'s `action` and `error`
  objects, leaving every transport to build the `{version, action}` envelope
  and the batch around it. Each message wraps the body a surface's event source
  already emits rather than a second representation of it, and
  `A2uiClientAction.fromJson` and `A2uiClientError.fromJson` parse the bodies
  an agent receives. A malformed `timestamp` is reported as
  `A2uiValidationError` rather than escaping as the platform's
  `FormatException`.
- `A2uiClientError` carries `path`, the JSON pointer the `VALIDATION_FAILED`
  variant of `client_to_server.json` requires. No other field names the field
  that failed, so without it a validation failure lost its location on the way
  through `toJson` and `A2uiClientError.fromJson`. The variant requires it, so
  `fromJson` rejects a `VALIDATION_FAILED` body that names no `path`, and the
  constructor asserts the same.
- The `{messages: [...]}` wrapper is handled by each payload's `fromJson` and
  `toJson` rather than by a wrapper class per direction: it carries nothing but
  the list, so a type holding one field would be a second name for it.
  `toJsonList` emits the bare list the `*_list.json` schemas describe.
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
  message travels, which the old name left open, and leaves the other direction
  its own name: `RendererToAgentMessage`.
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
  `conformance/core/validator_v0_8.yaml`, `validator_v0_9.yaml`,
  `validator_v1_0.yaml` and `conformance/core/data_model.yaml` suites.

## 0.1.1

- The source code is moved from genui repo to a2ui repo.

## 0.1.0

- Initial version.

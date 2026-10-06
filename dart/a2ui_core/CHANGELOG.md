# [a2ui_core](https://pub.dev/packages/a2ui_core) Changelog

## Unreleased

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
  TypeScript and Python SDKs.
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
- `PayloadValidator.commonTypesFor` throws for v1.0, whose common types this
  package does not embed yet.
- Harden `ExpressionParser` to clamp scanner bounds at EOF, reject unclosed
  string literals and trailing backslashes with `A2uiExpressionError`, accept
  `@`-prefixed function names (such as `${@index()}` and
  `${@index(offset: 1)}`), and accept `~0` and `~1` JSON Pointer escapes inside
  `${}` paths while rejecting malformed `~` escapes and non-leading `@` tokens.
- Add `DataContext.isDataBinding`, `DataContext.isFunctionCall`, and `DataContext.bindingFor` for protocol-version-aware binding and function-call detection; adapt `FormatStringFunction` parser AST nodes (`@path`/`@call`) in v1.0 mode, pre-build function argument signals outside `computed` in `DataContext.resolveListenable`, skip binding/call validation inside `updateDataModel.value` in `checkPathsAndRecursion`, and report unrecognized or invalid action payloads on `SurfaceModel.onError` with code `INVALID_ACTION`.
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
  > > > > > > > upstream/main

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

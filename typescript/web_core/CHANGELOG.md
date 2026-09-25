## Unreleased

- **BREAKING CHANGE**: The package directory moved from `renderers/web_core/` to `typescript/web_core/`.
- **BREAKING CHANGE**: The root package export (`@a2ui/web_core`) now provides the shared core state, validation, catalog, expressions, RPC, and resolution APIs across protocol versions. Consumers using v0.8 protocol APIs should import from `@a2ui/web_core/v0_8`.
- **BREAKING CHANGE**: The `Catalog` constructor now requires `protocolVersion` as its second parameter: `Catalog(id, protocolVersion, ...)`.
- **BREAKING CHANGE**: The `SurfaceModel` constructor now accepts `availableCatalogs` as its third positional argument, moving `theme` to the fourth argument (`SurfaceModel(id, defaultCatalog, availableCatalogs, theme, ...)`). Passing an invalid third argument (such as a `Theme` object) throws a `TypeError`.
- `SurfaceModel.catalog` is deprecated in favor of `SurfaceModel.defaultCatalog`. The `catalog` property remains as a compatibility getter.
- **BREAKING CHANGE**: `FunctionInvoker` function arguments are now typed `unknown` instead of `any`, requiring explicit validation or schema parsing.
- **BREAKING CHANGE**: Removed non-spec math and comparison functions from the v0.9 basic catalog: `add`, `subtract`, `multiply`, `divide`, `equals`, `notEquals`, `greaterThan`, `lessThan`, `contains`, `startsWith`, and `endsWith`. Applications requiring these operations must register them in a custom catalog.
- Add `PayloadValidator` (`@a2ui/web_core/validation`) for single-catalog component and function schema validation.
- Add `A2uiRpcError` and `RpcErrorCode` (`@a2ui/web_core/rpc`) for structured RPC error responses.
- Re-export `DataBindingType` and `FunctionCallType` (from `types/common-types.js`) and `MAX_FUNCTION_CALL_ARGS` (from `types/helpers.js`) from `@a2ui/web_core/v0_9`.
- Factor out basic catalog function implementations shared between v0.9 and v1.0
  into a common module (`src/common/basic_functions.ts`). Both versions now
  share implementation logic for logical operations, string formatting, number
  formatting, currency fallback formatting (`${currency} ${amount}`), TR35 date
  formatting, pluralization, and validation. Removed the `date-fns` dependency.
- **BREAKING CHANGE**: (v0_9) Basic catalog components no longer define their custom element as a side effect of being imported. `renderA2uiNode` defines the element it is about to render, so surfaces rendered through it are unaffected; code that relied on the import alone must call `registerUniversalElement`. [#2698](https://github.com/a2ui-project/a2ui/pull/2698)
- **BREAKING CHANGE**: (v0_9) `WebComponentImplementation` now requires an `element` field holding the custom element constructor, and `@a2ui/web_core/v0_9/universal` exports `isWebComponentImplementation` (type guard) and `registerUniversalElement` (idempotent `customElements.define` that throws when a tag name is already bound to a different constructor and reports once via `console.error` when `customElements` is unavailable). [#2596](https://github.com/a2ui-project/a2ui/pull/2596)
- (v0_9) Add `A2uiWebComponentElement`, the DOM contract for an A2UI custom element: an `HTMLElement` that accepts a `context` property. [#2596](https://github.com/a2ui-project/a2ui/pull/2596)
- **BREAKING CHANGE**: (v0_9) Move Universal Web Component symbols (`A2uiLitElement`, `A2uiController`, `renderA2uiNode`, `WebComponentImplementation`, `ResolvedChildList`, `A2uiChildRef`, `ResolvedChildRef`) from root `@a2ui/web_core/v0_9` to `@a2ui/web_core/v0_9/universal`. Recommended migration: update import paths from `@a2ui/web_core/v0_9` to `@a2ui/web_core/v0_9/universal`. [#2488](https://github.com/a2ui-project/a2ui/pull/2488)
- (v0_9) Enable setting and getting a default `MarkdownRenderer` (`setMarkdownRenderer` / `getMarkdownRenderer`) in `@a2ui/web_core/v0_9/basic_catalog` for basic catalog text components. [#2272](https://github.com/a2ui-project/a2ui/pull/2272)
- The conformance harness now resolves surface node graphs to assert on
  evaluated binding values and catch expression errors. It also adds a
  `get_renderer_data_model` handler and itemizes unimplemented agent actions in
  the test summary.
- (v1_0) The v1.0 basic catalog now ships function bodies. It previously
  exported argument schemas only, so a payload calling `formatCurrency`,
  `pluralize`, `and` or any of the other 13 catalog functions resolved to
  `undefined`. `BASIC_FUNCTIONS` and `createBasicCatalogFunctions` are exported
  from `@a2ui/web_core/v1_0/basic_catalog`, matching the v0.9 shape.
  `formatNumber`, `formatCurrency` and `pluralize` default to `en-US` rather
  than the host locale, and `formatDate` expands TR35 tokens in the offset the
  timestamp was written with, so output does not vary by machine.
- (v1_0) `formatCurrency` places a currency code that `Intl` rejects where the
  locale's currency pattern puts it, rather than always prefixing it. `Intl`
  rejects any code that is not three ASCII letters, and the old fallback
  emitted `CODE amount` whatever the locale, so `de-DE` and `fr-FR` put the
  code on the opposite side from the Python engine and used an ASCII space
  where CLDR calls for U+00A0. A well-formed but unassigned code such as `XYZ`
  is accepted by `Intl` and never took this path.
- (v1_0) A locale tag the catalog cannot use falls back to `en-US`.
  `formatNumber`, `formatCurrency`, `formatDate` and `pluralize` previously
  threw a `RangeError` from `Intl` for a malformed tag such as `en_US`, and for
  a well-formed tag with no matching locale data, such as `xx-YY`, they
  formatted with the host's ambient locale, which the catalog otherwise never
  depends on. The Python engine falls back for the same tags.
- (v1_0) `@index` raises `A2uiValidationError` when evaluated outside a
  collection template. It previously returned 0, which presented a payload
  error as a plausible first row.
- The expression parser's `MAX_DEPTH` stays at 100, and the Python and Swift
  engines are raised to match. An expression nested between 11 and 100 levels
  deep was accepted here and rejected there.
- `createSurface` assigns its `dataModel` at the root instead of building a
  JSON Pointer per key. A key containing `/` or `~` was previously read as a
  nested path or an escape sequence rather than as a literal property name.
- The shared conformance suite now runs as part of `yarn test`, via a new
  `test:conformance` script, so a conformance regression fails CI. A change
  under `conformance/` also triggers the web CI job.
- (v1_0) Catalog loading validates component property names, function names and
  function argument names against UAX #31, matching the Python SDK. Previously
  only component names were checked.
- `GenericBinder` resolves `event.userMessage` before dispatch. As a
  `DynamicString` it may be a `{path}` or `{call}`, and the renderer-to-agent
  schema states it is sent already resolved; those forms were previously
  forwarded to the agent verbatim.
- Deleting an array index past the end of the array is now a no-op. Assigning
  `undefined` there previously extended the array's `length`, so deleting
  `/items/10` from a three-element array produced an eleven-element array.
- The error raised when an `updateComponents` entry has no `id` now reads
  `Component 'X' is missing an 'id'; entries require a valid string 'id'.`,
  matching the Python SDK and the phrase the shared conformance suite asserts
  on.

## 0.11.0

- **BREAKING CHANGE**: (v0_9) An invalid number literal in an expression, such as `${1.2.3}`, now throws `A2uiExpressionError` instead of being handed back as `NaN`. The accepted shape — digits, an optional decimal point and optional further digits — is stated in the parser rather than inherited from `Number()`, so every implementation accepts the same literals. ([#2497](https://github.com/a2ui-project/a2ui/pull/2497))
- **BREAKING CHANGE**: (v0_9) `Catalog` and `SurfaceModel` accept a function-kind type parameter (defaulting to `FunctionImplementation`); invoking a catalog function that has no implementation now throws `A2uiExpressionError` ([#2077](https://github.com/a2ui-project/a2ui/pull/2077)).
- (v0_9) Deprecate `injectBasicCatalogStyles`, `computeColorVariant`, `ColorVariantLightDarkOptions`, and `ColorVariantHoverOptions` exports from `@a2ui/web_core/v0_9`. Consumers should import them from `@a2ui/web_core/v0_9/basic_catalog` instead.
- (v0_9) The expression parser now runs the shared conformance suite at `conformance/core/expressions.yaml`, alongside the Dart client. Adds `js-yaml` as a dev dependency to read it. ([#2497](https://github.com/a2ui-project/a2ui/pull/2497))
- (v0_9) Enforce the expression parser's nesting limit. The depth guard was unreachable, so deeply nested interpolations or function-call arguments recursed until the stack overflowed instead of raising `A2uiExpressionError`. ([#2492](https://github.com/a2ui-project/a2ui/pull/2492))
- (v0_9) Add unit test coverage for all basic catalog Web Component implementations. [#2357](https://github.com/a2ui-project/a2ui/pull/2357)
- (v0_9) Replace `A2uiLitElement.controller` property with a read-only getter to disallow external reassignment, simplify style root target resolution, and replace basic catalog barrel wildcard exports with explicit exports.
- (v0_9) Add `@a2ui/web_core/v0_9/basic_catalog` entrypoint exporting universal Web Component basic catalog implementations (`A2uiText`, `A2uiButton`, `A2uiTextField`, `A2uiRow`, `A2uiColumn`, `A2uiList`, `A2uiImage`, `A2uiIcon`, `A2uiVideo`, `A2uiAudioPlayer`, `A2uiCard`, `A2uiDivider`, `A2uiCheckBox`, `A2uiSlider`, `A2uiDateTimeInput`, `A2uiChoicePicker`, `A2uiTabs`, `A2uiModal`, `basicCatalog`). [#2190](https://github.com/a2ui-project/a2ui/pull/2190)
- (v0_9) Export Web Component base class `A2uiLitElement` from `@a2ui/web_core/v0_9`. [#2190](https://github.com/a2ui-project/a2ui/pull/2190)
- (v1_0) Refine `SurfaceModel` constructor to accept optional custom `DataModel` and expand `dispatchAction` payload parsing to support `functionCall` as well as `event` structures for Python SDK parity.
- (v1_0) Add `componentsMap` property getter to `SurfaceComponentsModel` matching `SurfaceGroupModel.surfacesMap`.
- (v0_9) The child-reference marker on `ComponentIdSchema` and `ChildListSchema` now lives in the schema's metadata, so `.describe()` and other schema-rebuilding methods no longer drop it. Hand-authored `REF:` descriptions are still recognized ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) Add the node layer: `NodeResolver` resolves a surface's components and data into a live tree of read-only `ComponentNode`s, with dynamic properties resolved to `ResolvedBinding`/`WritableBinding` and distinct pending, unknown-type, and cyclic placeholder states. Sibling instance ids are always distinct, unresolvable and cyclic references are reported through `onError` once per component and data path while the condition persists, model events delivered late reconcile against current model state, and child-reference detection covers `ChildList` unions and plain arrays of component ids ([#2077](https://github.com/a2ui-project/a2ui/pull/2077), [#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) Emit `$ref` in inline-catalog capabilities for the basic catalog's child-reference properties even when a per-usage description is set; new `componentId()`/`childList()` helpers compose custom descriptions without losing the `$ref` ([#2077](https://github.com/a2ui-project/a2ui/pull/2077)).
- (v0_9) `GenericBinder` reuses action closures across identical component resends, so action-valued props keep reference identity and downstream equality checks see them as unchanged ([#2077](https://github.com/a2ui-project/a2ui/pull/2077)).
- (v0_9) Enhance `GenericBinder` schema inference to recognize `$defs` descriptions and child reference metadata ([#2359](https://github.com/a2ui-project/a2ui/pull/2359)).

## 0.10.6

- (v0_9) Validate component properties against catalog schema in `MessageProcessor` to prevent malformed component actions.
- (v0_9) Add prototype pollution protection and safe property lookup to `DataModel` (non-breaking security fix).
- (v0_8) Export `A2uiMessageSchema` in public API.
- Enable `inlineSources` in `tsconfig.json` to populate `sourcesContent` in sourcemaps.

## 0.10.5

- (v0_9) Accept both `v0.9` and `v0.9.1` versions when parsing messages. Allow `A2uiClientCapabilities` to support simultaneous version capability advertising (`'v0.9'` and `'v0.9.1'`).

## 0.10.4

- (v0_9) Support JSON Pointer escaping (RFC 6901) in DataModel ([#1796](https://github.com/a2ui-project/a2ui/pull/1796)).
- (v0_8) Export `UserAction` as `ClientEventUserAction` from `types.ts` ([#1942](https://github.com/a2ui-project/a2ui/pull/1942)).

## 0.10.3

- Added the ability to swap out the signals implementation through the `setSignalImplementation` function.

## 0.10.2

- Updated `openUrl` to reject URLs with schema other than HTTP or HTTPs to fix a security issue where agents could execute arbitrary Javascript code.

## 0.10.1

- Add locale support to basic catalog functions (`pluralize`, `formatNumber`, `formatCurrency`) in v0.9 via catalog-level configuration.
- Remove `.passthrough()` from `PluralizeApi` schema for stricter validation.
- Allow overriding hard-coded recursion depth in `DataValueSchema` for v0.8 by introducing `createDataValueSchema` factory function.
- Fix `formatString` to JSON-stringify objects/arrays per spec instead of using JS default coercion.

## 0.10.0

- **BREAKING CHANGE**: Rename Icon `path` property to `svgPath` to fix type collision with `DataBindingType`.
- (v0_9) Add `computeColorVariant` helper function for basic catalog components to generate CSS formulas for color variants (light, dark, hover), allowing reuse across renderers.

## 0.9.1

- Add new `FrameworkSignal` concept, which represents a generic signal from a
  given framework like Preact or Angular.
  - Unused in this version; future versions will introduce this throughout web
    core and will likely be breaking changes.
- Export `injectDefaultA2uiTheme` with default CSS variable values used
  by the A2UI basic catalogs.

## 0.8.8

- Add the ability to access the `schema` of a component in a type-safe way.
  - Update `ComponentApi` object to be generic over its `schema` type.
  - Modify the basic component definitions to `satisfies ComponentApi` instead
    of `: ComponentApi` so their schema type can be inferred later.
  - Add an `InferredComponentApiSchemaType` type to extract the schema type
    from a `ComponentApi` object.

## 0.8.7

- Adds `catalogId` to v0.8 schemas (was removed by mistake earlier)
- Tweak schema definitions so they survive minification.

## 0.8.6

- Update logical functions (`and`, `or`) to require a `values` array argument, removing deprecated individual arguments.
- Update `formatDate` to require `format` parameter to align with new configuration, utilizing `date-fns`.
- Add `date-fns` dependency for expression string formatting workflows.
- Update math and comparison expression schemas with preprocessing step to correctly coerce `null` parameters into `undefined` for tighter validation constraints.
- Fix associated tests in expressions and rendering models corresponding to validation updates.
- Improve error messages to include the function name and the catalog ID.

## 0.8.5

- Add `V8ErrorConstructor` interface to be able to access V8-only
  `captureStackTrace` method in errors.
- Removes dependency from `v0_8` to `v0_9` by duplicating the `errors.ts` file.

## 0.8.4

- Tweak v0.8 Schema for Button and TextField to better match the spec.

## 0.8.3

- The `MarkdownRenderer` type is now async and returns a `Promise<string>`.

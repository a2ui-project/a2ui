## Unreleased

## 0.14.0

- Catalogs can reference components, property subschemas and definitions in peer catalogs with cross-catalog `$ref`s, such as `other_catalog.json#/components/Text`. `Catalog.peerCatalogs` lists the peers a catalog resolves such references against. `Catalog.withPeerCatalogs(peers)` returns a new catalog linked to `peers`, with its own `validationSchema`, `componentRefMap` and entry Zod schemas, and leaves the receiver unchanged; a pruned peer also links the catalog it was pruned from. `linkCatalogs(catalogs, extraPeers?)` returns copies of `catalogs` linked to each other and to `extraPeers`, returning a catalog with no reference into another catalog document as is. `MessageProcessor` works with linked copies and never changes the catalogs passed to it. A reference's document matches a peer whose `catalogId` or `$id` equals it or ends with it as a path suffix (or the other way around), then, failing that, a peer with the same file name; a bare `catalog.json`, or a path ending in `/catalog.json` that no peer matches exactly, refers to the referencing catalog itself. `inlinePeerAndLocalRefs` inlines local and peer references in a schema.
- Relocate package directory from `typescript/web_core` to `typescript/core/web_core`.
- `isValidUax31Identifier` and `assertUax31Identifier` no longer strip a leading `@` before checking UAX 31 syntax, and `Catalog.fromJson` now rejects `@`-prefixed catalog function names and validates function parameter names. `PayloadValidator` allows the reserved `@index` system function call on v1.0+ surfaces while validating user-defined function names against UAX 31.
- Add `Catalog.fromJson(json, protocolVersion?, catalogId?)`, `Catalog.toJson()` and `Catalog.validationSchema` ([#3053](https://github.com/a2ui-project/a2ui/issues/3053)). A catalog holds its catalog document in model form. `fromJson` loads each entry as a `JsonComponentApi` or `JsonFunctionApi`, whose model is its JSON Schema definition as written (`jsonSchema`, deeply frozen); its Zod `schema` is derived from the definition on first use and cached, and its other fields are read from the definition. A spread copy of such an entry keeps the field values but not the definition, so it is serialized from its `schema`. The catalog stores the document-level fields (`schemaUri`, `schemaId`, `title`, `description`, `instructions`, `declaredProtocolVersion`, `declaresCatalogId`, `declaresComponents`, `functionsLayout`, `unions`, `defs` and `extensionFields`). `toJson` assembles the unbundled document from the model, computing the `anyComponent` and `anyFunction` unions, so `Catalog.fromJson(doc).toJson()` equals `doc` (except that entries omitted from `doc`'s `anyComponent.oneOf` or `anyFunction.oneOf` unions are filtered out on load), including a document without `components`; a `catalogId` argument replaces the document's own in `id` and `toJson`, and a `protocolVersion` argument takes precedence over the document's own for `protocolVersion` and the loading rules, while `toJson` still writes the version the document declares. `validationSchema` bundles the same model into a self-contained schema. Both are computed once per catalog, and each call returns a fresh copy. The `Catalog` constructor accepts a `CatalogOptions` object for the theme and the document-level fields, and `Catalog.withEntries` derives a catalog with other entries, dropping `$defs` that only removed entries referenced.
- Add `spec()` and `specDef()` to annotate a Zod schema with what a catalog document writes about it that Zod does not express: the mixins a component's definition composes with `allOf`, the keyword that closes an object, the order of `required`, extra `allOf` members and keywords such as `format`, and the `$defs` name of a model. The annotations do not change validation. For a component or function of a catalog defined in code whose schema is annotated, `toJson` computes its definition from the model in the layout of the catalog's protocol version, and writes the mixin models and the new `CatalogOptions.defModels` to `$defs`. The new `CatalogOptions.commonTypesUri` sets how common types references are written, and `CatalogOptions.themeLocation` whether the theme goes under `$defs.theme` or, as in v0.8, under `styles`. Other entries defined in code are generated from their Zod schemas as before.
- The basic catalogs (v0.8, v0.9 and v1.0) compute `toJson()` from their models and build `validationSchema` from the result, which equals their published documents. Their components and functions are Zod models generated from the published documents by `scripts/generate-catalog-schemas.mjs` and the new `src/v0_8/scripts/generate-catalog.mjs`, annotated with `spec()`, and the generated `BASIC_CATALOG_DOCUMENT_OPTIONS` carry the scalar document-level fields; no copy of a catalog document exists in the package. The v0.9 basic components compose the generated `CatalogComponentCommonSchema`, and the v0.9 document's theme is computed from the generated `ThemeDefSchema`, while the catalog's `themeSchema` stays `BasicCatalogThemeSchema`. The v0.8 basic component schemas are now generated from the published v0.8 catalog instead of being written by hand, and the generated function APIs carry their `description`. The basic catalogs list their components and functions in the order of their published documents. `@a2ui/web_core/v0_8/basic_catalog` exports `basicCatalog` and `BASIC_CATALOG_ID`.
- `Catalog.fromSchema` is deprecated in favor of `Catalog.fromJson`, `Catalog.catalogSchema` in favor of `Catalog.validationSchema`, and `generateCatalogSchema` in favor of `generateValidationSchema`.
- **BREAKING CHANGE**: `CatalogInterface` requires `toJson()` and `validationSchema`, so an external implementation must add them.
- **BREAKING CHANGE**: `validationSchema` (formerly `catalogSchema`) changes shape. Each function is the schema of a wire function call instead of its bare argument schema. Components, functions and the theme loaded with `fromJson` are built from their loaded definitions, and those of the basic catalogs from the definitions `toJson` computes from their models, instead of from their Zod schemas. From v1.0 a component is closed only when its author closed it. A theme is open unless its author closed it. `protocolVersion` is emitted, as a bare semantic version, only when the source declared it. A missing required argument whose schema accepts any value is rejected.
- A component loaded with `Catalog.fromJson` keeps a property it declares itself over one a mixin such as `ComponentCommon` or `Checkable`, or a local definition, also declares, in both its Zod schema and `validationSchema`.
- A component loaded with `Catalog.fromJson` treats `catalogId` as an envelope key like `id` and `component`: its Zod schema no longer declares it, as `validationSchema` already did not. `PayloadValidator` still accepts a component that carries it.
- `MessageProcessor.getRendererCapabilities` sends each v1.0 inline catalog as its `toJson()` document, with the catalog's `catalogId` and a bare semantic version `protocolVersion`.
- **BREAKING CHANGE** (v1_0): Components and function calls that name no `catalogId` resolve against the surface's default catalog, and fail if the surface has none, instead of falling back to the first registered catalog. `SurfaceModel.defaultCatalog` may be undefined.
- **BREAKING CHANGE**: The deprecated `SurfaceModel.catalog` getter may return `undefined`, like `defaultCatalog`.
- **BREAKING CHANGE** (v1_0): A component update that names no `catalogId` resolves to the surface's default catalog, and fails if there is none. It no longer keeps the catalog of the component's earlier version. Surfaces below v1.0 keep the old behavior.
- **BREAKING CHANGE** (v1_0): `MessageProcessor` validates each function call against the catalog it resolves to, and rejects calls whose catalog cannot be resolved even when no `validationConfig` is set. These failures throw `A2uiCatalogError` (category `CatalogError`), not `A2uiValidationError`.
- **BREAKING CHANGE**: `DataContext.functionInvoker` throws `A2uiCatalogError` on a surface without a default catalog instead of returning `undefined`.
- **BREAKING CHANGE**: `DataContext` reports a function call whose catalog cannot be resolved (a named catalog the surface doesn't have, or no `catalogId` on a surface without a default catalog) on the surface error channel with code `CATALOG_ERROR` instead of `EXPRESSION_ERROR`. Every other evaluation failure, including a function missing from the catalog the call resolved to and an unknown system function, is still an `EXPRESSION_ERROR`.
- **BREAKING CHANGE**: `DataContext` ignores a `catalogId` on a function call below v1.0 and runs the call in the surface catalog. Only v1.0 lets a call select its catalog; a v0.9 surface has one catalog, fixed by `createSurface`.
- **BREAKING CHANGE**: `DataContext.isV10` is renamed to `DataContext.atLeastV10`, since it is true for v1.0 and every later version. The old name is removed.
- **BREAKING CHANGE**: `ComponentModel.catalog` and the constructor's `catalog` argument are required. `MessageProcessor` resolves a component's catalog before it builds the model, and throws `A2uiCatalogError` if it can't, so a model never exists without one. `NodeResolver`, `A2uiLitElement` and `renderA2uiNode` resolve a component against its own catalog only, and no longer fall back to the surface default catalog when it is missing or declares no components. `renderA2uiNode` takes a `Catalog` again, not `undefined`.
- Add `SurfaceModel.protocolVersion` and a `protocolVersion` constructor argument for surfaces without a default catalog. The version is stored as `vMAJOR.MINOR` (for example `v1.0`), whether it came from a catalog (`1.0`) or a message (`v1.0`).
- (v1_0) A function call that names no `catalogId` runs in the surface's default catalog, so a `PayloadValidator` fully checks a nested call when it runs in the validator's catalog: when it names that catalog, or names no `catalogId` and the component is in the surface default. Called directly, the validator takes a component that names no `catalogId` to be in the surface default. `MessageProcessor` instead decides by whether the catalog the component resolved to is the surface's default catalog, so a component that names the surface default explicitly has its catalogless calls checked against it, like one that names no catalog. Any other call runs in a catalog the validator can't see, so only its envelope is checked: function and argument identifiers, and `args` must be an object; `MessageProcessor` resolves each such call's catalog on the surface and checks it there. A non-string `catalogId` on a call is rejected with `A2uiValidationError`. Nested calls are checked even in a component whose type the catalog doesn't define, when `allowUnknownElements` (or no `validationConfig`) lets that component through. Add `SurfaceModel.resolveCatalog`, which `MessageProcessor` and `DataContext` both use to resolve a `catalogId`, so validation and execution report the same catalog errors. A component naming an unknown catalog now fails with `Catalog not found: <id>`.
- (v1_0) A component or function call whose `catalogId` is the empty string names a catalog, as at runtime, so `MessageProcessor` rejects it with `A2uiCatalogError` instead of resolving it to the surface default, and a `PayloadValidator` checks only the call's identifiers.
- (v1_0) `@index` and other reserved `@`-prefixed system functions belong to no catalog: they validate and run on a surface without a default catalog, and never go through catalog resolution. A `PayloadValidator` validates them against the system functions rather than its catalog, and rejects a system function call that names a `catalogId`; `DataContext` reports such a call, whatever the `catalogId`'s value, as an `EXPRESSION_ERROR` instead of running it. The `@index` `offset` argument accepts a path or a function call, as its DynamicNumber type allows, instead of failing validation.
- (v1_0) A nested call with an empty `@call` name is rejected as an invalid identifier by `PayloadValidator` and `MessageProcessor` instead of being skipped.
- `PayloadValidator` checks function calls nested under property keys named `id` or `component`, which it used to skip. Below v1.0 it validates a nested call that names a `catalogId` against its catalog instead of skipping it, since a v0.9 call runs in the surface catalog whatever `catalogId` it carries.
- `NodeResolver` resolves each component against its own model's catalog, and its `catalog` argument is optional and may be undefined, so surfaces without a default catalog render.
- **BREAKING CHANGE**: Every class the basic catalog elements render now carries the `a2ui-` prefix, so an application's own `.error`, `.active`, `.container` or similar rules no longer match element internals ([#3169](https://github.com/a2ui-project/a2ui/pull/3169)). `TextField` validation messages now render `a2ui-error-message` like the other inputs.

  | Component                      | Before                                               | After                               |
  | ------------------------------ | ---------------------------------------------------- | ----------------------------------- |
  | All inputs (validation errors) | `error a2ui-error-message`                           | `a2ui-error-message`                |
  | `Button`                       | `a2ui-button <variant> a2ui-button-<variant>`        | `a2ui-button a2ui-button-<variant>` |
  | `CheckBox`                     | `container`                                          | `a2ui-checkbox-container`           |
  | `CheckBox`, `TextField`        | `invalid`                                            | `a2ui-invalid`                      |
  | `ChoicePicker`                 | `options a2ui-options-group`                         | `a2ui-options-group`                |
  | `ChoicePicker`                 | `chips a2ui-chips-group`                             | `a2ui-chips-group`                  |
  | `ChoicePicker`                 | `a2ui-chip chip`                                     | `a2ui-chip`                         |
  | `ChoicePicker`                 | `active selected` (on a chip)                        | `a2ui-chip-selected`                |
  | `ChoicePicker`                 | `filter-input`                                       | `a2ui-filter-input`                 |
  | `Divider`                      | `horizontal` / `vertical`                            | `a2ui-divider-<axis>`               |
  | `Icon`                         | `svg`                                                | `a2ui-icon-svg`                     |
  | `Image`                        | `a2ui-image <variant>`                               | `a2ui-image a2ui-image-<variant>`   |
  | `List`                         | `a2ui-list <direction>`                              | `a2ui-list a2ui-list-<direction>`   |
  | `Tabs`                         | `active`                                             | `a2ui-tab-button-active`            |
  | `Text`                         | `a2ui-text <variant>` (and the `.a2ui-caption` rule) | `a2ui-text a2ui-text-<variant>`     |

## 0.13.0

- (v1_0) The basic catalog's `and`, `or` and `not` read a ValidationResult operand by its `valid` member instead of treating every object as truthy, so the v1.0 specification's nested `and(required, or(required, required))` check is false when a field is empty. The v0.9 catalog keeps JavaScript truthiness, since its validators return booleans. `createAndImplementation`, `createOrImplementation` and `createNotImplementation` accept a `truthy` option, and `executeAnd`, `executeOr` and `executeNot` a `truthy` argument.
- `formatDate` returns an empty string for a date that does not exist, such as `2026-02-30`, instead of rolling it into the next month. `parseTimestamp` returns null when the written fields do not survive parsing.

- **BREAKING CHANGE**: `ComponentModel.componentTree` names the component under `component`, as an `updateComponents` message does, instead of `type`, and writes `id`, `component` and `metadata` after the component's properties. A property named `type` no longer replaces the component's type in the tree, and is kept. Read the component's type from `tree.component`. `SurfaceComponentsModel.getChildReferences` reads that same tree, so a property named `component` or `id` no longer replaces the model's own when child references are found ([#2930](https://github.com/a2ui-project/a2ui/pull/2930)).

- (v1_0) The path syntax and function call depth checks in `validateRecursionAndPaths` also read `@path` and `@call`. A v1.0 payload with a malformed `@path`, or with `@call` expressions nested deeper than the limit, used to pass validation ([#3013](https://github.com/a2ui-project/a2ui/pull/3013)).
- Fix `renderA2uiNode` so that re-rendering a parent keeps its existing child elements instead of recreating them; stateful children such as maps no longer reload when a sibling is added. `renderA2uiNode` now returns a Lit directive result instead of a static-html template result. [#2959](https://github.com/a2ui-project/a2ui/pull/2959)
- Fix a memory leak in universal elements where `A2uiController.dispose()` left its `componentsModel.onCreated` and binder subscriptions attached, and avoid recreating `A2uiController` in `A2uiLitElement.willUpdate` when an incoming `ComponentContext` binds the same component and data path ([#2972](https://github.com/a2ui-project/a2ui/pull/2972)).
- Add `CatalogApi`, the name for a schema-only `Catalog<ComponentApi, FunctionApi>`, which `Catalog.fromSchema` now returns. [#2900](https://github.com/a2ui-project/a2ui/issues/2900)
- (v1_0) Support reserved protocol key prefix (`@path`, `@call`), dynamic prefix doubling unescaping (`@@path` → `@path`), and unknown single-`@` key validation in v1.0 dynamic resolution while maintaining multi-version support for v0.8 and v0.9 ([#2692](https://github.com/a2ui-project/a2ui/issues/2692)).
- Fix `ResolveA2uiProp` resolving props declared as `Record<string, unknown>` (for example `z.record(z.unknown())`) to action thunks instead of their data type: every object type is assignable to the `{functionCall?: any}` member of `ActionLike`, so object types with a string index signature are now treated as data. [#2939](https://github.com/a2ui-project/a2ui/pull/2939)
- Add `ComponentNode.id`, a string unique across the document and stable for the node's lifetime, for renderers and components to use as a rendering key or as the base of DOM `id`s and accessibility references. [#2887](https://github.com/a2ui-project/a2ui/pull/2887)
- `Catalog.catalogSchema` fills `$defs` with the standard definitions of the catalog's own protocol version. It used the v0.9 definitions for every catalog, so a v1.0 catalog got v0.9 shapes for types such as `DynamicString`, `FunctionCall` and `Action`, and no definition for `Child`. `generateCatalogSchema` now falls back to the catalog's `protocolVersion` when no `protocolVersion` option is given. A version at or above 1.0 with no definitions of its own, such as 1.0.1 or 1.1, uses the v1.0 definitions.
- Universal elements accept an optional `node` (`A2uiWebComponentElement.node`): `A2uiLitElement` takes its `context` from it and passes each child its own node, and `renderA2uiNode` accepts a `ComponentNode`. `context` remains supported, so parents can move to nodes one at a time. [#2880](https://github.com/a2ui-project/a2ui/pull/2880)
- Expose `ComponentNode.context`, the context the resolver bound the node with (undefined on placeholders). [#2879](https://github.com/a2ui-project/a2ui/pull/2879)
- (v0_9) Basic catalog component styles now survive Closure-optimized builds.
  The `static styles` of each component are marked `/** @nocollapse */`
  ([#2869](https://github.com/a2ui-project/a2ui/pull/2869)).
- Include `FunctionCall` and `@call` expressions in dynamic setter typing (`DynamicTypes` and `IsDynamic`), ensuring `GenerateSetters` continues to fall back to `unknown` for binding-only properties following the `@` prefix protocol migration ([#2749](https://github.com/a2ui-project/a2ui/pull/2749), [#2886](https://github.com/a2ui-project/a2ui/pull/2886)).
- Fix the setter `GenericBinder` generates for a property declared as a binding with no literal branch: its parameter resolved to `never`, making the setter uncallable. It now falls back to `unknown`, matching the fallback `ResolveA2uiProp` already applies to the resolved property ([#2529](https://github.com/a2ui-project/a2ui/pull/2529)).
- `Catalog.fromSchema` no longer drops properties mixed in through an external
  `allOf` reference, so Checkable components in the basic catalogs now accept
  `checks`.
- (v1_0) `Catalog.fromSchema` resolves `common_types.json#/$defs/Child`, so
  single-child properties such as `Card.child` are now recognised as child
  references.
- `ExpressionParser` accepts number literals with a leading decimal point
  (`.5`, `-.5`, `+.5`, `.5e2`), including as function-call arguments. `.foo`
  and `./x` are still paths.
- `ExpressionParser` rejects a number literal outside the double range, such as
  `1e999`, with `Number literal is out of range`. It used to return `Infinity`,
  which JSON can't represent.
- Support non-ASCII Unicode characters in template expressions and data model keys (such as `${señor}`, `${café/precio}`, and `${日本}`) ([#2500](https://github.com/a2ui-project/a2ui/issues/2500), [#2527](https://github.com/a2ui-project/a2ui/pull/2527)).
- Mitigate ReDoS vulnerabilities in regex validation by introducing a pattern complexity checker (`safe_regex`), instantly rejecting unsafe nested repetitions, and enforcing length limits (256 characters for pattern, 4096 characters for input) ([#2292](https://github.com/a2ui-project/a2ui/issues/2292), [#2366](https://github.com/a2ui-project/a2ui/pull/2366)).
- (v1_0) Add v1.0 basic catalog custom elements under `@a2ui/web_core/catalogs/basic/v1` and universal runtime exports under `./v1_0/universal` ([#2859](https://github.com/a2ui-project/a2ui/pull/2859)).
- Enforce `requiresUserActivation` on functions: `openUrl` throws `A2uiExpressionError(USER_ACTIVATION_REQUIRED)` when evaluated passively in a signal binding or without a user activation gesture ([#2859](https://github.com/a2ui-project/a2ui/pull/2859)).
- Apply accessibility properties (`aria-label`, `aria-description`, `aria-live`, `aria-hidden`) to universal host elements and render validation errors on basic catalog input components ([#2859](https://github.com/a2ui-project/a2ui/pull/2859)).
- `GenericBinder` action closures now return `Promise<void>` and await async `functionCall` actions, enabling callers to detect when action handling settles ([#2907](https://github.com/a2ui-project/a2ui/pull/2907)).
- Avoid direct `window.open` property check in `openUrl` to prevent errors in security-restricted environments ([#2974](https://github.com/a2ui-project/a2ui/pull/2974)).
- Enforce `noImplicitOverride: true` and forbid self-package imports ([#2878](https://github.com/a2ui-project/a2ui/pull/2878)).

## 0.12.0

- Fix: Execute component `functionCall` actions locally via catalog functions at invocation time instead of emitting them as `onAction` events, aligning with the A2UI specification for local actions ([#2837](https://github.com/a2ui-project/a2ui/issues/2837)).
- **BREAKING CHANGE**: The package directory moved from `renderers/web_core/` to `typescript/core/web_core/`.
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

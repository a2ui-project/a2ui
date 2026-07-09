## Unreleased

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

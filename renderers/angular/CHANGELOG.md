## Unreleased

## 0.10.3

- (v0_9) Export Angular test utilities under `@a2ui/angular/testing` and secondary entry point `@a2ui/angular/v0_9/testing`. [#1737](https://github.com/a2ui-project/a2ui/pull/1737)

## 0.10.2

- (v0_9) Align with signal implementation changes in `@a2ui/web_core`.

## 0.10.1

- (v0_8) Export `MarkdownRenderer` in public API of v0.8. [#1658](https://github.com/a2ui-project/a2ui/pull/1658)
- (v0_9) Fix null de-referencing TypeError in `ComponentBinder` when `children` property is null or undefined. [#1472](https://github.com/a2ui-project/a2ui/pull/1472)
- (v0_8) Fix Icon component to handle camelCase and TitleCase names by converting them to snake_case for `g-icon`.
- (v0_8) Fix Modal component styling and position fixed for overlay.
- (v0_9) Remove `placeholder` prop support from the `TextField` component, since it was not part of the v0_9 basic catalog schema. [#1372](https://github.com/a2ui-project/a2ui/pull/1372)
- (v0_9) Preserve `checks` property in `ExtendedProps` type. [#1523](https://github.com/a2ui-project/a2ui/pull/1523)

## 0.10.0

- **BREAKING CHANGE**: (v0_9) Rename Icon `path` property to `svgPath` to fix type collision and avoid forced casts.
- **BREAKING CHANGE**: `BoundProperty.raw` is now `unknown` instead of `any`. Recommended migration: replace `raw` access with typed sibling fields where available (e.g. use the new `template` field instead of `raw.componentId`/`raw.path`). [#1312](https://github.com/a2ui-project/a2ui/pull/1312)
- **BREAKING CHANGE**: `BoundProperty<T = unknown>`: the default generic is now `unknown` instead of `any`. Recommended migration: provide explicit type arguments (e.g. `BoundProperty<string>`) at usage sites that previously relied on the default. Code typed via `ComponentApiToProps<Api>` is unaffected. [#1312](https://github.com/a2ui-project/a2ui/pull/1312)
- `props()['children']?.value()` is now typed `Child[]` (was `Child`, despite runtime always returning an array). [#1312](https://github.com/a2ui-project/a2ui/pull/1312)
- (v0_9) Improve type safety of `props()` in Catalog components. Custom catalog
  components should extend the base class `CatalogComponent` from
  `import {CatalogComponent} from '@a2ui/web_core/v0_9/'` or implement the
  interface `CatalogComponentInstance`. [#1320](https://github.com/a2ui-project/a2ui/pull/1320)

## 0.9.1

- (v0_9) Re-style the v0_9 catalog components using the default theme from
  `web_core`. [#1166](https://github.com/a2ui-project/a2ui/pull/1166)

## 0.8.5

- Handle `TextField.type` renamed to `TextField.textFieldType`.

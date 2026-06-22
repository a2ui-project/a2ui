## Unreleased

## 0.10.1

- (v0_9) Tighten resolved child list types in the basic catalog layout components.
- (v0_9) Narrow `A2uiChildRef` to the supported child reference shapes used by
  `renderNode`.
- (v0_9) Add missing CSS classes to the `Modal`, `Tabs` components to align with the Angular implementation and
  integration tests.
- (v0_9) Avoid rendering an `A2uiLitElement` when its surface is disposed of or the component is removed.
- (v0_9) Fix `DateTimeInput` to correctly render `datetime-local`, `date` and `time` input types.

## 0.10.0

- **BREAKING CHANGE**: (v0_9) Rename Icon `path` property to `svgPath` and update component to correctly render SVG elements.
- (v0_9) Wire up agent-provided primary color to basic catalog components.

## 0.9.1

- (v0_9) Re-style the v0_9 catalog components using the default theme from
  `web_core`. [#1079](https://github.com/a2ui-project/a2ui/pull/1079)
- (v0_9) Add missing features to ChoicePicker and CheckBox. [#1145](https://github.com/a2ui-project/a2ui/pull/1145)

## 0.9.0

- (v0_9) Modify Text widget from the basic catalog to support markdown.
- (v0_9) Add `Context.markdown` to the public API
- (CI) Fix post-build script. This pins the dependency on `@a2ui/web_core` to
  the latest available in the repo when publishing.

## 0.8.4

- Add a `v0_9` renderer. Import from `@a2ui/lit/v0_9`.

## 0.8.3

- Prepare to land a `v0_9` renderer.
  - Expose a `v0_8` entrypoint for the package. Users should prefer importing
    from `@a2ui/lit/v0_8`.
  - Mark the old `v0_8` namespace (from the root of the package) as deprecated.

## 0.8.2

- Handle `TextField.type` renamed to `TextField.textFieldType`.

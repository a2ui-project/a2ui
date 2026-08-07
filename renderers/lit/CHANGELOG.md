## Unreleased

- (v0_9) Move Basic Catalog components to `@a2ui/web_core` as universal Web Components.
- (v0_9) Align Basic Catalog component behaviors and styling contracts with the Angular reference implementation:
  - `TextField`: Render all validation error messages in `validationErrors` instead of only the first error, and ensure full-width container styling (`width: 100%`, `box-sizing: border-box`).
  - `DateTimeInput`: Add `width: 100%` container styling and `box-sizing: border-box` input sizing.
  - `Column`: Add `width: 100%` container styling to ensure consistent flex layout distribution.
  - `Image`: Remove default `width: 100%` constraint on `img` elements to preserve intrinsic aspect ratios and support explicit layout sizing.
  - `Modal`: Migrate from native `<dialog>` to an overlay container (`.a2ui-modal-overlay`, `.a2ui-modal-content`) managed with explicit `@state() isOpen` lifecycle tracking, standard backdrop theming (`--a2ui-modal-backdrop-bg`), accessible dialog ARIA attributes (`role="dialog"`, `aria-modal="true"`), and an accessible close button (`aria-label="Close"`).
  - `Text`: Wrap caption variant (`variant: 'caption'`) typography in `<em>` elements for default italic styling.
- (v0_9) Migrate Basic Catalog components and surface rendering from Shadow DOM to Light DOM.

## 0.10.3

- Enable `inlineSources` in `tsconfig.json` to populate `sourcesContent` in sourcemaps.

## 0.10.2

- (v0_9) Normalize Safari placeholder text color for `DateTimeInput` by updating CSS selectors for `.a2ui-date-time-input`.

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

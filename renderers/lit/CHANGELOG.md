## Unreleased

- (v0_9) Move universal basic catalog component implementations (`A2uiText`, `A2uiButton`, `A2uiCard`, etc.) to `@a2ui/web_core/v0_9/basic_catalog` and re-export them from `@a2ui/lit/v0_9` and `@a2ui/lit/v0_9/catalogs/basic` for backwards compatibility. [#2190](https://github.com/a2ui-project/a2ui/pull/2190)
- **BREAKING CHANGE**: (v0_9) Align Basic Catalog component DOM structures, behaviors, and styling contracts with the Angular reference implementation: [#2205](https://github.com/a2ui-project/a2ui/pull/2205)
  - `DateTimeInput`: Migrate from a single dynamic HTML5 input (`datetime-local`) to dual side-by-side date and time inputs (`.a2ui-date-time-inputs`), support overridable `--a2ui-datetimeinput-width`, and ensure time-only mode preserves time-only strings without invalid date concatenation.
  - `Modal`: Migrate from native `<dialog>` element to an overlay container (`.a2ui-modal-overlay`, `.a2ui-modal-content`) managed with explicit `@state() isOpen` lifecycle tracking, backdrop theming (`--a2ui-modal-backdrop-bg`), and accessible ARIA dialog roles.
  - `Image`: Remove default `width: 100%` constraint on `img` elements to preserve intrinsic aspect ratios and align `fit` default with container layouts.
  - `Button`: Replace hardcoded disabled button hex colors with `opacity: 0.5; cursor: not-allowed;` so disabled buttons react dynamically to theme backgrounds.
  - `TextField`: Render all validation error messages in `validationErrors` instead of only the first error, simplify input change handling, and support full-width container styling (`width: var(--a2ui-textfield-width, 100%)`, `box-sizing: border-box`).
  - `Column`: Add consistent flex layout distribution and strict alignment mappings.
  - `Row`, `Column`, `List`: Use Lit `repeat` directive with key extractors to ensure child elements are tracked by key and DOM nodes are preserved across reordering operations.
  - `Tabs`: Reset `activeIndex` to 0 in `willUpdate` when the `tabs` array changes dynamically and index is out of bounds.
  - `Text`: Directly render semantic HTML tags for non-markdown variants (`h1`-`h5`, `caption` wrapped in `<em>`) and add flex weight styling.
  - `Video`: Wrap video in `.a2ui-video-container` with fallback message for unsupported browsers.
  - `ChoicePicker`: Align DOM structures and CSS classes with the Angular reference implementation (`.a2ui-choice-picker`, `.a2ui-option-label`, `.a2ui-option-text`, `.a2ui-chip`, `type="button"`), scope radio input `name` attributes to surface and data context path to prevent cross-surface radio collisions in Light DOM, and omit `name` attributes on checkbox inputs.

## 0.10.4

- **BREAKING CHANGE**: (v0_9) Migrate Basic Catalog components and surface rendering from Shadow DOM to Light DOM. Recommended migration: query component elements directly using Light DOM selectors (e.g. `element.querySelector()`) rather than `element.shadowRoot`, and ensure global stylesheets do not unintentionally conflict with component internal class names. [#2204](https://github.com/a2ui-project/a2ui/pull/2204)

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

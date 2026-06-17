## Unreleased

## 0.10.1

- (v0_9) Tighten resolved child list types in the basic catalog layout components.
- (v0_9) Render known Text variants (h1–h5, caption) with declarative HTML instead of Markdown. [#1516](https://github.com/a2ui-project/a2ui/issues/1516)
- (v0_9) Add missing CSS classes to `Modal`, `Tabs`, `Card` and `ChoicePicker` to align with the
  Angular and Lit implementations and integration tests.
- (v0_9) Fix `DateTimeInput` to correctly render `datetime-local`, `date` and `time` input types.

## 0.10.0

- **BREAKING CHANGE**: (v0_9) Rename Icon `path` property to `svgPath` and update component to correctly render SVG elements.
- (v0_8) Exclude SVG elements and descendants from CSS reset to restore SVG rendering. [#1252](https://github.com/a2ui-project/a2ui/pull/1252)
- Added license.

## 0.9.1

- **BREAKING CHANGE**: Renamed `createReactComponent` to `createComponentImplementation`.
- **BREAKING CHANGE**: Renamed `createBinderlessComponent` to `createBinderlessComponentImplementation`.
- **BREAKING CHANGE**: Removed `minimalCatalog`.
- (v0_9) Re-style the v0_9 catalog components using the default theme from
  `web_core`. [#1205](https://github.com/a2ui-project/a2ui/pull/1205)

## 0.8.1

- Use the `InferredComponentApiSchemaType` from `web_core` in `createComponentImplementation`.
- Adjust internal type in `Tabs` widget.

## 0.8.0

- Initial release.

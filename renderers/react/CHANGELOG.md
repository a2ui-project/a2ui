## Unreleased

## 0.13.0

- Bump dependencies for compatibility with `@a2ui/web_core: ^0.13.0`.
- Migrate package root `@a2ui/react` to export the version-agnostic renderer runtime (`A2uiSurface`, `createComponentImplementation`, `createBinderlessComponentImplementation`, `useSignalValue`, `MarkdownContext`, `useMarkdownRenderer`), while maintaining `@a2ui/react/v0_9` and `@a2ui/react/v0_8` secondary entry points.
  - **BREAKING CHANGE**: The package root no longer re-exports the v0.8 API (`export * from './v0_8/index'`). v0.8 consumers must import from `@a2ui/react/v0_8`.
- (v0_9) **BREAKING CHANGE**: `@a2ui/react/v0_9` no longer ships a React implementation of the basic catalog. Import `basicCatalog` and the individual components from `@a2ui/web_core/v0_9/basic_catalog` instead; they render as W3C Custom Elements. [#2630](https://github.com/a2ui-project/a2ui/pull/2630)
- (v0_9) **BREAKING CHANGE**: the basic catalog no longer server-renders, since custom elements produce no markup outside a browser. [#2630](https://github.com/a2ui-project/a2ui/pull/2630)
- **BREAKING CHANGE**: (v0_9) Every catalog component now renders inside a custom element (`<a2ui-react-<name>>`, `display: contents`). [#2849](https://github.com/a2ui-project/a2ui/pull/2849)
- (v0_9) `A2uiSurface` bridges the `MarkdownRenderer` from `MarkdownContext` to `@a2ui/web_core`'s `setMarkdownRenderer`, allowing universal Web Component text components to render markdown provided via React context ([#2910](https://github.com/a2ui-project/a2ui/pull/2910)).
- (v0_8) Protect `TextField` against ReDoS vulnerabilities by safely validating regex patterns before evaluation ([#2366](https://github.com/a2ui-project/a2ui/pull/2366)).
- Enforce `noImplicitOverride: true` and forbid self-package imports ([#2878](https://github.com/a2ui-project/a2ui/pull/2878)).

## 0.12.0

- Align with `@a2ui/web_core` multi-catalog and protocol versioning updates.
- Bump dependencies for compatibility with `@a2ui/web_core: ^0.12.0`.

## 0.11.1

- (v0_9) Fix `ChoicePicker` radio groups colliding across surfaces: the radio group `name` is now unique per rendered instance instead of derived from the surface-scoped component id ([#2447](https://github.com/a2ui-project/a2ui/issues/2447)).

## 0.11.0

- (v0_9) Component implementations may supply a `view` that renders from a resolved `ComponentNode` (see `NodeViewProps` and `useSignalValue`) ([#2077](https://github.com/a2ui-project/a2ui/pull/2077)).
- (v0_9) `A2uiSurface` renders through the node layer: each component re-renders only when its own data changes. Implementations without a `view` keep rendering through `render` ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- **BREAKING CHANGE**: (v0_9) On schema-marked references, `buildChild`'s `basePath` argument selects among the instances the payload creates; it no longer creates an instance at a caller-chosen path. The rendered notice for such a request names the paths where instances exist and reports `UNRESOLVED_CHILD_REFERENCE` through `onError` ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- **BREAKING CHANGE**: (v0_9) The raw-definition fallback and the `DeferredChild` export are removed. A child reference whose schema property carries no component-id marker renders an error notice naming the property and reports `UNRESOLVED_CHILD_REFERENCE` through `onError`, once per reference; mark the property with `componentId()` or `childList()`. The `ChildList` union is recognized by shape, and a plain array of component ids by its elements' markers ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) When a late child arrives, its parent re-renders once as the placeholder is replaced ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) The first render shows the loading state even for an already populated surface; content appears immediately after. Tests that assert on the very first render must wait for the next one ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) Subtrees `A2uiSurface` previously resolved at reveal time (a closed `Modal`'s content, inactive `Tabs` children) resolve with the rest of the tree, so their function calls run and their errors are reported at message-processing time ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).
- (v0_9) Unknown component types and cyclic references are reported through the surface's `onError`, once per component and data path while the condition persists; previously nothing was reported for them. The message for an unresolvable type now reads `Unknown component type: <type>` ([#2393](https://github.com/a2ui-project/a2ui/pull/2393)).

## 0.10.2

- (v0_9) Normalize Safari placeholder text color for `DateTimeInput` by injecting WebKit-specific styles via a global stylesheet and adding the `.a2ui-date-time-input` class.

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

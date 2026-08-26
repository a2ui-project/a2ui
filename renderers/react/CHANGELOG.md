## Unreleased

- (v0_9) Component implementations may supply a `view` that renders from a resolved `ComponentNode` (see `NodeViewProps` and `useSignalValue`) ([#2077](https://github.com/a2ui-project/a2ui/pull/2077)).
- (v0_9) `A2uiSurface` renders through the node layer: each component re-renders only when its own data changes. Implementations without a `view` keep rendering through `render`.
- **BREAKING CHANGE**: (v0_9) Remove the `DeferredChild` export. A child reference now renders only when the catalog schema marks the property as a component id, which `ComponentIdSchema` and the `componentId()` helper both do; a property that lost its marker (by replacing the schema's description) renders an error in place of the child instead of resolving it. Child lists are unaffected: the `ChildList` union is recognized by shape, and a plain array of component ids by its elements' markers. `buildChild`'s `basePath` argument selects among the instances the payload creates; it no longer creates an instance at a caller-chosen path.
- (v0_9) When a late child arrives, its parent re-renders once as the placeholder is replaced.
- (v0_9) The first render shows the loading state even for an already populated surface; content appears immediately after. Tests that assert on the very first render must wait for the next one.
- (v0_9) Subtrees `A2uiSurface` previously resolved at reveal time (a closed `Modal`'s content, inactive `Tabs` children) resolve with the rest of the tree, so their function calls run and their errors are reported at message-processing time.
- (v0_9) Unknown component types and cyclic references are reported through the surface's `onError`, once per component and data path while the condition persists; previously nothing was reported for them. The message for an unresolvable type now reads `Unknown component type: <type>`.
- (v0_9) Unresolved child references are reported through the surface's `onError` (`UNRESOLVED_CHILD_REFERENCE`), once per reference, and the rendered notice names the cause: a missing schema marker, a missing component, or a data path the payload never created.

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

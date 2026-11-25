---
codebase_path: typescript/renderers/react
associated_module: a2ui_framework_adapter
module_blueprint_commit: a641e84f2861d1ff068df7616e06d08bfd4d0a88
implemented_features:
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
  universal_custom_elements: 0d70f4407f3defb78f1fa5646868341536b7a29b
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **React Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference React renderer (`@a2ui/react`) for the A2UI ecosystem, built on the node resolution and universal custom elements layers of `@a2ui/web_core`.

- **Surface & Node Resolution (`A2uiSurface`, `NodeResolver`)**: `A2uiSurface` instantiates a `NodeResolver` for the target `SurfaceModel`, subscribes to `resolver.rootNode` via `useSyncExternalStore` and `effect`, and renders the resolved `ComponentNode` tree through `ChildElement`.
- **Node View & Property Binding (`useNodeView`, `NodeContent`)**: `useNodeView` subscribes to `node.props` and unwraps `ResolvedBinding` instances into value and `set<Prop>` pairs while indexing child `ComponentNode` instances for `buildChild`.
- **Universal Custom Elements (`ReactHostElement`, `HostedChildren`, `WebComponentNode`)**: Native React catalog components are wrapped as `ReactHostElement` custom elements (`toWebComponent`) and rendered into Light DOM slots via React portals (`HostedChildren`), allowing React components and universal W3C Custom Elements (`A2uiLitElement`) to interleave in any parent-child order.

## **Local Technical Decisions & Overrides**

- **Host accessibility (`src/catalog/react_host_element.ts`, `src/catalog/host_accessibility.ts`)**: `ReactWcHost` calls `bindHostAccessibility` from `@a2ui/web_core/universal` while connected, which applies the protocol accessibility attributes (`@accessibility` on v1.0, `accessibility` before v1.0): `aria-live`, `aria-hidden`, and `inert` on the host, and `aria-label` and `aria-description` on the element the component passes to `accessibilityRef`, or on the host as `role="group"` when it passes none. The `accessibilityRef` element also gets `aria-invalid` while a check fails, and `aria-describedby` pointing at the element passed to `validationErrorsRef` while there are errors. The internal `resolveAccessibilityProps` helper in `typescript/core/web_core/src/universal/host_accessibility.ts` checks `['@accessibility', 'accessibility']` without inspecting protocol version, so on a v1.0 component that declares a custom object-valued `accessibility` property and omits `@accessibility`, the host still reads that custom property as protocol accessibility attributes. This departs from [a2ui_framework_adapter.blueprint.md](../../../../modules/a2ui_framework_adapter.blueprint.md) §3 and [universal_custom_elements.blueprint.md](../../../../features/universal_custom_elements.blueprint.md) §5 in `24d1bf9c`, which limit the `accessibility` fallback to pre-1.0 surfaces. The helper reads the `accessibility` key for pre-1.0 surfaces and receives only resolved props, so it applies the same fallback on v1.0; a legacy bare v1.0 `accessibility` key does not depend on it because `componentPayloadState` in `typescript/core/web_core/src/catalog/component_envelope.ts` already moves that key to `@accessibility`.
- **Lazy extension metadata (`useNodeView`, `adapter.tsx`)**: `useNodeView` exposes `node.metadata` through a lazy getter and tracks `context.componentModel.metadata` and `.extensions` via a `Proxy`, so views that never read metadata do not re-render on metadata-only updates (`9055207b`). `createComponentImplementation` and `createBinderlessComponentImplementation` preserve static `impl.metadata`, and views read reactive surface metadata via `useA2uiSurface()` and `useSignalValue(surface.metadataSignal)`.
- **Unresolved placeholders without `fallbacks` API (`A2uiSurface`, `ChildElement`)**: `A2uiSurface` returns `null` before `rootNode` arrives and `ChildElement` returns `null` when `node.isPlaceholder || !node.impl`, taking no layout space (`28f0a416`). Neither `A2uiSurface` nor `@a2ui/web_core/universal`'s `renderA2uiNode` implements the optional `fallbacks` API from `32c03e3a`, which holds `module_blueprint_commit` at `a641e84f` and `universal_custom_elements` at `0d70f440`. The later commits are otherwise reflected: `cffceb18` (base-element accessibility wiring in `@a2ui/web_core/universal`) and `24d1bf9c` (`@accessibility` key) on `universal_custom_elements`, and `24d1bf9c` (`@`-prefixed envelope keys), `d56f84f9`, and `7fae1b76` (doc and catalog path updates) on the module blueprint. The one exception is the `24d1bf9c` pre-1.0 limit on the `accessibility` fallback, recorded under Host accessibility.
- **Adapter conformance skip (`tests/adapter_harness.tsx`)**: `tests/adapter_conformance.test.tsx` runs `core/accessibility.yaml`, `core/adapter_conformance.yaml`, and `adapter/adapter_conformance_v0_9.yaml`. `UNSUPPORTED` holds one key, `validation_results_error_disables_warning_allows/hints`, and the harness skips that entire case (including its `isValid`, `validationErrors`, and `validationResults` assertions) because the Web Basic Catalog `TextField` does not render optional `SHOULD` hints.
- **Portal-Backed Host Registry (`HostRegistry`)**: Each React host element registers with its nearest enclosing `HostOwner` so React context, error boundaries, and synthetic events flow through interleaved Web Components.
- **Deprecated `render`/`ReactRenderProps.context` path ([a2ui_framework_adapter.blueprint.md](../../../../modules/a2ui_framework_adapter.blueprint.md) exception until the next breaking release)**: `ReactComponentImplementation.render`, `ReactRenderProps`, `ReactRenderProps.context`, `ReactA2uiComponentProps.context`, and `ReactWcHost.context` remain as deprecated compatibility shims until the next breaking release; views render from `ComponentNode.props` via `view({node, buildChild})` and read the `SurfaceModel` from ambient `SurfaceContext` (`useA2uiSurface()`/`useSurface()`) and `HostOwner.surface`.
- **Bundling**: Packages output modules into CJS and ESM files via `tsup` and `wireit`.
- **Markdown component**: The basic catalog's `Text` is a web_core Lit element that reads one Markdown renderer for the page, a function that returns HTML. For `MarkdownComponentContext`, `A2uiSurface` registers a renderer that returns an `<a2ui-react-markdown>` element holding the Markdown in an attribute (`src/markdown_hosts.tsx`). The element registers under the nearest element React rendered above it, as React hosts do (`src/host_registry.ts`), and that element's `ChildElement` portals the component into it, so the component renders in the app's React tree.

## **Validation & Execution Recipes**

- **Test execution**: Run `yarn test` to trigger Vitest suites.
- **Styles check**: Ensure code standards compliance with `yarn lint`.
- **Formatting**: Auto-format layout files with `yarn format`.

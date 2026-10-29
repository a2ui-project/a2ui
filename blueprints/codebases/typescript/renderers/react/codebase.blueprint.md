---
codebase_path: typescript/renderers/react
associated_module: a2ui_framework_adapter
module_blueprint_commit: 2e3d9bc434a34ba25498a11e0bfba079b52dcf29
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
  universal_custom_elements: b1dd650750c6072b4a42f95b03420273d099965e
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **React Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference React renderer (`@a2ui/react`) for the A2UI ecosystem, built on the node resolution and universal custom elements layers of `@a2ui/web_core`.

- **Surface & Node Resolution (`A2uiSurface`, `NodeResolver`)**: `A2uiSurface` instantiates a `NodeResolver` for the target `SurfaceModel`, subscribes to `resolver.rootNode` via `useSignalValue` (`useSyncExternalStore`), and renders the resolved `ComponentNode` tree through `ChildElement`.
- **Node View & Property Binding (`useNodeView`, `NodeContent`)**: `useNodeView` subscribes to `node.props` and unwraps `ResolvedBinding` instances into value and `set<Prop>` pairs while indexing child `ComponentNode` instances for `buildChild`.
- **Universal Custom Elements (`ReactHostElement`, `HostedChildren`, `WebComponentNode`)**: Native React catalog components are wrapped as `ReactHostElement` custom elements (`toWebComponent`) and rendered into Light DOM slots via React portals (`HostedChildren`), allowing React components and universal W3C Custom Elements (`A2uiLitElement`) to interleave in any parent-child order.

## **Local Technical Decisions & Overrides**

- **Portal-Backed Host Registry (`HostRegistry`)**: Each React host element registers with its nearest enclosing `HostOwner` so React context, error boundaries, and synthetic events flow through interleaved Web Components.
- **Bundling**: Packages output modules into CJS and ESM files via `tsup` and `wireit`.
- **Markdown component**: The basic catalog's `Text` is a web_core Lit element that reads one Markdown renderer for the page, a function that returns HTML. For `MarkdownComponentContext`, `A2uiSurface` registers a renderer that returns an `<a2ui-react-markdown>` element holding the Markdown in an attribute (`src/markdown_hosts.tsx`). The element registers under the nearest element React rendered above it, as React hosts do (`src/host_registry.ts`), and that element's `ChildElement` portals the component into it, so the component renders in the app's React tree.

## **Validation & Execution Recipes**

- **Test execution**: Run `yarn test` to trigger Vitest suites.
- **Styles check**: Ensure code standards compliance with `yarn lint`.
- **Formatting**: Auto-format layout files with `yarn format`.

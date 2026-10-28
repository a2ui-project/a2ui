---
codebase_path: typescript/renderers/react
associated_module: a2ui_framework_adapter
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **React Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference React renderer for the A2UI ecosystem.

- **State Integration**: Uses standard React hooks to bridge and map Preact signals from the core layer.
- **Context propagation**: Instantiates hierarchical context (`ComponentContext.Provider`) to propagate relative bindings recursively down visual nodes.
- **Bundling**: Packages output modules into CJS and ESM files via `tsup`.

## **Local Technical Decisions & Overrides**

- **Synthetic Events & Throttling**: Throttles intense interactive value changes (e.g. keypress triggers on TextFields) directly within the adapter wrapper before committing updates to the state layer.
- **Markdown component**: The basic catalog's `Text` is a web_core Lit element that reads one Markdown renderer for the page, a function that returns HTML. For `MarkdownComponentContext`, `A2uiSurface` registers a renderer that returns an `<a2ui-react-markdown>` element holding the Markdown in an attribute (`src/markdown_hosts.tsx`). The element registers under the nearest element React rendered above it, as React hosts do (`src/host_registry.ts`), and that element's `ChildElement` portals the component into it, so the component renders in the app's React tree.

## **Validation & Execution Recipes**

- **Test execution**: Run `yarn test` to trigger vitest suites.
- **Styles check**: Ensure code standards compliance with `yarn lint`.
- **Formatting**: Auto-format layout files with `yarn format`.

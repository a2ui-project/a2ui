---
codebase_path: renderers/react
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

## **Validation & Execution Recipes**

- **Test execution**: Run `yarn test` to trigger vitest suites.
- **Styles check**: Ensure code standards compliance with `yarn lint`.
- **Formatting**: Auto-format layout files with `yarn format`.

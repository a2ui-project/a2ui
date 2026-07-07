---
codebase_path: renderers/lit
associated_module: a2ui_framework_adapter
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Lit Framework Adapter Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Lit-element Web Components renderer for A2UI.

- **Reactivity**: Converts reactive Preact Signals directly into custom Lit property updates using a specialized controller wrapper.
- **Context Mapping**: Employs Shadow DOM boundaries and element-based relative data path traversals.

## **Local Technical Decisions & Overrides**

- **Lazy Mounting**: Postpones active property subscriptions and events registration until components are connected to the document DOM.

## **Validation & Execution Recipes**

- **Test execution**: Run unit tests with `yarn test`.
- **Linting check**: Execute standard style lint audits with `yarn lint`.
- **Formatting**: Auto-format standard styles with `yarn format`.

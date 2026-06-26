---
name: a2ui-implement-feature-from-blueprint
description: Provides instructions on the blueprint-related aspects of implementing a feature in a specific codebase using its Feature Blueprint.
---

# A2UI Implement Feature from Blueprint Skill

This skill provides step-by-step instructions on how to use, reference, and update blueprints when implementing a feature (either optional or required) in a concrete codebase.

---

## **1. Implementation Workflow**

### **Step 1: Check Pre-requisites**

- Open the target codebase's `codebase.blueprint.md`.
- Verify that the feature is not already listed in `implemented_features`.
- Retrieve the corresponding Feature Blueprint from `blueprints/features/{YYYY_MM_DD}_{feature_name}.blueprint.md` (or `blueprints/features/archived/{YYYY_MM_DD}_{feature_name}.blueprint.md`).

### **Step 2: Load Context**

Before writing any code, load the following documents into your context:

1.  The **Feature Blueprint** (defines the requirements and test cases).
2.  The associated **Module Blueprint** (defines the language-agnostic interfaces and architecture).
3.  The local **Codebase Blueprint** (defines local architectural decisions, reactivity paradigms, and overrides).

### **Step 3: Create a Temporary Local Design**

- Write a temporary design document (placed in `<workspace_root>/.agents/scratch/` or similar, but **do not check it into version control**).
- Describe in detail how the feature's language-agnostic requirements map to the concrete language/framework of the codebase.
- Explicitly resolve how the reactivity (e.g., signals, streams, observables) and data flows will be wired.

### **Step 4: Execute the Implementation**

- Implement the code and write unit/integration tests matching the "Test Cases & Conformance" section of the Feature Blueprint.
- Verify that all local tests pass.

### **Step 5: Update the Codebase Blueprint**

- Open the codebase's `codebase.blueprint.md`.
- Add the feature name to the `implemented_features` list in the YAML frontmatter.
- Under `Technical Decisions & Overrides`, document any codebase-specific decisions or patterns adopted during the implementation.

### **Step 6: Run Blueprint Validation**

Ensure the repository blueprints remain consistent by running the validator:

```bash
python3 scripts/validate_blueprints.py
```

Fix any reference or naming errors before submitting a pull request.

---

## **2. Core Implementation & Architecture Tips**

When implementing features or developing SDK layers, always keep these critical architectural tips in mind to avoid common pitfalls:

- **Context Path Propagation**: In structural or layout components that render children dynamically (e.g. lists, columns, grids), ensure that the recursive child builder correctly propagates the scoped context path (e.g., `/restaurants/0`) to the children. Nested elements using relative property bindings must evaluate against their immediate parent's scoped path rather than the root context path.
- **Reactive Lifecycle & Memory Management**: To prevent severe memory leaks across framework adapters (especially in stateful or virtual DOM rendering loops):
  1.  **Lazy-Subscribe**: Only bind and subscribe to reactive data streams when the component is actually mounted or attached to the UI.
  2.  **Path Stability**: If a component's bound data path changes, always unsubscribe from the old path before subscribing to the new one.
  3.  **Strict Disposal**: Hook into the native framework unmount/destruction lifecycle to completely dispose of and unsubscribe all listeners and state subscriptions.
- **Value Reference Equality**: When updating property models or emitting resolved values, always emit a new object reference (shallow copy) on change. Declarative UI frameworks (such as React or Lit) rely on strict reference equality checks to detect changes; failing to copy will prevent components from re-rendering in response to data updates.

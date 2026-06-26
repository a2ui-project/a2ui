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

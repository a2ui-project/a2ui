---
name: a2ui-blueprint-maintenance
description: Manage the evolution, promotion, validation, and cleanup of specifications and blueprints across the workspace.
---

# A2UI Blueprint Maintenance Skill

This skill provides the administrative recipes for managing the lifecycle, evolution, validation, and archiving of blueprints to keep the workspace specifications clean and accurate.

---

## **1. Lifecycle & Archiving Recipes**

### **Recipe A: Archiving a Completed Required Feature**
When a required feature is fully adopted and implemented across all active codebases:
1.  **Verify Parity**: Ensure that all codebases listed in the module's `associated_codebases` have successfully implemented the feature (listed in their `codebase.blueprint.md`).
2.  **Merge Specification**: Integrate the detailed requirements and behavior of the feature directly into the main text of the **Module Blueprint** (e.g. `blueprints/modules/a2ui_core.blueprint.md`). Add the feature's name to the module's `included_features` or similar list.
3.  **Archive the Feature Blueprint**: Move the feature blueprint file from `blueprints/features/` to the `blueprints/features/archived/` folder using git:
    ```bash
    git mv blueprints/features/YYYY_MM_DD_my_feature.blueprint.md blueprints/features/archived/
    ```
4.  **Run Validation**: Execute the validator to verify that references remain intact:
    ```bash
    python3 scripts/validate_blueprints.py
    ```

### **Recipe B: Handling Optional Features**
- **Promotion**: If an optional feature is promoted to be required, merge its requirements into the base Module Blueprint, update the module's `included_features`, and delete/archive the feature blueprint.
- **Deprecation**: If an optional feature is deprecated or abandoned, move its feature blueprint to `blueprints/features/archived/`.

---

## **2. Audit & Reconciliation Recipe**

Use this recipe to resolve inconsistencies between module blueprints and concrete implementations:

1.  **Identify Inconsistencies**: For a target module blueprint, search for all its associated codebase directories.
2.  **Compare Features**:
    - Identify any required features in the module blueprint that are missing from the codebase's `implemented_features`.
    - Detect any naming or API discrepancies (e.g. methods, structures) between the codebase implementation and the module blueprint.
3.  **Propose Action Plan**:
    - Update module blueprints to add details and reduce ambiguity.
    - Explicitly document language-specific overrides in the codebase's `codebase.blueprint.md` under `Technical Decisions & Overrides`.
    - Plan codebase updates to implement missing required features.

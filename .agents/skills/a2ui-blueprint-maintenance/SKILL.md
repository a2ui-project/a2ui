---
name: a2ui-blueprint-maintenance
description: Manage the evolution, promotion, validation, and cleanup of specifications and blueprints across the workspace.
---

# A2UI Blueprint Maintenance Skill

This skill provides the administrative recipes for managing the lifecycle, evolution, validation, and archiving of blueprints to keep the workspace specifications clean and accurate.

---

## **1. Lifecycle & Archiving Recipes**

### **Recipe A: Archiving a Feature Blueprint**

When a feature blueprint is ready to be archived (either because a required feature has been fully implemented across all active codebases, or because an optional feature is deprecated or abandoned):

1.  **Verify Eligibility**:
    - **For Required Features**: Ensure that all codebases listed in the module's `associated_codebases` have successfully implemented the feature (listed in their `codebase.blueprint.md` under `implemented_features`).
    - **For Optional Features**: Confirm that the feature is deprecated, abandoned, or no longer actively supported/needed.
2.  **Archive the Feature Blueprint**: Move the feature blueprint file from `blueprints/features/` to the `blueprints/features/archived/` folder using git:
    ```bash
    git mv blueprints/features/YYYY_MM_DD_my_feature.blueprint.md blueprints/features/archived/
    ```
    *(Note: There is no need to update the module blueprint during archiving. A required feature's requirements must have already been merged into the module blueprint when it was first introduced or promoted, and optional features are never merged.)*
3.  **Run Validation**: Execute the validator to verify that references remain intact:
    ```bash
    python3 scripts/validate_blueprints.py
    ```

### **Recipe B: Promoting an Optional Feature to Required**

When an optional feature is promoted to be required:

1.  **Merge Specification**: Integrate the detailed requirements and behavior of the feature directly into the main text of the **Module Blueprint** (e.g., `blueprints/modules/a2ui_core.blueprint.md`). Add the feature's name to the module's `included_features` or similar list.
2.  **Update Feature Blueprint**: Open the feature blueprint file (e.g., `blueprints/features/YYYY_MM_DD_my_feature.blueprint.md`) and update its YAML frontmatter to set `required: true`.
3.  **Do Not Archive Yet**: Keep the feature blueprint active in `blueprints/features/` (do **not** move it to the `archived/` folder yet). Because we tolerate incremental development, other codebases/SDKs may still need to implement it. It will remain in `blueprints/features/` until it has been implemented in all associated codebases, at which point it can be archived using **Recipe A**.
4.  **Run Validation**: Execute the validator to verify blueprint consistency:
    ```bash
    python3 scripts/validate_blueprints.py
    ```

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

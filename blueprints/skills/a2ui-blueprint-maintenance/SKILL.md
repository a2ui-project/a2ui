---
name: a2ui-blueprint-maintenance
description: Manage the evolution, merging, archiving, and cleanup of specifications and blueprints across the workspace.
---

# A2UI Blueprint Maintenance Skill

This skill provides administrative recipes for merging feature specifications into Module Blueprints and archiving feature blueprints.

---

## **1. Lifecycle & Archiving Recipes**

### **Recipe A: Merging & Archiving a Feature Blueprint (Promoting to Required)**

When a feature specification in `blueprints/features/<feature_name>.blueprint.md` is ready to be merged into its target Module Blueprint(s):

1. **Merge Specification into Module Blueprint**:
   - Open each target Module Blueprint listed under `module_blueprints` (e.g. `blueprints/modules/a2ui_core.blueprint.md`).
   - Integrate the feature's architectural rules, schemas, and behaviors into the module blueprint.
   - Do **NOT** add anything to an `included_features` list (module blueprints do not list included features).
2. **Archive the Feature Blueprint**:
   - Move the feature blueprint file into `blueprints/features/archived/`:
     ```bash
     git mv blueprints/features/<feature_name>.blueprint.md blueprints/features/archived/
     ```
   - Once in `blueprints/features/archived/`, the feature is permanently archived and its requirements are part of the module blueprint.
3. **Commit & Validate**:
   - Run the blueprint validator:
     ```bash
     python3 blueprints/validate_blueprints.py
     ```

### **Recipe B: Archiving Deprecated Optional Features**

If an optional feature in `blueprints/features/<feature_name>.blueprint.md` is deprecated or abandoned without being merged:

1. Move it to `blueprints/features/archived/<feature_name>.blueprint.md`.
2. Run validation to ensure repository consistency:
   ```bash
   python3 blueprints/validate_blueprints.py
   ```

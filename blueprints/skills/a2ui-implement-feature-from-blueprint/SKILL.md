---
name: a2ui-implement-feature-from-blueprint
description: Provides instructions on implementing feature specs or module blueprint commit diffs in a specific codebase.
---

# A2UI Implement Feature from Blueprint Skill

This skill provides step-by-step instructions on implementing feature specifications and updating codebase module compliance commit hashes.

---

## **1. Implementation Workflow**

### **Step 1: Check Codebase Status & Context**

- Open the target codebase's blueprint at `blueprints/codebases/<relative_path>/codebase.blueprint.md`.
- Identify the target `associated_module` and `module_blueprint_commit`.
- Check if the codebase needs to catch up to the latest Module Blueprint commit:
  ```bash
  git diff <module_blueprint_commit>..HEAD blueprints/modules/<associated_module>.blueprint.md
  ```
- If implementing an optional feature blueprint from `blueprints/features/<feature_name>.blueprint.md`, check its `dependencies` list first.

### **Step 2: Execute Implementation & Conformance Tests**

- Implement required code changes in the target codebase directory (`<relative_path>`).
- Run local unit and conformance tests specified by `test_command` in `codebase.blueprint.md`.

### **Step 3: Update Codebase Blueprint Compliance**

- Open `blueprints/codebases/<relative_path>/codebase.blueprint.md`.
- If you brought the codebase up to date with the latest Module Blueprint commit, update `module_blueprint_commit` to the current commit hash:
  ```bash
  git log -n 1 --pretty=format:%H blueprints/modules/<associated_module>.blueprint.md
  ```
- If you implemented an optional feature from `blueprints/features/`, add its name to `implemented_features`.

### **Step 4: Validate Blueprints**

Verify blueprint consistency across the monorepo:

```bash
python3 blueprints/validate_blueprints.py
```

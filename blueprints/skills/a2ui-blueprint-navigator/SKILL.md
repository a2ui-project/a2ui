---
name: a2ui-blueprint-navigator
description: Analytical navigation of A2UI Spec-Driven Development module and codebase blueprints.
---

# A2UI Blueprint Navigator Skill

This skill provides precise analytical methods and recipes for discovering blueprints, inspecting commit-hash compliance, and mapping language-agnostic specifications to physical directories in the monorepo.

---

## **1. Understanding Blueprints Layout**

Spec-Driven Development (SDD) in A2UI confines all specifications and compliance files inside `blueprints/`:

1. **Module Blueprints** (`blueprints/modules/`): Language-agnostic authorities specifying core architecture, APIs, types, and expected behaviors (e.g. `a2ui_core.blueprint.md`).
2. **Feature Blueprints** (`blueprints/features/`): Standalone optional feature specifications (`features/<name>.blueprint.md`) and merged required features (`features/archived/<name>.blueprint.md`).
3. **Codebase Blueprints** (`blueprints/codebases/<relative_codebase_path>/codebase.blueprint.md`): Local metadata trackers documenting codebase compliance with a specific git commit hash of its associated Module Blueprint (`module_blueprint_commit`).

---

## **2. Commit-Hash Module Compliance**

Rather than checking against a list of required feature names, a codebase's compliance status is tracked by the git commit hash of its associated Module Blueprint (`module_blueprint_commit`).

- When a feature is merged into a Module Blueprint (`blueprints/modules/<module>.blueprint.md`), the file's git commit hash advances.
- Codebase blueprints verify and update compliance by checking diffs against `module_blueprint_commit`.

---

## **3. Navigator Recipes**

### **Recipe A: Check if a Codebase is Up to Date with its Module Blueprint**

1. Open the codebase blueprint at `blueprints/codebases/<relative_path>/codebase.blueprint.md`.
2. Inspect `module_blueprint_commit` in the YAML frontmatter.
3. Retrieve the latest commit hash of the associated module blueprint:
   ```bash
   git log -n 1 --pretty=format:%H blueprints/modules/<associated_module>.blueprint.md
   ```
4. If `module_blueprint_commit` matches the latest commit hash, the codebase is up to date.
5. If they differ, inspect the exact specification diff that needs to be implemented:
   ```bash
   git diff <module_blueprint_commit>..HEAD blueprints/modules/<associated_module>.blueprint.md
   ```

### **Recipe B: Find the Module Blueprint for a Particular Codebase**

1. Locate the codebase blueprint at `blueprints/codebases/<relative_path>/codebase.blueprint.md`.
2. Look up `associated_module` in the frontmatter.
3. Open `blueprints/modules/<associated_module>.blueprint.md`.

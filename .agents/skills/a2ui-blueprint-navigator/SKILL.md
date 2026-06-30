---
name: a2ui-blueprint-navigator
description: analytical navigation of A2UI Spec-Driven Development module and codebase blueprints.
---

# A2UI Blueprint Navigator Skill

This skill provides precise analytical methods and recipes for discovering and validating blueprints, mapping how language-agnostic module and feature plans connect to physical directories in the monorepo.

---

## **1. Understanding Blueprints**

Spec-Driven Development (SDD) in A2UI separates language-agnostic definitions (what the protocol demands) from language-specific codebases (how a platform implements it):

1. **Module Blueprints** (`blueprints/modules/`): Language-agnostic authorities specifying core architecture, APIs, types, and expected behaviors (e.g. `a2ui_core`, `a2ui_inference`, `a2ui_framework_adapter`).
2. **Feature Blueprints** (`blueprints/features/`): Specifications for standalone optional or new required features during development.
3. **Codebase Blueprints** (`codebase.blueprint.md` in individual codebase roots): Local metadata trackers documenting structural details, local overrides, and compliant features.

---

## **2. Required vs. Optional Features**

Feature Blueprints describe specific behavioral changes or capabilities, categorized as follows:

- **Required Features**:
  - **Definition**: Features expected to be implemented in all codebases for the affected modules. The detailed specification of a required feature is merged into the base Module Blueprints of all affected modules when it is promoted/introduced.
  - **Incremental Implementation**: A "required" status does _not_ mean the feature is already implemented in every codebase. It indicates that all associated codebases _should_ implement it eventually. We explicitly tolerate inconsistency and support incremental development across different language SDKs and renderers.
  - **Archiving**: The feature blueprint remains active to guide incremental implementations, and is only moved to the `archived/` folder once all associated codebases have adopted it.

- **Optional Features**:
  - **Definition**: Features that are _not_ expected to be implemented in all codebases. They allow platforms to support framework-specific or experimental features without forcing compliance.
  - **Decoupled Lifecycle**: Optional feature blueprints remain standalone files in `blueprints/features/` and are never merged into the base Module Blueprints.
  - **Ad-hoc Support**: Each codebase independently decides whether to implement an optional feature based on platform capabilities. Supported optional features must be declared under `implemented_features` in the codebase's `codebase.blueprint.md`.

---

## **3. Navigator Recipes**

AI agents and human developers can use these recipes to navigate and query relations within the monorepo:

### **Recipe A: How to find the module blueprint for a particular codebase**

Use this recipe to understand which central module requirements a local folder must satisfy.

1.  **Locate Root**: Navigate to the directory of the target codebase (e.g. `renderers/react/` or `agent_sdks/python/a2ui_core/`).
2.  **Read Local Blueprint**: Open and parse the `codebase.blueprint.md` file in the root of that codebase.
3.  **Identify Parent Module**: Look up the `associated_module` key in the YAML frontmatter block (e.g. `associated_module: a2ui_framework_adapter`).
4.  **Open Module Spec**: Locate and open the module blueprint at `blueprints/modules/{associated_module}.blueprint.md` to see its full schema and requirements.

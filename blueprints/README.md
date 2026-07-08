# A2UI Spec-Driven Development Blueprints

> [!IMPORTANT]
> **INSTRUCTION FOR AI AGENTS:**
> **IGNORE THIS ENTIRE `blueprints/` FOLDER AND ALL FILES WITHIN IT** during normal coding, debugging, or feature implementation tasks, **UNLESS** the user explicitly specifies that they want to use blueprints or Spec-Driven Development (SDD), or unless you are explicitly asked to work on blueprint files.

---

## What is this directory?

This directory houses the language-agnostic specifications (**Blueprints**) for the A2UI repository under our Spec-Driven Development (SDD) methodology.

### Directory Layout

```
blueprints/
├── README.md                 # This file
├── validate_blueprints.py    # Python script to validate blueprint frontmatter and structure
├── link_skills.sh            # Helper script to symlink blueprint skills into .agents/skills/
├── modules/                  # Language-agnostic Module Blueprints (e.g. a2ui_core.blueprint.md)
├── features/                 # Standalone / Optional Feature Blueprints (unmerged)
│   └── archived/             # Merged Feature Blueprints (required capabilities merged into module blueprints)
├── codebases/                # Codebase Blueprints tracking module compliance by commit hash
└── skills/                   # SDD Agent Skills (isolated by default)
```

## Enabling Blueprint Skills (`link_skills.sh`)

By default, blueprint/SDD agent skills are kept inside `blueprints/skills/` so they do not clutter an AI agent's general skill set during standard coding or debugging tasks.

When you (or an agent) want to actively work with Spec-Driven Development or create/maintain blueprints, run:

```bash
./blueprints/link_skills.sh
```

This creates local symlinks from `blueprints/skills/<skill-name>` into `.agents/skills/<skill-name>`:

- `a2ui-blueprint-navigator`
- `a2ui-create-feature-blueprint`
- `a2ui-implement-feature-from-blueprint`
- `a2ui-blueprint-maintenance`

_(Note: These symlinks are ignored in `.gitignore`, so enabling them will not dirty your git working tree.)_

To disable or remove the symlinked skills when you are done working with blueprints, remove the symlinks from `.agents/skills/`:

```bash
rm -f .agents/skills/a2ui-blueprint-navigator \
      .agents/skills/a2ui-create-feature-blueprint \
      .agents/skills/a2ui-implement-feature-from-blueprint \
      .agents/skills/a2ui-blueprint-maintenance
```

## Spec-Driven Development Overview

- **Module Blueprints (`modules/`)**: Language-agnostic specifications defining core module architecture, interfaces, and behaviors.
- **Feature Blueprints (`features/`)**: Standalone specification files for new features. Features begin as optional specs in `features/<feature_name>.blueprint.md`. When merged into a Module Blueprint, the feature blueprint file is moved to `features/archived/<feature_name>.blueprint.md`.
- **Codebase Blueprints (`codebases/`)**: Track each concrete codebase implementation's compliance with its associated Module Blueprint at a specific git commit hash (`module_blueprint_commit`), along with any optional features it implements (`implemented_features`).

For full details on the SDD workflow, read [`specification/proposals/spec_driven_development.md`](../specification/proposals/spec_driven_development.md).

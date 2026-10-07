# A2UI Spec-Driven Development Blueprints

This directory houses the language-agnostic specifications (**Blueprints**) for the A2UI repository under our Spec-Driven Development (SDD) methodology.

### Directory Layout

```
blueprints/
├── README.md                 # This file
├── validate_blueprints.py    # Python script to validate blueprint frontmatter and structure
├── modules/                  # Language-agnostic Module Blueprints (e.g. a2ui_core.blueprint.md)
├── features/                 # Standalone / Optional Feature Blueprints (unmerged)
│   └── archived/             # Merged Feature Blueprints (required capabilities merged into module blueprints)
└── codebases/                # Codebase Blueprints tracking module compliance by commit hash
```

## First-Class Blueprint Skills

Spec-Driven Development agent skills are maintained as first-class tools in `.agents/skills/`:

- **[`a2ui-blueprint-navigator`](../.agents/skills/a2ui-blueprint-navigator/SKILL.md)**: Discovers blueprints, maps module specs to physical codebases, and checks commit-hash compliance.
- **[`a2ui-blueprint-compliance`](../.agents/skills/a2ui-blueprint-compliance/SKILL.md)**: Audits all platform codebases for module blueprint compliance and feature claim discrepancies.
- **[`a2ui-create-feature-blueprint`](../.agents/skills/a2ui-create-feature-blueprint/SKILL.md)**: Formats and designs new language-agnostic Feature Blueprints in `features/`.
- **[`a2ui-implement-feature-from-blueprint`](../.agents/skills/a2ui-implement-feature-from-blueprint/SKILL.md)**: Guides implementing blueprint specifications in a specific codebase.
- **[`a2ui-blueprint-maintenance`](../.agents/skills/a2ui-blueprint-maintenance/SKILL.md)**: Handles lifecycle management, merging feature specs into module blueprints, and archiving.

## Spec-Driven Development Overview

- **Module Blueprints (`modules/`)**: Language-agnostic specifications defining core module architecture, interfaces, and behaviors.
- **Feature Blueprints (`features/`)**: Standalone specification files for new features. Features begin as optional specs in `features/<feature_name>.blueprint.md`. When merged into a Module Blueprint, the feature blueprint file is moved to `features/archived/<feature_name>.blueprint.md`.
- **Codebase Blueprints (`codebases/`)**: Track each concrete codebase implementation's compliance with its associated Module Blueprint at a specific git commit hash (`module_blueprint_commit`), along with any optional features it implements (`implemented_features`).

For full details on the SDD workflow, read the [Spec-Driven Development Reference Guide](../.agents/skills/a2ui-blueprint-navigator/references/spec_driven_development.md).

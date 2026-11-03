---
name: coding-principles
description: >-
  Enforces engineering, architecture, public API, and code quality standards distilled from human
  reviewer feedback across A2UI pull requests. Use when authoring new code, refactoring, addressing
  review feedback, or reviewing PR diffs. Don't use for release publishing or spec blueprint
  generation without code or PR changes.
---

# Skill: coding-principles

**Purpose**: Core engineering, architecture, and code quality standards established by human reviewers across A2UI pull requests. Used by agents when authoring changes, refactoring code, addressing review feedback, or reviewing pull request diffs to maintain repository health across all languages.

---

## Specification and Blueprint Grounding

Before modifying or implementing code in any language, consult the authoritative specifications and blueprints:

- **Protocol JSON Schemas**: [`specification/v0_9_1/json/`](../../../specification/v0_9_1/json/) and [`specification/v1_0/json/`](../../../specification/v1_0/json/) define wire-format envelopes, types, and validation constraints.
- **Component Catalogs**: [`catalogs/basic/v1/catalog.json`](../../../catalogs/basic/v1/catalog.json) defines standard components, properties, and function signatures.
- **Core Module Blueprint**: [`a2ui_core.blueprint.md`](../../../blueprints/modules/a2ui_core.blueprint.md) specifies state containers (`DataModel`, `SurfaceModel`), `MessageProcessor`, JSON pointer rules, auto-vivification, and error semantics.
- **Agent SDK Blueprint**: [`a2ui_agent.blueprint.md`](../../../blueprints/modules/a2ui_agent.blueprint.md) specifies `A2uiGenerator`, `A2uiRequestProcessor`, inference format strategies, and prompt generation.
- **Framework Adapter Blueprint**: [`a2ui_framework_adapter.blueprint.md`](../../../blueprints/modules/a2ui_framework_adapter.blueprint.md) specifies view mapping, reactive subscription lifecycles, and layout behavior.
- **Typesafe Builder Blueprint**: [`typesafe_builder_api.blueprint.md`](../../../blueprints/features/typesafe_builder_api.blueprint.md) specifies fluent builder hierarchies.
- **Reference Implementation**: [`typescript/core/web_core/`](../../../typescript/core/web_core/) serves as the canonical behavioral reference for edge-case resolution.

---

## Progressive Discoverability: Two-Level Subskill Routing

Because the A2UI repository spans multiple languages (`typescript/`, `python/`, `dart/`, `swift/`) and shared specifications (`specification/`, `catalogs/`), agents must use a two-level progressive discovery workflow:

1. **Level 1 (Cross-Language Subskills)**: Activate language-agnostic principles that govern pull request scope, software design, public API boundaries, specification immutability, and changelogs across the entire monorepo.
2. **Level 2 (Language-Specific Routing)**: Route by the programming languages modified in the diff to load only the subskills and language guides relevant to those languages.

### Step 1: Inspect the PR Diff

Review the modified files and categories of changes:

```bash
# In an active branch:
git diff main --stat
```

Identify both:

- **Cross-cutting functional areas** impacted (public exports, specifications, catalogs, changelogs, PR structure).
- **Programming languages and directories** touched (`typescript/`, `python/`, `dart/`, `swift/`, `samples/`, `tools/`).

---

### Step 2: Activate Cross-Language Subskills (Language-Agnostic)

Evaluate the cross-language subskills below against the diff and read any activated document in full:

#### 1. PR Hygiene, Atomicity, Scope Control & Software Design

- **Skill**: [`pr-hygiene`](../pr-hygiene/SKILL.md)
- **Activate if**: Always applicable when authoring, preparing, or reviewing a pull request.

#### 2. Public API Boundaries, Cross-Framework Design & Changelogs

- **Document**: [`subskills/public-api-and-cross-framework-design.md`](subskills/public-api-and-cross-framework-design.md)
- **Activate if**:
  - Any package entrypoint or facade (`index.ts`, `public-api.ts`, `package.json`, `__init__.py`, `lib/*.dart`, or public Swift API), or any `CHANGELOG.md` is modified.
  - Any new class, function, interface, type, model, or DI token is exported.
  - Renderer APIs, registration helpers, or adapters across `@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`, `a2ui_flutter`, or `A2UISwiftUI` are modified.
  - Imports between sibling packages change.
  - Files under `specification/` or `catalogs/` (schemas, catalog fixtures, or examples) are modified or added.
  - Breaking changes or public API deprecations are introduced.
  - A new source file is added (verify it has a single responsibility rather than acting as a catch-all `types.*` or `utils.*` file).

#### 3. Updating Changelogs (`CHANGELOG.md`)

- **Skill**: [`update-changelog`](../update-changelog/SKILL.md)
- **Activate if**: Any `CHANGELOG.md` is modified or a published package's public API or consumer-observable behavior changes.

---

### Step 3: Route by Language for Language-Dependent Principles

Inspect the file extensions and directories in `git diff main --stat` and follow the matching language route(s) below. Only load routers and guides for languages present in your diff:

| Language / Ecosystem                                            | Matching Paths & Extensions                                                              | Progressive Discovery Target                                                                                                                                                                                                   |
| :-------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript & Web** (Lit, Angular, React, Web Core, CSS, HTML) | `*.ts`, `*.tsx`, `*.css`, `typescript/`, `samples/client/{lit,angular,react}/`, `tools/` | Read the TypeScript & Web router: [`subskills/typescript/INDEX.md`](subskills/typescript/INDEX.md) to activate specific TypeScript, reactive lifecycle, CSS theming, accessibility, DOM testing, and AST public API subskills. |
| **Python** (Core, Agent SDK, Builders, Evaluators, Scripts)     | `*.py`, `python/`, `eval/`, `samples/agent/`, `tools/`, `scripts/`                       | Read the Python router: [`subskills/python/INDEX.md`](subskills/python/INDEX.md) to activate Python package architecture, facade conventions, typing, and verification subskills.                                              |
| **Swift & SwiftUI** (Core, SwiftUI Adapter, iOS Sample)         | `*.swift`, `swift/`, `Package.swift`                                                     | Read the Swift & SwiftUI router: [`subskills/swift/INDEX.md`](subskills/swift/INDEX.md) to activate Swift target architecture, coding standards, and `Testing` subskills.                                                      |
| **Dart & Flutter** (Core, Agent SDK, Flutter Adapter)           | `*.dart`, `dart/`, `samples/client/flutter/`, `pubspec.yaml`                             | Read the Dart & Flutter router: [`subskills/dart/INDEX.md`](subskills/dart/INDEX.md) to activate Dart analyzer rules, package versioning, and changelog subskills.                                                             |

---

### Step 4: Progressively Load Activated Subskills

Read only the cross-language subskills activated in Step 2 and the language-specific subskills selected through Step 3 to evaluate your code against their rationales, checklists, and examples without loading unrelated language rules into context.

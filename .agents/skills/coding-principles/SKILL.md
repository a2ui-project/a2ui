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

## Progressive Discoverability: Two-Level Subskill Routing

Because the A2UI repository spans multiple languages (`typescript/`, `renderers/`, `python/`, `dart/`, `swift/`) and shared specifications (`specification/`, `catalogs/`), agents must use a two-level progressive discovery workflow:

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
- **Programming languages and directories** touched (`typescript/`, `renderers/`, `python/`, `dart/`, `swift/`, `samples/`, `tools/`).

---

### Step 2: Activate Cross-Language Subskills (Language-Agnostic)

Evaluate the cross-language subskills below against the diff and read any activated document in full:

#### 1. PR Hygiene, Atomicity, Scope Control & Software Design

- **Document**: [`subskills/pr-hygiene.md`](subskills/pr-hygiene.md)
- **Activate if**:
  - Always applicable when authoring, preparing, or reviewing a pull request.
  - The PR bundles new features with refactorings or non-essential cleanup.
  - The diff touches multiple unrelated areas that could be split or stacked.
  - Incidental edits to tooling, licenses, package manager scripts, or formatting are present.
  - New modules, abstractions, or comments are introduced (enforces deep modules, complexity reduction, and high-signal comments).

#### 2. Public API Boundaries, Cross-Framework Design & Changelogs

- **Document**: [`subskills/public-api-and-cross-framework-design.md`](subskills/public-api-and-cross-framework-design.md)
- **Activate if**:
  - Any package entrypoint or facade (`index.ts`, `public-api.ts`, `package.json`, `__init__.py`, `lib/*.dart`, or public Swift API), or any `CHANGELOG.md` is modified.
  - Any new class, function, interface, type, model, or DI token is exported.
  - Renderer APIs, registration helpers, or adapters across `@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`, `a2ui_flutter`, or `A2UISwiftUI` are modified.
  - Imports between sibling packages change.
  - Files under `specification/` or `catalogs/` (schemas, catalog fixtures, or examples) are modified or added.
  - Breaking changes or public API deprecations are introduced.
  - Sample client or explorer applications receive new navigation, hotkeys, or layout capabilities.
  - A new source file is added (verify it has a single responsibility rather than acting as a catch-all `types.*` or `utils.*` file).

---

### Step 3: Route by Language for Language-Dependent Principles

Inspect the file extensions and directories in `git diff main --stat` and follow the matching language route(s) below. Only load routers and guides for languages present in your diff:

| Language / Ecosystem                                            | Matching Paths & Extensions                                                                            | Progressive Discovery Target                                                                                                                                                                                                   |
| :-------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript & Web** (Lit, Angular, React, Web Core, CSS, HTML) | `*.ts`, `*.tsx`, `*.css`, `typescript/`, `renderers/`, `samples/client/{lit,angular,react}/`, `tools/` | Read the TypeScript & Web router: [`subskills/typescript/INDEX.md`](subskills/typescript/INDEX.md) to activate specific TypeScript, reactive lifecycle, CSS theming, accessibility, DOM testing, and AST public API subskills. |
| **Python** (Core, Agent SDK, Builders, Evaluators, Scripts)     | `*.py`, `python/`, `eval/`, `samples/agent/`, `tools/`, `scripts/`                                     | Read [`a2ui-python-development`](../a2ui-python-development/SKILL.md) (and [`a2ui-generate-pydantic-models`](../a2ui-generate-pydantic-models/SKILL.md) when modifying schema-generated Pydantic models).                      |
| **Swift & SwiftUI** (Core, SwiftUI Adapter, iOS Sample)         | `*.swift`, `swift/`, `Package.swift`                                                                   | Read [`a2ui-swift-development`](../a2ui-swift-development/SKILL.md).                                                                                                                                                           |
| **Dart & Flutter** (Core, Agent SDK, Flutter Adapter)           | `*.dart`, `dart/`, `samples/client/flutter/`, `pubspec.yaml`                                           | Read [`a2ui-dart-versioning`](../a2ui-dart-versioning/SKILL.md) when touching changelogs or package versions, and adhere to [`analysis_options.yaml`](../../../analysis_options.yaml).                                         |

---

### Step 4: Progressively Load Activated Subskills

Read only the cross-language subskills activated in Step 2 and the language-specific subskills selected through Step 3 to evaluate your code against their rationales, checklists, and examples without loading unrelated language rules into context.

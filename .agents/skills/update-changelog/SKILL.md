---
name: update-changelog
description: >-
  Updates CHANGELOG.md files across A2UI packages under the Unreleased heading, preserving version
  headers and annotating breaking API or behavioral changes. Use when adding or reviewing
  CHANGELOG.md entries for modified packages. Don't use for publishing packages without changelog
  edits.
---

# Skill: update-changelog

**Purpose**: Standard rules and language-aware routing for maintaining and updating `CHANGELOG.md` files across packages in the A2UI repository.

---

## Progressive Discoverability: Language-Specific Routing

Before editing a `CHANGELOG.md` file, check which language directory the modified package belongs to:

- **Dart / Flutter packages (`dart/*/CHANGELOG.md`)**:
  - Load and follow [`a2ui-dart-versioning`](../a2ui-dart-versioning/SKILL.md), which defines Dart-specific `Breaking:` annotations, `## Unreleased` consolidation rules, and `pubspec.yaml` versioning conventions.
- **Python packages (`python/*/CHANGELOG.md`)**:
  - Follow the core rules below for `## Unreleased` entries during feature or bugfix PRs. When cutting a Python package release, load [`a2ui-release-python`](../a2ui-release-python/SKILL.md).
- **TypeScript / Web packages (`typescript/*/CHANGELOG.md`, `renderers/*/CHANGELOG.md`)**:
  - Follow all core rules, formatting conventions, and workflows in this document.

---

## Core Rules

1. **Never Remove Existing Entries or Version Headers (Only Add)**:

   > [!CAUTION]
   > **Preserve All Existing Entries**: NEVER delete, overwrite, or clear existing items under `## Unreleased` or under past release sections. Other merged branches, concurrent PRs, or foundational commits have their own entries under `## Unreleased`. Only append or prepend your new entry, keeping all existing entries intact.

   > [!CAUTION]
   > **Preserve All Version Headers**: NEVER delete a `## <version>` heading (for example `## 0.10.6`). Removing one moves every entry beneath it into the section above, so released changes reappear as unreleased and that version's history is lost. This most often happens while resolving a merge conflict at the top of the file, or when inserting an entry overwrites the lines that follow `## Unreleased`. After any conflict resolution, re-read the top of the file and confirm the version headers are still present and in descending order.

2. **Always Target the `## Unreleased` Section**:
   - Place every new changelog entry under the top-level `## Unreleased` heading at the top of the modified package's `CHANGELOG.md` file.
   - If the `## Unreleased` heading does not exist, create it at the top of the file before the latest released version.
   - Never create or bump a version header (e.g. `## 0.10.6`) during feature or bugfix development unless explicitly executing a release workflow.

3. **Focus Exclusively on Public API Surface Changes**:
   - **DO Document**:
     - New or modified public exports, classes, functions, components, directives, traits, or services.
     - Additions, removals, or changes to component schemas, properties, inputs, outputs, or events.
     - Bug fixes that alter consumer-facing behavior, rendering output, or public type definitions.
     - Dependency changes affecting consumers (e.g. optional peer dependencies).
     - Breaking changes (marked prominently with `**BREAKING CHANGE**:`).
   - **DO NOT Document**:
     - Internal implementation details (e.g. private helper functions, internal variable renames, micro-optimizations).
     - Changes strictly confined to unit tests, integration tests, mock data, sample/explorer applications, or internal scripts.
     - Pure refactorings that preserve identical public API behavior and types.

4. **Clearly Annotate BREAKING CHANGE Entries**:

   > [!IMPORTANT]
   > **Mandatory `**BREAKING CHANGE**:` Annotation**:
   > Annotate entries with `**BREAKING CHANGE**:` whenever there is:
   >
   > 1. **Public API Surface Change**: Any removal, rename, or incompatible signature/type change in the public API surface of the library or package (e.g., exported functions, classes, interfaces, component schemas, properties, signatures, or public types).
   > 2. **Meaningful Behavioral Change**: Any meaningful change in behavior that is not purely an internal refactor (e.g., changes to default property values, alterations to DOM tree structure or class names, changes to CSS custom properties or styling inheritance contracts that consumers depend on, modifications to validation rules, or changes to event dispatch semantics).
   >
   > Provide a concise explanation of what changed, why, and a recommended migration note so consumers can upgrade cleanly.

5. **Be Concise and Complete**:
   - Prefix version-specific changes with the target protocol version (e.g. `(v0_9)` or `(v0_8)`) when working within multi-version renderers or packages.
   - State _what_ changed and _how_ it affects the consumer.
   - If a breaking change is introduced, provide a brief migration note.

6. **Always End Entries with a Link to the PR**:
   - Conclude each entry with a clickable link to its associated GitHub Pull Request:
     `[#<pr-number>](https://github.com/a2ui-project/a2ui/pull/<pr-number>)`

---

## Format & Examples (TypeScript / Web & Python)

### Single Feature or Bug Fix

```markdown
## Unreleased

- (v0_9) Add universal markdown fallback in `Text` component when optional `@a2ui/markdown-it` is available. [#2272](https://github.com/a2ui-project/a2ui/pull/2272)
- (v0_9) Fix null de-referencing TypeError in `ComponentBinder` when `children` property is null or undefined. [#1472](https://github.com/a2ui-project/a2ui/pull/1472)
```

### Multi-Item Feature Group

```markdown
## Unreleased

- (v0_9) Support universal Web Components in the v0.9 renderer:
  - Add `UniversalBasicCatalog`, `NativeBasicCatalog`, and `BasicCatalogBase` supporting both universal Web Components from `@a2ui/web_core` and native Angular `@Component` implementations.
  - Add `toWebComponent` adapter to convert custom Angular `@Component` implementations into W3C Custom Elements with dynamic DI injector forwarding and reconnection handling.
  - Update `ComponentHostComponent` to dynamically mount either universal Web Components or native Angular components based on catalog definitions.
  - Update `SurfaceComponent` with pure computed surface ID derivation and reactive surface registration via constructor `effect()`.
  - Add standalone helper `provideA2Ui` configuration function and `A2UI_USE_UNIVERSAL_COMPONENTS` injection token for Angular applications. [#2273](https://github.com/a2ui-project/a2ui/pull/2273)
```

### Breaking Changes (Public API Surface & Meaningful Behavioral Changes)

```markdown
## Unreleased

- **BREAKING CHANGE**: `BoundProperty.raw` is now `unknown` instead of `any`. Recommended migration: replace `raw` access with typed sibling fields where available (e.g. use `template` instead of `raw.componentId`/`raw.path`). [#1312](https://github.com/a2ui-project/a2ui/pull/1312)
- **BREAKING CHANGE**: (v0_9) `Image` component now defaults `fit` to `"cover"` (previously `"fill"`) to match responsive catalog container layouts. Recommended migration: explicitly set `fit: "fill"` if previous stretching behavior is required. [#2205](https://github.com/a2ui-project/a2ui/pull/2205)
```

---

## Step-by-Step Workflow

1. **Identify Affected Packages**:
   Find the `CHANGELOG.md` in the root of each published package modified in the PR (e.g. `typescript/web_core/CHANGELOG.md`, `renderers/angular/CHANGELOG.md`, `renderers/lit/CHANGELOG.md`, `renderers/react/CHANGELOG.md`, `dart/a2ui_core/CHANGELOG.md`). If modifying a Dart package under `dart/`, follow [`a2ui-dart-versioning`](../a2ui-dart-versioning/SKILL.md).

2. **Retrieve Current PR Number**:

   ```bash
   gh pr view --json number --jq '.number'
   ```

3. **Check for Public API Surface or Meaningful Behavioral Changes**:
   Review `git diff` on exported symbols, types, components, schemas, defaults, and rendering behaviors:

   ```bash
   git diff main --stat
   ```

   Determine whether the diff introduces a public API change or a meaningful change in behavior that requires a `**BREAKING CHANGE**:` annotation (or `Breaking:` for Dart packages). For TypeScript packages, see [Inspecting TypeScript Public API (AST Approach)](../coding-principles/subskills/typescript/references/inspecting-typescript-public-api.md).

4. **Add or Update the `## Unreleased` Entry**:
   Draft concise, complete descriptions following the core rules above, and append `[#<pr-number>](https://github.com/a2ui-project/a2ui/pull/<pr-number>)`.

5. **Verify Nothing Was Removed**:

   ```bash
   git diff main -- '**/CHANGELOG.md' | grep '^-[^-]'
   ```

   The only acceptable output is a revision to an entry added in the current PR. Any deleted version header or pre-existing entry must be restored immediately.

6. **Format the Repository**:
   ```bash
   ./scripts/fix_format.sh
   ```

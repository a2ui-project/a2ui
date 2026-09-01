---
name: a2ui-changelog-management
description: Guidelines and strict formatting rules for AI agents to update package CHANGELOG.md files during day-to-day feature development, bug fixes, and breaking changes.
---

# A2UI Changelog Management Skill

This skill provides AI agents with guidelines and formatting rules for maintaining `CHANGELOG.md` files across all Python (`agent_sdks/python/`) and TypeScript (`renderers/`) packages during day-to-day software development tasks.

---

## 1. When to Update `CHANGELOG.md`

AI agents MUST append an entry to `CHANGELOG.md` whenever making user-visible modifications to any package:

| Change Category           | Examples                                                           | Requires `CHANGELOG.md` Update?                         |
| :------------------------ | :----------------------------------------------------------------- | :------------------------------------------------------ |
| **Breaking Changes**      | API signature changes, removed props, protocol breaking changes    | **YES** (`### Breaking Changes` / `- BREAKING CHANGE:`) |
| **Features**              | New component support, added SDK methods, streaming capabilities   | **YES** (`### Features` / `- FEAT:`)                    |
| **Bug Fixes**             | Memory leak fixes, crash fixes, state synchronization fixes        | **YES** (`### Bug Fixes` / `- FIX:`)                    |
| **Internal Maintenance**  | Refactoring internal helpers, updating dev dependencies (`chore:`) | NO                                                      |
| **Documentation / Tests** | Updating READMEs, adding unit tests (`docs:`, `test:`, `ci:`)      | NO                                                      |

---

## 2. Package `CHANGELOG.md` File Locations

Each package in the repository maintains its own independent `CHANGELOG.md`:

| Package Name            | Relative Path                                 |
| :---------------------- | :-------------------------------------------- |
| **`a2ui-core`**         | `agent_sdks/python/a2ui_core/CHANGELOG.md`    |
| **`a2ui-agent-sdk`**    | `agent_sdks/python/a2ui_agent/CHANGELOG.md`   |
| **`@a2ui/web_core`**    | `renderers/web_core/CHANGELOG.md`             |
| **`@a2ui/lit`**         | `renderers/lit/CHANGELOG.md`                  |
| **`@a2ui/angular`**     | `renderers/angular/CHANGELOG.md`              |
| **`@a2ui/react`**       | `renderers/react/CHANGELOG.md`                |
| **`@a2ui/markdown-it`** | `renderers/markdown/markdown-it/CHANGELOG.md` |

---

## 3. Strict Canonical Formatting Rules

To allow the automated release pipeline (`./scripts/release/create_release.py`) to accurately compute Semantic Version bumps (`MAJOR`, `MINOR`, `PATCH`), all entries MUST be added under the **`## Unreleased`** section using the **Single Mandatory Bullet Prefix Format**:

```markdown
## Unreleased

- BREAKING CHANGE: Changed `RenderEngine` constructor to accept a mandatory `options` object instead of positional arguments.
- FEAT: Added two-way state binding support for client text inputs.
- FIX: Fixed null pointer exception during component unmount in Lit renderer.
```

---

## 4. Writing Best Practices

1. **User-Centric Language**: Write clear, concise entries describing _what changed for the consumer of the package_.
2. **Code Symbols**: Enclose class names, methods, components, and properties in backticks (e.g. `` `a2ui_agent` ``, `` `RenderEngine` ``).
3. **No Raw Commit Dumps**: Never copy raw `git commit` messages or commit hashes directly into `CHANGELOG.md`. Always craft human-readable summaries.
4. **Preserve Section Headers**: If `## Unreleased` does not exist in `CHANGELOG.md`, create it at the top of the file directly above the previous version header (e.g., `## 0.10.7`).

---

## 5. Verification

After updating `CHANGELOG.md`, test how the release automation inspects your entry by running:

```bash
./scripts/release/create_release.py
```

Verify that `create_release.py` identifies your package state as `STATE_UNRELEASED_CHANGES_EXIST` and lists your unreleased changes under the package summary.

---
name: a2ui-release-sdks
description: Guidelines for writing human release notes, inspecting package release status, and running or debugging the automated A2UI multi-language release pipeline.
---

# A2UI SDK Release & Release Notes Skill

This skill provides guidelines and recipes for developers and AI agents to:

1. **Document human release notes** in `CHANGELOG.md` files using canonical SemVer syntaxes.
2. **Inspect release status & trigger automated PR generation** using `release_manager.py`.
3. **Debug & troubleshoot** the automated GitHub Actions release pipeline.

Primary sources of truth:

- Day-to-Day Changelog Skill: [.agents/skills/a2ui-changelog-management/SKILL.md](../a2ui-changelog-management/SKILL.md)
- Proposal & Architecture Spec: [specification/proposals/automated_release_pipeline.md](../../../specification/proposals/automated_release_pipeline.md)
- Master Release Guide: [docs/contributing/release.md](../../../docs/contributing/release.md)

---

## 1. Writing & Managing Human Release Notes

Maintainers and AI agents write release notes manually under the `## Unreleased` section of each package's `CHANGELOG.md`.

To ensure the automated release pipeline accurately calculates SemVer version bumps (`MAJOR`, `MINOR`, `PATCH`), release notes MUST use **one of the following two canonical formats**:

### Option 1: Section Subheadings (Recommended)

```markdown
## Unreleased

### Breaking Changes

- Changed `RenderEngine` constructor signature to accept `ConfigOptions`.

### Features

- Added streaming data binding support for client renderers.

### Bug Fixes

- Fixed null pointer exception during component unmount.
```

### Option 2: Bullet Item Prefixes

```markdown
## Unreleased

- BREAKING CHANGE: Changed `RenderEngine` constructor signature to accept `ConfigOptions`.
- FEAT: Added streaming data binding support for client renderers.
- FIX: Fixed null pointer exception during component unmount.
```

### SemVer Calculation Rules

- **Breaking Changes** (`### Breaking Changes` or `- BREAKING CHANGE:`): Bumps **MINOR** for pre-1.0 (`0.10.x` -> `0.11.0`) or **MAJOR** for post-1.0 (`1.x.y` -> `2.0.0`).
- **Features** (`### Features` or `- FEAT:`): Bumps **MINOR** (`0.10.x` -> `0.11.0` pre-1.0; `1.x.y` -> `1.y+1.0` post-1.0).
- **Bug Fixes** (`### Bug Fixes` or `- FIX:`): Bumps **PATCH** (`0.10.x` -> `0.10.y`).

---

## 2. Inspecting Release Status & Triggering Release PRs

Use `release_manager.py` to inspect package release states or generate release PRs:

```bash
# Inspect release state across all packages
./scripts/release/release_manager.py

# Perform dry-run release PR creation
./scripts/release/release_manager.py --create-pr --dry-run

# Execute automated Version Bump PR creation
./scripts/release/release_manager.py --create-pr
```

---

## 3. Pipeline Architecture & Debugging Guide

The release pipeline operates on 3 automated GitHub Actions workflows:

| Workflow                                 | Trigger                                    | Description                                                                                                                               |
| :--------------------------------------- | :----------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **`.github/workflows/release-pr.yml`**   | Cron (Mon 09:00 UTC) / `workflow_dispatch` | Runs `release_manager.py --create-pr`. Audits git commits, updates version strings, updates lockfiles, and opens a Release PR.            |
| **`.github/workflows/tag-on-merge.yml`** | Push to `main` (version file changes)      | Runs `bootstrap_tags.py --push` to automatically create and push immutable Git tags (`javascript/<pkg>/v<ver>` or `python/<pkg>/v<ver>`). |
| **`.github/workflows/publish-tag.yml`**  | Push tag (`javascript/**`, `python/**`)    | Checks out exact tag commit, builds artifacts, runs `release.sh`, and publishes to Artifact Registry / PyPI / npm.                        |

### Debugging Failed Releases

1. **Unreleased changes ignored?** Verify `CHANGELOG.md` section header is named `## Unreleased` and uses one of the two canonical formats above.
2. **Missing Git tags on main?** Run `./scripts/release/bootstrap_tags.py --push` to sync missing baseline tags.
3. **Artifact publish failure?** Check `.github/workflows/publish-tag.yml` workflow logs. Run release scripts locally with `--dry-run`:
   - `./renderers/release.sh renderers/web_core --dry-run`
   - `./agent_sdks/python/release.sh agent_sdks/python/a2ui_core --dry-run`

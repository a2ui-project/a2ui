---
name: a2ui-release-sdks
description: State-machine driven automated release workflow for A2UI Python (a2ui-agent-sdk, a2ui-core) and TypeScript (@a2ui/web_core, @a2ui/lit, @a2ui/angular, @a2ui/react, @a2ui/markdown-it) SDKs. Handles state inspection, version selection, PR creation, build staging, and Exit Gate manifest uploads.
---

# A2UI SDK & Package Release Skill

Guidelines and tactical recipes for AI agents to release A2UI Python (`a2ui-agent-sdk`, `a2ui-core`) and TypeScript (`@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`, `@a2ui/markdown-it`) packages using a deterministic **State Machine**.

Primary sources of truth:

- Master Release Guide: [docs/contributing/release.md](../../../docs/contributing/release.md)
- Python Technical Guide: [agent_sdks/python/docs/python_publishing.md](../../../agent_sdks/python/docs/python_publishing.md)
- TypeScript Technical Guide: [renderers/docs/web_publishing.md](../../../renderers/docs/web_publishing.md)

---

## State Machine Architecture

The agent evaluates the workspace across 4 operational states:

```
  ┌────────────────────────────────────────────────────────┐
  │ Phase 0: State Discovery                               │
  │ (Inspect CHANGELOGs, Git log, Registry versions, PRs) │
  └───────────────────────────┬────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┬──────────────────────┐
       ▼                      ▼                      ▼                      ▼
┌──────────────┐   ┌────────────────────┐   ┌──────────────────┐   ┌─────────────────┐
│ STATE 0:     │   │ STATE 1:           │   │ STATE 2:         │   │ STATE 3:        │
│ IDLE         │   │ UNRELEASED CHANGES │   │ RELEASE PR       │   │ MAIN READY FOR  │
│              │   │ EXIST              │   │ PENDING          │   │ PUBLISHING      │
└──────────────┘   └──────────┬─────────┘   └────────┬─────────┘   └────────┬────────┘
                              │                      │                      │
                              ▼                      ▼                      ▼
                   Execute Phase 1:       Report open PR link    Execute Phase 2:
                   Version Bump PR        Wait for maintainer    Staging & Manifest
                   Creation               merge                  Upload
```

---

## Phase 0: State Discovery Protocol

Execute this discovery sequence at the start of any release task:

### 1. Inspect Unreleased Changes Across Packages

Check `## Unreleased` headers in package `CHANGELOG.md` files:

- **Python**: `agent_sdks/python/a2ui_core/CHANGELOG.md`, `agent_sdks/python/a2ui_agent/CHANGELOG.md`
- **TypeScript**: `renderers/web_core/CHANGELOG.md`, `renderers/lit/CHANGELOG.md`, `renderers/angular/CHANGELOG.md`, `renderers/react/CHANGELOG.md`, `renderers/markdown/markdown-it/CHANGELOG.md`

_Rule_: A package qualifies for release if its `CHANGELOG.md` has unreleased entries, or if `git log -n 20 <pkg_dir>` reveals unreleased commits that must be logged. If `## Unreleased` is empty and no commits exist, skip that package.

### 2. Check Registry vs Local Versions

- **Python**: Compare local `pyproject.toml` version against PyPI (`curl -s https://pypi.org/pypi/a2ui-agent-sdk/json`).
- **TypeScript**: Compare local `package.json` version against NPM (`npm view @a2ui/web_core version`).

### 3. Query Open GitHub PRs

Run `gh pr list --search "release"` to check for existing release PRs.

### 4. Determine Active State:

- **STATE 0 (IDLE)**: Registry version equals local version AND no unreleased commits exist.
- **STATE 1 (UNRELEASED_CHANGES_EXIST)**: Unreleased entries exist in `CHANGELOG.md` AND no release PR is currently open.
- **STATE 2 (RELEASE_PR_PENDING)**: A version bump PR is currently open on GitHub.
- **STATE 3 (MAIN_READY_FOR_PUBLISHING)**: Current branch is `main` AND local version in `main` is greater than published registry version (Version bump PR was merged).

---

## Phase 1: State Handlers & Action Recipes

### Handler for STATE 0 (IDLE)

Emit summary to user: _"All packages are up to date and published."_ End turn.

---

### Handler for STATE 1 (UNRELEASED_CHANGES_EXIST)

1. **Determine SemVer Version Bump for Qualified Packages**:
   - If `CHANGELOG.md` contains `BREAKING CHANGE` entries while pre-1.0 (`0.x.y`), bump **MINOR** version (`0.10.x` -> `0.11.0`).
   - Otherwise, bump **PATCH** version (`0.10.x` -> `0.10.y`).

2. **Prepare Release Branch**:

   ```bash
   git checkout main
   git pull upstream main
   git checkout -b release/sdks-$(date +%Y-%m-%d)
   ```

3. **Update Changelogs & Version Identifiers**:
   - Rename `## Unreleased` to `## <new_version>` and insert a fresh `## Unreleased` header above it.
   - **TypeScript**: Update `"version": "<new_version>"` directly in package `package.json` files.
   - **Python**: Update version strings in `src/a2ui/version.py` or `src/a2ui/core/version.py`.
   - Run `yarn install` at the workspace root once to update lockfiles cleanly.

4. **Run Pre-flight Test Suite**:

   ```bash
   # TypeScript pre-flight
   yarn build:all && yarn test:all

   # Python pre-flight
   cd agent_sdks/python && uv run pytest
   ```

5. **Commit & Open Upstream PR**:
   ```bash
   git add -u
   git commit -m "release: prepare SDK packages for release"
   git push -u origin release/sdks-$(date +%Y-%m-%d)
   GH_TOKEN="$A2UI_UPSTREAM_TOKEN" gh pr create -R a2ui-project/a2ui --base main --title "release: prepare SDK packages for release" --body "Automated version bump and changelog preparation."
   ```

_Transition_: Repository enters **STATE 2 (RELEASE_PR_PENDING)**.

---

### Handler for STATE 2 (RELEASE_PR_PENDING)

1. Output open PR URL to the maintainer.
2. Request PR review and merge into `main`.

_Transition Trigger_: Once the PR is merged into `main`, the repository enters **STATE 3 (MAIN_READY_FOR_PUBLISHING)**.

---

### Handler for STATE 3 (MAIN_READY_FOR_PUBLISHING)

1. **Pull Latest Main**:

   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Execute Publishing & Manifest Upload Scripts**:
   - **TypeScript (NPM)**:
     ```bash
     ./renderers/scripts/publish_npm.mjs -p web_core -p lit -p angular -p react --no-dry-run
     ./renderers/scripts/upload_manifest.mjs -p web_core -p lit -p angular -p react --no-dry-run
     ```
   - **Python (PyPI)**:
     ```bash
     cd agent_sdks/python
     ./release.sh a2ui_core
     ./release.sh a2ui_agent
     ```

3. **Post-Release Verification**:
   - Verify artifacts in Google Artifact Registry staging repository.
   - Confirm publication on `npmjs.com` and `pypi.org`.

_Transition_: Repository returns to **STATE 0 (IDLE)**.

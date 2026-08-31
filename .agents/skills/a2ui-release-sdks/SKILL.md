---
name: a2ui-release-sdks
description: Multi-stage automated release workflow for A2UI Python (a2ui-agent-sdk, a2ui-core) and TypeScript (@a2ui/web_core, @a2ui/lit, @a2ui/angular, @a2ui/react, @a2ui/markdown-it) SDKs. Handles version checking, changelog formatting, version bump PR creation, build staging, and Exit Gate manifest uploads.
---

# A2UI SDK & Package Release Skill

Guidelines and tactical workflows for AI agents to release A2UI Python (`a2ui-agent-sdk`, `a2ui-core`) and TypeScript (`@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`, `@a2ui/markdown-it`) packages with minimal human intervention.

Primary sources of truth:

- Generic Release Guide & Policies: [docs/contributing/release.md](../../../docs/contributing/release.md)
- Python Technical Publishing Guide: [agent_sdks/python/docs/python_publishing.md](../../../agent_sdks/python/docs/python_publishing.md)
- TypeScript Technical Publishing Guide: [renderers/docs/web_publishing.md](../../../renderers/docs/web_publishing.md)

---

## State Machine Overview

The release workflow operates across three distinct phases. An agent must first execute state inspection to determine where in the pipeline the repository currently stands:

```
                  ┌────────────────────────────────────────┐
                  │ Phase 0: State Inspection             │
                  │ (Compare PyPI/NPM, Git & GitHub PRs)   │
                  └───────────────────┬────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
  [State 1: Unreleased        [State 2: Version           [State 3: Version Bumped
   Changes Exist]              Bump PR Pending]            on main Branch]
         │                            │                            │
  ┌──────┴───────────────┐     ┌──────┴───────────────┐     ┌──────┴───────────────┐
  │ 1. Create branch     │     │ 1. Report PR status  │     │ 1. Run test suite    │
  │ 2. Update CHANGELOG  │     │ 2. Provide URL link  │     │ 2. Run release script│
  │ 3. Bump version     │     │ 3. Prompt user to    │     │ 3. Upload manifest   │
  │ 4. Run tests        │     │    merge before      │     └──────────────────────┘
  │ 5. Open GitHub PR   │     │    continuing        │
  └──────────────────────┘     └──────────────────────┘
```

---

## Workflow Recipes

### Phase 0: State Inspection & Auditing

Execute the following steps to determine target release packages:

#### 1. Inspect `CHANGELOG.md` Files & Version Identifiers
Check the top `## Unreleased` section of each package's `CHANGELOG.md`:

- **Python Packages**:
  - `agent_sdks/python/a2ui_core/CHANGELOG.md`
  - `agent_sdks/python/a2ui_agent/CHANGELOG.md`
- **TypeScript Packages**:
  - `renderers/web_core/CHANGELOG.md`
  - `renderers/markdown/markdown-it/CHANGELOG.md`
  - `renderers/lit/CHANGELOG.md`
  - `renderers/angular/CHANGELOG.md`
  - `renderers/react/CHANGELOG.md`

#### 2. Apply Release Qualification Rules:
- **Rule A (Package Qualification)**: If `## Unreleased` has entries, the package qualifies for a version bump and release.
- **Rule B (Empty Unreleased Policy)**: If `## Unreleased` is empty, check git history (`git log -n 20 <pkg_dir>`) to see if unreleased commits exist. If unreleased commits exist, ask the maintainer or document them under `## Unreleased`. If no unreleased commits exist, **skip releasing that package**.
- **Rule C (Open PR Check)**: Run `gh pr list --search "release"` to see if a version bump PR is currently open. If open, report the PR link to the user.

---

### Phase 1: Version Bump & Release Notes PR (State 1)

1. **Ensure Working Tree is Clean & Up-to-Date**:
   ```bash
   git checkout main
   git pull upstream main
   ```
2. **Create Release Branch**:
   ```bash
   git checkout -b release/sdks-$(date +%Y-%m-%d)
   ```
3. **Format `CHANGELOG.md` Headers**:
   - For each qualified package, rename `## Unreleased` to `## <new_version>` and insert a fresh `## Unreleased` header above it.
4. **Bump Version Strings**:
   - **TypeScript**: Use `--skip-sync` when bumping multiple packages to avoid monorepo lock collisions:
     ```bash
     ./renderers/scripts/increment_version.mjs web_core <new_version> --skip-sync
     ./renderers/scripts/increment_version.mjs lit <new_version> --skip-sync
     ./renderers/scripts/increment_version.mjs angular <new_version> --skip-sync
     ./renderers/scripts/increment_version.mjs react <new_version> --skip-sync

     # Run root yarn install once at the end to update lockfiles cleanly
     yarn install
     ```
   - **Python**: Edit `src/a2ui/version.py` or `src/a2ui/core/version.py`.
5. **Run Pre-flight Tests**:
   - Python: `cd agent_sdks/python && uv run pytest`
   - TypeScript: `yarn build:all && yarn test:all`
6. **Commit & Open Pull Request Targeting Upstream**:
   ```bash
   git add -u
   git commit -m "release: prepare SDK packages for release"
   git push -u origin release/sdks-$(date +%Y-%m-%d)
   gh pr create -R a2ui-project/a2ui --base main --title "release: prepare SDK packages for release" --body "..."
   ```

---

### Phase 2: Staging & Publishing (State 3)

Run this phase once the Version Bump PR has landed in `main`:

1. **Switch to Main & Pull**:
   ```bash
   git checkout main
   git pull upstream main
   ```
2. **Execute Staging & Manifest Upload Scripts**:
   - **TypeScript (NPM)**:
     ```bash
     # 1. Publish to internal Artifact Registry staging repository
     ./renderers/scripts/publish_npm.mjs -p web_core -p lit -p angular -p react --no-dry-run

     # 2. Upload release manifest to trigger public NPM release via Exit Gate
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
   - Confirm publication on public registries (`npmjs.com` / `pypi.org`).

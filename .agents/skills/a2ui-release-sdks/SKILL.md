---
name: a2ui-release-sdks
description: Multi-stage automated release workflow for A2UI Python and TypeScript SDKs. Handles version checking, changelog formatting, version bump PR creation, build staging, and Exit Gate manifest uploads.
---

# A2UI SDK & Package Release Skill

Guidelines and tactical workflows for AI agents to release A2UI Python (`a2ui-agent-sdk`, `a2ui-core`) and TypeScript (`@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`, `@a2ui/markdown-it`) packages with minimal human intervention.

Primary sources of truth:

- Generic Release Guide & Policies: [development/docs/package_releases.md](../../../development/docs/package_releases.md)
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

Execute the following commands to determine the target package state:

#### 1. Check Published Version vs Repo Version

- **Python**:

  ```bash
  # Check PyPI version
  curl -s https://pypi.org/pypi/a2ui-agent-sdk/json | python3 -c "import sys, json; print(json.load(sys.stdin)['info']['version'])"

  # Check Repo version
  python3 -c "import tomllib; print(tomllib.load(open('agent_sdks/python/a2ui_agent/pyproject.toml', 'rb'))['project']['name'])"
  ```

- **TypeScript**:

  ```bash
  # Check NPM published version
  npm view @a2ui/web_core version

  # Check Repo version
  node -e "console.log(require('./renderers/web_core/package.json').version)"
  ```

#### 2. Check Open GitHub PRs

```bash
gh pr list --search "bump version" --json number,title,url,headRefName,state
```

#### 3. State Decision Tree:

- **State A**: Repo version equals published registry version AND no unreleased commits exist on `main` $\rightarrow$ Exit cleanly: "Everything is up-to-date and published."
- **State B (State 1)**: Unreleased commits exist AND repo version equals published registry version $\rightarrow$ Proceed to **Phase 1 (Version Bump PR)**.
- **State C (State 2)**: An open version bump PR exists on GitHub $\rightarrow$ Report PR status and link to user: "Release PR #123 is currently open. Please merge it to proceed with publishing."
- **State D (State 3)**: Current branch is `main` AND repo version is strictly greater than published registry version (Version bump PR was merged) $\rightarrow$ Proceed to **Phase 2 (Staging & Publishing)**.

---

### Phase 1: Version Bump PR Creation (State 1)

1. **Ensure Working Tree is Clean & Up-to-Date**:
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Create Release Branch**:
   ```bash
   git checkout -b release/<package_name>-v<new_version>
   ```
3. **Format `CHANGELOG.md`**:
   - Locate package `CHANGELOG.md` (e.g., `agent_sdks/python/a2ui_agent/CHANGELOG.md` or `renderers/web_core/CHANGELOG.md`).
   - Rename `## Unreleased` section to `## <new_version>` and insert a new `## Unreleased` section above it.
   - **Handling Empty Unreleased Sections**: If `## Unreleased` has no specific entries:
     - Ask the maintainer/user if they would like to review commits (`git log -n 20` or commits since the last version bump) and add items.
     - If no specific items are requested, proceed with fallback release notes:
       ```markdown
       - Miscellaneous bug fixes and performance improvements.
       ```
4. **Bump Version String**:
   - **TypeScript**: Execute `renderers/scripts/increment_version.mjs <pkg_name> [new_version]`
   - **Python**: Edit `src/a2ui/version.py` or `src/a2ui/core/version.py`.
5. **Run Pre-flight Tests**:
   - Python (see [python_publishing.md](../../../agent_sdks/python/docs/python_publishing.md)): `cd agent_sdks/python && uv run pytest`
   - TypeScript: `yarn test`
6. **Commit & Open Pull Request**:
   ```bash
   git add -u
   git commit -m "chore(release): bump <package_name> to v<new_version>"
   git push -u origin release/<package_name>-v<new_version>
   gh pr create --title "Release <package_name> v<new_version>" --body "Automated version bump and changelog preparation for v<new_version>."
   ```

---

### Phase 2: Staging & Publishing (State 3)

Run this phase once the Version Bump PR has landed in `main`:

1. **Switch to Main & Pull**:
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Execute Language-Specific Staging & Upload Scripts**:
   - Refer to [agent_sdks/python/docs/python_publishing.md](../../../agent_sdks/python/docs/python_publishing.md) for Python:
     ```bash
     cd agent_sdks/python
     ./release.sh <a2ui_agent|a2ui_core>
     ```
   - Refer to [renderers/docs/web_publishing.md](../../../renderers/docs/web_publishing.md) for TypeScript:
     ```bash
     ./renderers/scripts/publish_npm.mjs --no-dry-run
     ./renderers/scripts/upload_manifest.mjs --no-dry-run
     ```
3. **Post-Release Verification**:
   - Verify artifacts in Google Artifact Registry staging repository.
   - Monitor OSS Exit Gate email notification or check publication on public registries (`pypi.org` / `npmjs.com`).

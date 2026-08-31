# A2UI Package Release Guide

This document is the authoritative, language-agnostic guide for releasing A2UI SDK and renderer packages. It applies to all maintained packages in this repository (Python, TypeScript/Web, and future language targets).

For codebase-specific publishing instructions, consult:

- **Python SDKs**: [agent_sdks/python/docs/python_publishing.md](../../agent_sdks/python/docs/python_publishing.md)
- **TypeScript/Web Packages**: [renderers/docs/web_publishing.md](../../renderers/docs/web_publishing.md)
- **Agent Skill**: [.agents/skills/a2ui-release-sdks/SKILL.md](../../.agents/skills/a2ui-release-sdks/SKILL.md)

---

## 1. Core Release Philosophy

Releases in A2UI follow a **two-stage release pipeline**:

1. **Stage 1: Version Bump & Release Notes (Pull Request)**:
    - Increments the version string in the codebase (`package.json`, `version.py`, etc.).
    - Transforms `CHANGELOG.md` entries under `## Unreleased` into `## <version>`.
    - Runs pre-flight unit and integration test suites.
    - Opens a GitHub Pull Request targeting upstream (`a2ui-project/a2ui`) for peer review and CI validation.
2. **Stage 2: Staging & Manifest Upload (Post-Merge)**:
    - Once the Version Bump PR is merged into `main`, the release artifacts are built and published to staging/internal registries.
    - A release manifest is uploaded to trigger public publishing (via the Exit Gate proxy pipeline to PyPI / NPM).

---

## 2. Prerequisites & Authentication

Before triggering a package release, ensure your local development environment has the necessary authentication:

### 1. Google Cloud Authentication

Googlers publishing artifacts to the internal staging registry or Exit Gate buckets must authenticate via `gcloud`:

```bash
# General gcloud login
gcloud auth login

# Application Default Credentials (required for Python twine & upload scripts)
gcloud auth application-default login
```

### 2. GitHub Credentials

Ensure the GitHub CLI (`gh`) is authenticated to interact with the repository:

```bash
gh auth login
```

---

## 3. Changelog Management (`CHANGELOG.md`)

Every publishable package maintains a `CHANGELOG.md` file in its package root directory (e.g. `renderers/web_core/CHANGELOG.md`, `agent_sdks/python/a2ui_agent/CHANGELOG.md`).

### Structure & Conventions

```markdown
## Unreleased

- Add new feature X [#123]
- Fix edge-case bug Y [#124]

## 0.10.6

- Previous release notes...
```

### Protocol During Feature Development

When adding features or fixing bugs in feature PRs, developers append bullet points directly under the top-level `## Unreleased` header.

### Protocol During Package Release

When preparing a package version release:

1. Rename `## Unreleased` to `## <new_version>` (e.g., `## 0.10.7`).
2. Insert a fresh, empty `## Unreleased` section at the top of the file above `## <new_version>`.

### Handling Empty Unreleased Sections

If a release is requested but a package's `CHANGELOG.md` has no entries under `## Unreleased`:

- Check git history (`git log -n 20 <pkg_dir>`) to see if unreleased commits exist.
- If unreleased commits exist, ask the maintainer or document them under `## Unreleased`.
- If no unreleased commits exist, **skip releasing that package**.

### Version Bump Selection Rules (SemVer)

When choosing `<new_version>`:

- **Breaking Changes in Pre-1.0 (`0.x.y`)**: If `CHANGELOG.md` includes `BREAKING CHANGE` or breaking API changes while in pre-1.0 (`0.x.y`), bump the **MINOR** version (e.g., `0.10.2` -> `0.11.0`). If post-1.0 (`X.y.z`), bump the **MAJOR** version (`1.x.y` -> `2.0.0`).
- **Backward-Compatible Changes**: If changes contain only non-breaking features or bug fixes, bump the **PATCH** version (e.g., `0.10.6` -> `0.10.7`).

---

## 4. Release Lifecycle States

When releasing packages, maintainers and AI agents evaluate the repository state across three distinct phases:

```
                  ┌────────────────────────────────────────┐
                  │ Evaluate State (PyPI/NPM vs Git/PRs)   │
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

## 5. Summary Checklist

### Phase 1: Version Bump PR (Local Branch)

- [ ] Inspect qualified packages (`## Unreleased` entries in `CHANGELOG.md`).
- [ ] Create branch `release/sdks-YYYY-MM-DD`.
- [ ] Update `CHANGELOG.md` headings (`## <new_version>` + fresh `## Unreleased`).
- [ ] Bump versions (edit `"version"` in `package.json` for TS; edit `version.py` for Python).
- [ ] Run `yarn install` at workspace root.
- [ ] Run test suite (`yarn test:all`, `uv run pytest`).
- [ ] Open PR targeting upstream (`a2ui-project/a2ui`).

### Phase 2: Staging & Publishing (Post-Merge on `main`)

- [ ] Switch to `main` (`git pull upstream main`).
- [ ] Run `./renderers/scripts/publish_npm.mjs -p <pkgs> --no-dry-run`.
- [ ] Run `./renderers/scripts/upload_manifest.mjs -p <pkgs> --no-dry-run`.
- [ ] Run `./agent_sdks/python/release.sh <a2ui_agent|a2ui_core>`.
- [ ] Verify staging artifacts in Google Artifact Registry & Exit Gate deployment.

# A2UI Package Release Guide

This document is the authoritative, language-agnostic guide for releasing A2UI SDK and renderer packages. It applies to all maintained packages in this repository (Python, TypeScript/Web, and future language targets).

For codebase-specific publishing instructions, consult:
- **Python SDKs**: [agent_sdks/python/docs/python_publishing.md](file:///Users/jsimionato/development/a2ui_repos/release-oncall/A2UI/agent_sdks/python/docs/python_publishing.md)
- **TypeScript/Web Packages**: [renderers/docs/web_publishing.md](file:///Users/jsimionato/development/a2ui_repos/release-oncall/A2UI/renderers/docs/web_publishing.md)

---

## 1. Core Release Philosophy

Releases in A2UI follow a **two-stage release pipeline**:

1. **Stage 1: Version Bump & Release Notes (Pull Request)**:
   - Increments the version string in the codebase (`package.json`, `version.py`, etc.).
   - Transforms `CHANGELOG.md` entries under `## Unreleased` into `## <version>`.
   - Runs pre-flight unit and integration test suites.
   - Opens a GitHub Pull Request for peer review and CI validation.
2. **Stage 2: Staging, Manifest Upload & Git Tagging (Post-Merge)**:
   - Once the Version Bump PR is merged into `main`, the release artifacts are built and published to staging/internal registries.
   - A release manifest is uploaded to trigger public publishing (via the Exit Gate proxy pipeline).
   - A Git tag (`vX.Y.Z`) and GitHub Release are published.

---

## 2. Prerequisites & Authentication (Human Setup)

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

### 3. Tooling Dependencies
- **Node.js**: Modern v20+ with Corepack enabled (`corepack enable`).
- **Python**: v3.10+ with `uv` package manager (`uv sync`).
- **Google Cloud SDK**: `gcloud` CLI installed and available on system `$PATH`.

---

## 3. Changelog Management (`CHANGELOG.md`)

Every publishable package maintains a `CHANGELOG.md` file in its package root directory (e.g. `renderers/web_core/CHANGELOG.md`, `agent_sdks/python/a2ui_agent/CHANGELOG.md`).

### Structure & Conventions

```markdown
## Unreleased

- Add new feature X [#123]
- Fix edge-case bug Y [#124]

## 0.10.3

- Previous release notes...
```

### Protocol During Feature Development
When adding features or fixing bugs in feature PRs, developers append bullet points directly under the top-level `## Unreleased` header.

### Protocol During Package Release
When preparing a package version release:
1. Rename `## Unreleased` to `## <new_version>` (e.g., `## 0.10.4`).
2. Insert a fresh, empty `## Unreleased` section at the top of the file above `## <new_version>`.

```markdown
## Unreleased

## 0.10.4

- Add new feature X [#123]
- Fix edge-case bug Y [#124]
```

### Handling Empty Unreleased Sections
If a release is requested but `CHANGELOG.md` has no entries under `## Unreleased`:
- **Maintainer Interaction**: Double-check with the maintainer/user to see if they would like to review recent git commits (`git log <last_tag>..HEAD`) and add specific feature/fix notes.
- **Fallback Release Note**: If no specific notes are supplied, use a default fallback summary:
  ```markdown
  - Miscellaneous bug fixes and performance improvements.
  ```

---

## 4. Release Lifecycle States

When releasing a package, maintainers and AI agents evaluate the repository state across three distinct phases:

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
  │ 4. Run tests        │     │    merge before      │     │ 4. Push git tag      │
  │ 5. Open GitHub PR   │     │    continuing        │     │ 5. Create GH Release │
  └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

---

## 5. Post-Release Tagging & GitHub Releases

Once release artifacts are uploaded and the manifest is dispatched:

1. **Tag the Commit**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
2. **Create GitHub Release**:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
   ```

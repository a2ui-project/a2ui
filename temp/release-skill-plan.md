# Comprehensive Implementation Plan: A2UI SDK Release Documentation & Agent Skill

**Target Plan File**: `temp/release-skill-plan.md`  
**Status**: COMPLETED

---

## 1. Executive Summary

This plan outlines the architecture for automating and standardizing package releases across **Python** (`a2ui-agent-sdk`, `a2ui-core`) and **TypeScript/Web** (`@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`, `@a2ui/markdown-it`) SDKs.

To prevent documentation duplication and ensure clear separation of responsibilities:
1. **Central Generic Release Guide**: Create `development/docs/package_releases.md` containing only high-level, language-agnostic release principles, authentication requirements, versioning conventions, and changelog management rules. It links out to language-specific guides for technical details.
2. **Language-Specific Release Guides**:
   - Python: `agent_sdks/python/docs/python_publishing.md` (Detailed Python build, test, `release.sh`, PyPI Artifact Registry, and manifest steps).
   - TypeScript/Web: `renderers/docs/web_publishing.md` (Detailed Yarn Modern workspace, `increment_version.mjs`, `publish_npm.mjs`, NPM dist isolation, and manifest steps).
3. **Agent Skill Recipe**: Create `.agents/skills/a2ui-release-sdks/SKILL.md` containing concise, step-by-step state-machine execution recipes for AI agents, referencing the central and language-specific docs.
4. **Python Changelog Standardization**: Introduce `CHANGELOG.md` files for Python packages following the repository's established `## Unreleased` convention.

---

## 2. Documentation Hierarchy & Link Topology

```
                              ┌────────────────────────────────────────┐
                              │  development/docs/package_releases.md   │
                              │  (Central, Generic & Language-Agnostic)│
                              └───────────────────┬────────────────────┘
                                                  │
                   ┌──────────────────────────────┴──────────────────────────────┐
                   │ References                                                  │ References
                   ▼                                                             ▼
 ┌───────────────────────────────────┐                         ┌───────────────────────────────────┐
 │ agent_sdks/python/docs/           │                         │ renderers/docs/                   │
 │ python_publishing.md              │                         │ web_publishing.md                 │
 │ (Python-specific mechanics)      │                         │ (TypeScript/Web-specific mechanics│
 └───────────────────────────────────┘                         └───────────────────────────────────┘
                   ▲                                                             ▲
                   │                                                             │
                   └──────────────────────────────┬──────────────────────────────┘
                                                  │
                                                  │ Referenced by Skill
                                                  │
                              ┌───────────────────┴────────────────────┐
                              │ .agents/skills/a2ui-release-sdks/      │
                              │ SKILL.md                               │
                              │ (Agent State Machine & Recipes)        │
                              └────────────────────────────────────────┘
```

---

## 3. Component Specifications

### 3.1 Central Generic Release Guide (`development/docs/package_releases.md`)

This file is strictly **language-agnostic** and serves as the single source of truth for maintainers and agents regarding release policy and lifecycle.

#### Content Structure:
1. **Scope & High-Level Philosophy**:
   - Unified multi-package release protocol across all SDKs and renderers.
   - Core principle: Releases are always two-stage processes (Version bump PR on feature branch -> Merge to `main` -> Staging, publish & git tag).
2. **Prerequisites & System Setup (Human User Authentication)**:
   - Google Cloud credentials (`gcloud auth login` & `gcloud auth application-default login`).
   - GitHub CLI authentication (`gh auth login`).
   - General CLI requirements (`node`, `python`, `uv`, `gcloud`, `gh`).
3. **Standard Changelog Protocol (`CHANGELOG.md`)**:
   - Universal `## Unreleased` convention.
   - **Feature PR Phase**: Developers append feature/fix notes directly under `## Unreleased`.
   - **Release Phase**: The release process renames `## Unreleased` to `## <version>` (e.g. `## 0.10.4`) and inserts a new empty `## Unreleased` header above it.
4. **Release Lifecycle States**:
   - State 1: Unreleased changes exist -> Create release branch, bump version, update `CHANGELOG.md`, run tests, open GitHub PR.
   - State 2: Release PR open -> Wait for review & merge.
   - State 3: Release PR merged to `main` -> Execute staging scripts, upload manifest to Exit Gate, push Git release tag (`vX.Y.Z`), create GitHub Release.
5. **Links to Codebase-Specific Publishing Documentation**:
   - Python SDKs: Links to [agent_sdks/python/docs/python_publishing.md](../../agent_sdks/python/docs/python_publishing.md).
   - TypeScript/Web SDKs & Renderers: Links to [renderers/docs/web_publishing.md](../../renderers/docs/web_publishing.md).

---

### 3.2 Language-Specific Publishing Documentation

#### A. Python Publishing Guide (`agent_sdks/python/docs/python_publishing.md`)
- Detailed guide for building and releasing Python packages (`a2ui-agent-sdk`, `a2ui-core`).
- Version locations: `a2ui_agent/src/a2ui/version.py` and `a2ui_core/src/a2ui/core/version.py`.
- Step-by-step instructions for `agent_sdks/python/release.sh <package_name>`.
- Artifact Registry verification, twine uploads, and PyPI GCS manifest bucket (`gs://oss-exit-gate-prod-projects-bucket/a2ui/pypi/manifests/`).

#### B. TypeScript/Web Publishing Guide (`renderers/docs/web_publishing.md`)
- Existing guide maintained for web packages (`@a2ui/web_core`, `@a2ui/lit`, etc.).
- Version incrementing via `renderers/scripts/increment_version.mjs`.
- Staging and artifact uploads via `renderers/scripts/publish_npm.mjs`.
- Exit gate manifest triggers via `renderers/scripts/upload_manifest.mjs`.
- Isolated `dist/` package boundary publishing details.

---

### 3.3 Agent Skill Definition (`.agents/skills/a2ui-release-sdks/SKILL.md`)

The agent skill provides step-by-step state machine recipes. It references `development/docs/package_releases.md` for high-level rules, and the language-specific guide for language mechanics.

---

## 4. Summary of Automation Boundaries

| Task | Responsible Party | Reference Location |
|---|---|---|
| Browser OAuth (`gcloud auth`, `gh auth`) | **Human User** | `development/docs/package_releases.md` |
| Version Mismatch & Commit Audit | **AI Agent / Skill** | `.agents/skills/a2ui-release-sdks/SKILL.md` |
| `CHANGELOG.md` Formatting (`Unreleased` -> `version`) | **AI Agent / Skill** | `development/docs/package_releases.md` |
| Version File Edits & Monorepo Lockfile Sync | **AI Agent / Skill** | Language-specific docs & Skill |
| Test Validation & PR Creation (`gh pr create`) | **AI Agent / Skill** | `.agents/skills/a2ui-release-sdks/SKILL.md` |
| Staging Script & Manifest Upload Execution | **AI Agent / Skill** | Language-specific docs & Skill |
| Git Release Tagging & GitHub Release Creation | **AI Agent / Skill** | `.agents/skills/a2ui-release-sdks/SKILL.md` |

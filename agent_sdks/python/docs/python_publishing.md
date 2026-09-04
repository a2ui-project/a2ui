# Python SDK Publishing Guide

This guide details the technical publishing process for Python SDK packages in `agent_sdks/python/` (`a2ui-agent-sdk` and `a2ui-core`).

For generic release principles, authentication prerequisites, and changelog rules, see [docs/contributing/release.md](../../../docs/contributing/release.md).

---

## 1. Package Structure & Version Files

| Package          | Directory                      | Version Source File        | PyPI Package Name |
| :--------------- | :----------------------------- | :------------------------- | :---------------- |
| **`a2ui_agent`** | `agent_sdks/python/a2ui_agent` | `src/a2ui/version.py`      | `a2ui-agent-sdk`  |
| **`a2ui_core`**  | `agent_sdks/python/a2ui_core`  | `src/a2ui/core/version.py` | `a2ui-core`       |

Version numbers follow Semantic Versioning (`MAJOR.MINOR.PATCH`).

---

## 2. PyPI Changelog Integration & Metadata

PyPI packages surface release notes via **`[project.urls]` in `pyproject.toml` (PyPI Sidebar Link)**:

Each package's `pyproject.toml` specifies a direct link to its `CHANGELOG.md` file on GitHub:

```toml
[project.urls]
Homepage = "https://a2ui.org/"
Repository = "https://github.com/a2ui-project/a2ui"
Changelog = "https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/CHANGELOG.md"
```

This renders a prominent **Changelog** link in PyPI's project navigation sidebar.

---

## 3. Automated Release Execution (`release.sh`)

Python package releases are driven by [agent_sdks/python/release.sh](../release.sh) using the package relative directory path:

### Usage

```bash
# Release using package path
./agent_sdks/python/release.sh agent_sdks/python/a2ui_core
./agent_sdks/python/release.sh agent_sdks/python/a2ui_agent

# Or call release.sh directly inside agent_sdks/python
cd agent_sdks/python
./release.sh a2ui_core
./release.sh a2ui_agent
```

### What `release.sh` Does:

1. **Environment Checks**:
   - Verifies the local working tree is clean (`git diff-index --quiet HEAD --`).
   - Ensures local `HEAD` is in sync with `origin/main` (or `upstream/main`).
2. **Package Version Extraction**:
   - Uses `uv run hatch version` to resolve current version string.
3. **Build & Validation**:
   - Cleans previous `dist/` artifacts.
   - Builds source distribution and wheels via `uv build --out-dir dist`.
   - Runs `twine check dist/*` to validate wheel metadata.
4. **Staging Upload**:
   - Authenticates with Google Cloud via Application Default Credentials.
   - Checks if the target version already exists in Google Artifact Registry. If exists, skips upload.
   - Uploads dist artifacts to Artifact Registry PyPI repository via `twine upload`.
5. **Exit Gate Manifest Trigger**:
   - Generates `manifest.json` (`{ "publish_all": true }`).
   - Uploads manifest to GCS bucket (`gs://oss-exit-gate-prod-projects-bucket/a2ui/pypi/manifests/manifest-${VERSION}-${TIMESTAMP}.json`).

---

## 4. Post-Release Verification

After running `release.sh`:

1. Verify that the version has been uploaded to the staging repository in Google Artifact Registry.
2. Monitor the OSS Exit Gate email notification or verify publication on public PyPI (`pypi.org`).

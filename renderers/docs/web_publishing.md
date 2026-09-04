# Publishing Guide for A2UI Web Packages

This guide outlines the workflow for project maintainers publishing web packages
(`@a2ui/*`) to npm through Google's internal Artifact Registry and Exit Gate.

## Prerequisites: Authentication

Publishing requires access to Google's internal Artifact Registry. Google Cloud
CLI must be authenticated before starting:

```sh
gcloud auth login
```

The release scripts retrieve this authentication token using
`gcloud auth print-access-token` when needed.

---

## Release Workflow

All scripts should be executed from the repository root. The workflow consists
of a pull request bumping the versions of the packages to release, followed by
publishing from the `main` branch.

### 1. Increment Versions (in a Pull Request)

Package versions are updated directly in each package's `package.json` file (e.g. `renderers/web_core/package.json`). Because all packages use Yarn workspace links (`"workspace:*"`), dependent `package.json` files do not need modification (they are dynamically transformed to exact caret ranges at publish time by `prepare-publish.mjs`).

After updating `package.json` versions and changelogs, run `yarn install` at the repository root once to update workspace lockfiles cleanly:

```sh
yarn install
```

This branch should be merged into `main` through a PR as with any other change to the repo.

### 2. Automated Release Script (`renderers/release.sh`)

Once version bump changes land in `main` and it is checked out locally, a TypeScript package can be published and its release manifest uploaded in a single step using `./renderers/release.sh <package_path>`:

```sh
# Release a specific package by path or short name
./renderers/release.sh renderers/web_core
./renderers/release.sh renderers/lit
```

This script:

1. Builds production distributions without re-running unit tests (tests are verified by CI prior to merging).
2. Publishes built artifacts to Google Artifact Registry staging.
3. Uploads the Exit Gate release manifest to GCS to trigger npm distribution.

---

## Under the Hood: Low-Level Scripts

If low-level control or dry-run inspection is required, the underlying scripts can be executed manually:

### Staging Upload (`publish_npm.mjs`)

```sh
./renderers/scripts/publish_npm.mjs --package=web_core --no-dry-run
```

**CLI parameters:**

- `-p, --package=<name>`: Package(s) to publish.
- `--no-dry-run`: Actually publish packages.

### Manifest Upload (`upload_manifest.mjs`)

```sh
./renderers/scripts/upload_manifest.mjs --package=web_core --no-dry-run
```

---

## What is the `publish:package` yarn script doing?

A2UI web packages depend on each other via `workspace:*` links during development. When `publish_npm.mjs` invokes a package's `publish:package` target, the following preparation steps occur:

1. **Build & Metadata Transformation**: `prepare-publish.mjs` copies build output into `dist/`, replaces internal `workspace:` protocols with absolute semantic version ranges (e.g., `^0.10.3`), and strips development scripts/dependencies.
2. **Boundary Isolation**: Because the root workspace config excludes `dist/` (`!**/dist`), an empty `yarn.lock` is initialized inside `dist/` to establish it as an independent package boundary.
3. **Clean Upload**: `yarn npm publish --access public` executes strictly inside `dist/`, ensuring only clean production assets are uploaded.

---

## Valid Package Paths & Names

The release scripts accept relative directory paths, short names, or full scoped names:

- `renderers/web_core` (`web_core`, `@a2ui/web_core`)
- `renderers/markdown/markdown-it` (`markdown-it`, `@a2ui/markdown-it`)
- `renderers/angular` (`angular`, `@a2ui/angular`)
- `renderers/lit` (`lit`, `@a2ui/lit`)
- `renderers/react` (`react`, `@a2ui/react`)

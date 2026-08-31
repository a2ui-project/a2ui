# Publishing Guide for A2UI Web Packages

This guide outlines the workflow for project maintainers publishing web packages
(`@a2ui/*`) to npm through Google's internal Artifact Registry.

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

### 2. Publish to Staging (from `main`)

Once the new versions land in `main` and it is checked out locally,
`publish_npm.mjs` can be used to build, test, and upload the packages to
Google's internal Artifact Registry:

```sh
./renderers/scripts/publish_npm.mjs --package=lit --package=web_core
```

This script publishes requested packages in the correct dependency order (e.g.,
ensuring `web_core` is published before `lit`), runs unit tests, and verifies
that required core packages exist on the registry.

By default, the script runs in dry-run mode to prevent accidental uploads; the
`--no-dry-run` flag can be passed to actually upload the packages:

```sh
./renderers/scripts/publish_npm.mjs --package=lit --package=web_core --no-dry-run
```

Artifacts are uploaded to: [go/a2ui-oss-exit-gate-artifacts](https://go/a2ui-oss-exit-gate-artifacts).
This URL points to a web app that allows verifying that the packages have been uploaded correctly.

For each package it should be checked:

- That it has been uploaded at the expected version
- That its size is non-zero in the "Files" tab of the details of the version.

**CLI parameters for `publish_npm.mjs`:**

- `-p, --package=<name>`: Package(s) to publish. Can be specified multiple times. Accepts short names (e.g., `web_core`) or scoped names (e.g., `@a2ui/web_core`).
- `--no-dry-run`: Actually publish the packages. By default, the script runs in dry-run mode.
- `--skip-tests`: Skip building and testing packages before publishing. **Not recommended.**

### 3. Trigger Public Release (from `main`)

Once packages are verified in staging, a release manifest must be uploaded to
trigger the internal Exit Gate pipeline, which publishes them to npm:

```sh
./renderers/scripts/upload_manifest.mjs --package=web_core --package=lit
```

Similarly to `publish_npm.mjs`, this script runs in dry-run by default, so the
`--no-dry-run` flag must be passed to actually trigger the release:

```sh
./renderers/scripts/upload_manifest.mjs --package=web_core --package=lit --no-dry-run
```

Confirmation emails from Exit Gate and npm reporting on the progress of the
actual publishing will be sent automatically. Publishing normally takes around
5 minutes.

**CLI parameters for `upload_manifest.mjs`:**

- `-p, --package=<name>`: Package(s) to trigger release for (e.g., `--package=lit`). Can be specified multiple times.
- `--no-dry-run`: Actually trigger the public release via Exit Gate. By default, the script runs in dry-run mode.

---

## What is the `publish:package` yarn script doing?

A2UI web packages depend on each other via `workspace:*` links during development. When `publish_npm.mjs` invokes a package's `publish:package` target, the following preparation steps occur:

1. **Build & Metadata Transformation**: `prepare-publish.mjs` copies build output into `dist/`, replaces internal `workspace:` protocols with absolute semantic version ranges (e.g., `^0.10.3`), and strips development scripts/dependencies.
2. **Boundary Isolation**: Because the root workspace config excludes `dist/` (`!**/dist`), an empty `yarn.lock` is initialized inside `dist/` to establish it as an independent package boundary.
3. **Clean Upload**: `yarn npm publish --access public` executes strictly inside `dist/`, ensuring only clean production assets are uploaded.

---

## What are valid values for the `--package` argument?

The `publish_npm.mjs` and `upload_manifest.mjs` scripts
work with all packages in the `renderers` directory of the monorepo:

- `web_core`
- `markdown-it`
- `angular`
- `lit`
- `react`

The scripts also support the full package names, e.g. `@a2ui/web_core`, but the
`@a2ui/` prefix is not required.

---

## Troubleshooting

- **Dirty Working Tree Warnings**: If build artifacts or temporary files
  persist, `yarn clean:all` can be run from the monorepo root before trying again.

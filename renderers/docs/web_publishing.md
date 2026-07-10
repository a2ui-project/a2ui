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

`increment_version.mjs` can be run on a local branch to bump package versions
and synchronize locks:

```sh
# Increment patch version automatically (e.g., 0.9.5 -> 0.9.6)
./renderers/scripts/increment_version.mjs web_core

# Set an explicit version
./renderers/scripts/increment_version.mjs lit 0.10.0-beta.1
```

This branch should be merged into `main` through a PR as with any other change
to the repo.

**CLI parameters for `increment_version.mjs`:**

- `<package-name>`: The name of the package to update (e.g., `web_core` or `@a2ui/web_core`).
- `[new-version]`: The specific new version to set (e.g., `1.0.1`). If omitted, increments the patch version automatically.
- `--skip-sync`: Skip synchronizing dependent packages (running `yarn install` in dependents). **Not recommended.**

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

The `increment_version.mjs`, `publish_npm.mjs` and `upload_manifest.mjs` scripts
work with all packages in the `renderers` directory of the monorepo:

- `web_core`
- `markdown-it`
- `angular`
- `lit`
- `react`

The scripts also support the full package names, e.g. `@a2ui/web_core`, but the
`@a2ui/` prefix is not required.

---

## 📦 2. Publishing `@a2ui/lit`, `@a2ui/angular`, and `@a2ui/markdown-it`

These packages depend on `@a2ui/web_core` via workspace paths for development. They must be published from their generated `dist/` folders. We use specialized scripts to automatically rewrite their `package.json` with the correct `@a2ui/web_core` npm version before publishing.

### Pre-flight Checks

1. Ensure `@a2ui/web_core` is already published (or its version string is correctly updated) since these packages will read that version number.
2. Update the `version` in the package you want to publish (e.g., `renderers/lit/package.json`).
3. Verify all tests pass:
   ```sh
   yarn workspace @a2ui/lit run test
   yarn workspace @a2ui/angular run test
   ```

### Publish to NPM

Run the automated publish script from the repository root:

**For Lit:**

```sh
yarn workspace @a2ui/lit run publish:package
```

**For Angular:**

```sh
yarn workspace @a2ui/angular run publish:package
```

**For Markdown-it:**

```sh
yarn workspace @a2ui/markdown-it run publish:package
```

### How It Works (Explanations)

**What happens during `publish:package`?**
Before publishing, the script runs the necessary `build` command which processes the code. For Lit and Markdown-it, `prepare-publish.mjs` runs, and for Angular, `postprocess-build.mjs` runs. These scripts:

1. Copy `package.json`, `README.md`, and `LICENSE` to the `dist/` folder.
2. Read the `version` from `@a2ui/web_core`.
3. Update the `workspace:` dependency in the `dist/package.json` to the actual core version (e.g., `^0.8.0`).
4. Adjust exports and paths to be relative to `dist/`.
5. Remove any build scripts (`prepublishOnly`, `scripts`) so they don't interfere with the publish process.

The script then `cd`s to the `dist/` directory and runs `yarn npm publish` to upload only the contents of the `dist/` directory to the npm registry.

Googlers can visit [go/a2ui-oss-exit-gate-artifacts](https://go/a2ui-oss-exit-gate-artifacts) to see the published artifacts on Exit Gate (staging registry).

---

## ✅ Post-Publish Verification

1. Verify that your package version is uploaded to the internal Artifact Registry staging environment.
2. Monitor the email notification from the OSS Exit Gate infrastructure confirming that public publication to npmjs.com has succeeded.
## Troubleshooting

- **Dirty Working Tree Warnings**: If build artifacts or temporary files
  persist, `yarn clean:all` can be run from the monorepo root before trying again.

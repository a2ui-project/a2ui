# Publishing Guide for A2UI Web Packages

This guide is for project maintainers. It details the publishing process to the npm registry for all web-related packages in this repository.

## Automated Release Workflow (Recommended)

The following scripts in `renderers/scripts/` automate the versioning, building, testing, and publishing of packages. These should generally be run from the `main` branch after a PR has been merged.

### Pre-requirement: Artifact registry configuration

_(Note: Only Googlers will be able to publish to the internal registry. Authentication is handled automatically when running release scripts.)_

In addition to being able to build the package (using `yarn` through `corepack`), ensure you are logged into `gcloud` CLI with your corporate credentials:

```sh
gcloud auth login
```

The automated release scripts (`publish_npm.mjs`) will automatically acquire an access token via `gcloud auth print-access-token` and pass it to Yarn Modern during publishing.

### 1. Increment Versions (Local)

To increment a package version and automatically sync all internal dependents (updating their `yarn.lock` files). This should be done in a PR:

```sh
# Automatically increment patch version (e.g. 0.9.5 -> 0.9.6)
renderers/scripts/increment_version.mjs web_core

# Set a specific version (e.g. including pre-releases)
renderers/scripts/increment_version.mjs lit 0.9.2-beta.1
```

This script will:

- Update the `package.json` of the target package.
- Scan the entire mono-repo for internal dependents (via `file:` links).
- Run `yarn install` in those dependents to update their lockfiles.

Then, prepare a PR with the changes to the `package.json` files, and have it landed into `main`.

### 2. Publish to Staging (Artifact Registry)

Once versions are updated and merged into `main`, use the `publish_npm` script to build, test, and upload the packages to Google's internal Artifact Registry.

```sh
# Publish multiple packages (they will be sorted automatically by dependency)
./renderers/scripts/publish_npm.mjs --package=lit --package=web_core
```

This script will:

- Obtain a token to interact with registry via `gcloud auth print-access-token`.
- Sort packages topologically (e.g., publishing `web_core` before `lit`).
- Verify that core packages (`web_core` and `markdown-it`) are available on the registry, and publish them if they're not.
- Skip packages that already exist on the registry, with a warning.
- For each package: `yarn install` -> `yarn test` -> `yarn run publish:package`.

**CLI parameters for publish_npm.mjs:**

- `--package=<name>`: The name of the package to publish (e.g: `--package=lit`). It can be passed multiple times to publish more than one package at a time.
- `--no-dry-run`: Actually uploads the packages to the artifact registry. By default, the script runs in dry-run mode.
- `--skip-tests`: Skips the `yarn test` phase before publishing. Not recommended.

### 3. Upload Manifest

Finally, trigger the public release to npmjs.com by uploading a manifest file:

```sh
./renderers/scripts/upload_manifest.mjs
```

This generates a `manifest.json` with the current versions of all renderer packages and uploads it to GCS to trigger the internal release infrastructure. You should receive an email from exit-gate noting that publishing has commenced.

**CLI parameters for upload_manifest.mjs:**

- `--package=<name>`: The name of the package to include in the manifest (e.g: `--package=lit`). It can be passed multiple times to publish more than one package at a time.
- `--no-dry-run`: Actually uploads the manifest to trigger the exit gate process. By default, the script runs in dry-run mode.

#### Manual alternative

You can upload the manifest manually, being authenticated with `gcloud` with:

```sh
gcloud storage cp manifest.json gs://oss-exit-gate-prod-projects-bucket/a2ui/npm/manifests/manifest.json
```

---

## Internal Release Process (Exit Gate)

The internal release infrastructure monitors the GCS bucket for new manifests. Once a manifest is uploaded, it triggers a series of checks and then publishes the specified versions to the public npm registry.

### 🏢 Internal Artifact Registry Setup (Exit Gate) - For Yarn Modern

The monorepo is fully configured in `.yarnrc.yml` to route `@a2ui` scoped packages to the internal Google Artifact Registry. Authentication is automatically injected via `gcloud` when running `./renderers/scripts/publish_npm.mjs`.

If you need to manually `yarn` publish or info commands that require registry access, export a token in your terminal:

```sh
export NPM_TOKEN=$(gcloud auth print-access-token)
```

## About the `publish:package` command

Because these are scoped packages (`@a2ui/`), they require the `--access public` flag to be published to the public registry. The `publish:package` script handles this automatically through a three-step isolation and release process:

1. **Build and Strip Workspace Metadata**: It executes `yarn build` and invokes `prepare-publish.mjs` (or equivalent post-processing). This copies the build artifacts into `dist/`, converts internal `workspace:` and `file:` dependency protocols into absolute semver ranges (e.g., `^0.10.1`), and removes `devDependencies`.
2. **Establish Standalone Package Boundary**: Because the monorepo root configuration explicitly excludes `dist` directories from workspace traversal (`!**/dist`), running Yarn commands directly inside `dist/` would ordinarily fail or traverse upward. To establish `dist/` as an authentic standalone package, the script initializes an empty lockfile (`touch yarn.lock`) inside `dist/` and executes `yarn install`.
3. **Publish Archive**: Finally, it executes `yarn npm publish --access public` from within the isolated `dist/` directory to upload the clean tarball to the registry.

```sh
yarn publish:package
```

---

### How It Works

### Pre-flight Checks

1. Ensure your working tree is clean and you are on the correct branch (e.g., `main`).
2. Update the `version` in `renderers/web_core/package.json`.
3. Verify all tests pass:
   ```sh
   yarn workspace @a2ui/web_core run test
   ```

### Publish to NPM

Run the automated publish script from the repository root:

```sh
yarn workspace @a2ui/web_core run publish:package
```

_Note: The script automatically builds the project, runs `prepare-publish.mjs` to copy artifacts to the `dist/` directory, and publishes from there as public access._

**What exactly gets published?**
Only the `dist/` directory contents are uploaded. This is controlled by the `"files"` array in `package.json` and the `prepare-publish.mjs` script.

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

## 🔖 Post-Publish

1. Tag the release (replace with actual version):
   ```sh
   git tag v0.8.0
   ```
2. Push the tag:
   ```sh
   git push origin v0.8.0
   ```
3. Create a GitHub Release mapping to the new tag.

## Troubleshooting

- If you get authorization errors, make sure you're logged in in the `gcloud` CLI. This can take
  a few seconds to propagate after you're authenticated.
- If you get weird build errors but everything passed in CI, your working copy is probably dirty.
  Try running `yarn clean:all` to remove old build artifacts.

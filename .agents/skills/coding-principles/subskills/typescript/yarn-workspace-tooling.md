# Subskill: Yarn Workspace Tooling & Script Invocation

## Activation Criteria

Activate this subskill when:

- PR modifies `package.json` scripts, GitHub workflow steps, publishing workflows, or shell scripts that run Node tooling or publish packages.
- PR modifies test runner configuration that spawns a dev server (`webServer` in Playwright, Vitest, or Karma configs).
- PR adds or edits READMEs or documentation snippets that contain `npm`, `npx`, or `pnpm` commands.

---

## Principles

### 1. Invoke Scripts and Tools Through Yarn, Never `npm` or `npx`

- **Problem & Rationale**: The repository is a Yarn Berry workspace monorepo. `npm run` and `npx` bypass Yarn's workspace resolution, ignore the pinned Yarn release, and can resolve a different binary version than the one in `yarn.lock`. Mixing package managers also makes commands inconsistent across packages, workflows, and docs.
- **Reviewer Checklist**:
  - [ ] Run package scripts with `yarn <script>` or, from the repository root, `yarn workspace <name> run <script>`.
  - [ ] Pass script arguments directly after the script name (`yarn dev --port 5173`). Do not insert the `--` separator that `npm run` requires.
  - [ ] Run one-off binaries with `yarn dlx <package>` instead of `npx <package>`.
  - [ ] Install dependencies with `yarn install --immutable` in CI and in documented setup steps.
  - [ ] Apply the rule to `package.json` scripts, GitHub workflow steps, test runner `webServer` commands, shell scripts, and documentation snippets alike.
  - [ ] When publishing a package from a built subdirectory (such as `dist/`), run `touch yarn.lock && yarn install` inside that subdirectory before running `yarn npm publish` so that Yarn Berry treats the subdirectory as its own project and publishes the generated `package.json` instead of the workspace one.
  - [ ] Accepted exception: `npx` remains only for tool bootstraps that the CI workflows already use, such as `npx playwright@<version> install --with-deps` in `.github/workflows/web_ci.yml`. Do not add new `npx` calls.

```ts
// BAD: npm bypasses Yarn workspace resolution and needs a "--" separator
webServer: {
  command: 'npm run dev -- --port 5173',
  url: 'http://localhost:5173',
},

// GOOD: Yarn runs the workspace script and forwards arguments directly
webServer: {
  command: 'yarn dev --port 5173',
  url: 'http://localhost:5173',
},
```

```yaml
# BAD: npm install resolves dependencies outside the Yarn lockfile
- run: npm install
- run: npx vitest run

# GOOD: immutable Yarn install and Yarn script invocation
- run: yarn install --immutable
- run: yarn workspace @a2ui/web_core run test
```

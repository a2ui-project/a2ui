# Description

Adds an end-to-end QA verification workflow (`.github/workflows/e2e_qa_verification.yml`) and verification scripts to test client renderers and sample apps across the repository.

### What is added:

1. **GitHub Actions workflow (`e2e_qa_verification.yml`)**:
   - Triggers on published releases, version tags (`v*`), or manual `workflow_dispatch`. Does not run automatically on regular PR pushes to conserve runner minutes.
   - Job 1 (`component-qa`): Node.js runner that tests all 11 samples in the repo for config file validity, runtime health, regression guards (e.g. Issue #1191 in the Lit client), interactive button bindings, and Quickstart prompts.
   - Job 2 (`fullstack-demos`): Matrix job that builds and verifies the 4 Getting Started demos (Lit, React, Angular, Flutter) against the Python agent backend.
   - Attaches screenshot and interaction clip artifacts and writes a summary report to `$GITHUB_STEP_SUMMARY`.
2. **Test and reporting scripts**:
   - `scripts/verify_samples.js`: Test runner checking static conformance, Lit client streaming guard, interactive actions, and quickstart prompts.
   - `scripts/generate_qa_summary.js`: Parses test results and formats a concise markdown report.
   - `scripts/capture_visual_proof.js`: Generates visual proof assets (sample screenshots, cross-framework comparison, and interaction recordings for Pong, Quiz, MCP Calculator, and the Restaurant Finder flow).
   - `scripts/test_demos.sh`: Helper script for building and verifying the 4 Getting Started demos locally or in CI.

### Why:

Verifying that changes do not break client renderers across the monorepo currently requires running each sample manually. This gives maintainers a release-triggered or on-demand check that verifies all 11 samples and the 4 Getting Started demos with visual proof.

### Testing:

- Tested locally on Linux.
- Tested on fork (`rohityan/a2ui`) with all 5 workflow jobs passing ([Run #34682886291](https://github.com/rohityan/a2ui/actions/runs/34682886291)):
  - Component & Button QA (11 Samples): passed (36s)
  - Verify Demo (flutter): passed (2m19s)
  - Verify Demo (react): passed (2m08s)
  - Verify Demo (angular): passed (1m57s)
  - Verify Demo (lit): passed (1m38s)

## Pre-launch Checklist

One time:

- [x] I signed the [CLA].
- [x] I read the [Contributors Guide].
- [x] I read the [Style Guide].
- [x] I have built and run at least one [sample].

For this PR:

- [ ] I have updated the relevant CHANGELOG.md file.
- [x] I updated/added relevant documentation.
- [x] My code changes (if any) have tests.
- [x] If my branch is on a fork, I have verified that [scripts/e2e_test.sh](https://github.com/a2ui-project/a2ui/blob/main/scripts/e2e_test.sh) passes.

# Description

## End-to-End QA Verification Suite for Demos and Samples

### Motivation
As `a2ui` expands across multiple client renderers (Lit, React, Angular, Flutter) and agent backends, verifying that changes do not break sample configurations, UI component schemas, or demo compilation currently requires manual setup across multiple frontend toolchains.

This PR introduces an automated release-gate and on-demand verification workflow (`.github/workflows/e2e_qa_verification.yml`) along with testing scripts to validate all 11 monorepo samples and the 4 Getting Started demos.

### Key Capabilities

1. **Selective CI Workflow (`e2e_qa_verification.yml`)**:
   - Runs on published releases (`release: published`), version tags (`v*`), or on-demand via `workflow_dispatch` (with target demo selection) to conserve runner minutes.
   - **Stage 1 (`component-qa`)**: Rapid Node.js runner that tests all 11 samples for static conformance, schema validity, runtime error guards (including Issue #1191 in the Lit client), and interactive button/prompt bindings.
   - **Stage 2 (`fullstack-demos`)**: Parallel matrix verification that compiles and verifies the 4 Getting Started demos (Lit, React, Angular, Flutter) against the Python agent backend.

2. **Automated Test & Lifecycle Scripts**:
   - `scripts/verify_samples.js`: Conformance and schema validation engine across all 11 samples.
   - `scripts/test_demos.sh`: Single entrypoint to build workspace renderers, compile demo clients, and manage Python agent lifecycles via in-process PID tracking.
   - `scripts/generate_qa_summary.js`: Formats test results into a dashboard for `$GITHUB_STEP_SUMMARY` with environment-resolved links.
   - `scripts/capture_visual_proof.js`: Produces storyboard comparisons and interaction recordings uploaded as workflow artifacts.

### Testing
- Tested locally on Linux across all 11 samples and 4 demo builds.
- Unit tests passed via Node test runner (`node --test scripts/qa_scripts.test.mjs`, 9/9 passing).
- Verified on fork with all 5 workflow jobs passing ([Run #34726440713](https://github.com/rohityan/a2ui/actions/runs/34726440713)):
  - Component & Button QA (11 Samples): passed (40s)
  - Verify Demo (flutter): passed (2m16s)
  - Verify Demo (react): passed (1m45s)
  - Verify Demo (angular): passed (1m57s)
  - Verify Demo (lit): passed (1m26s)

## Pre-launch Checklist

- [x] I signed the [CLA].
- [x] I read the [Contributors Guide].
- [x] I read the [Style Guide].
- [x] I have built and run at least one [sample].
- [x] I updated/added relevant documentation.
- [x] My code changes (if any) have tests.
- [x] If my branch is on a fork, I have verified that [scripts/e2e_test.sh](https://github.com/a2ui-project/a2ui/blob/main/scripts/e2e_test.sh) passes.

---
name: ci-workflows
description: >-
  Rules for the GitHub Actions workflows under .github/workflows/: every workflow that tests or
  validates the code runs nightly on main, can be started by hand, is not cancelled by pushes, and
  files an issue when its nightly run fails. Use when adding, changing, or reviewing a workflow
  file, its triggers, its concurrency group, or a path filter in it.
---

# CI workflows run nightly on main

Most workflows run on `main` only when a merged pull request touches their paths. When something outside the repository breaks one of them, such as a dependency release or a runner image update, nobody notices until the next pull request that touches those paths fails, and its author has to work out that their change did not cause it. So every workflow that tests or validates the code also runs every night against the latest `main`, and files an issue when that run fails ([#3753](https://github.com/a2ui-project/a2ui/issues/3753)).

[`scripts/check_workflows.py`](scripts/check_workflows.py) checks the rules below for every file in `.github/workflows/`. Presubmit lint runs it on every pull request. Run it after adding or changing a workflow:

```bash
uv run --no-project --with pyyaml==6.0.3 python3 .agents/skills/ci-workflows/scripts/check_workflows.py
```

A new workflow file is checked unless it is listed in `EXEMPT` in that script, so a new test workflow has to follow the rules from its first pull request.

## 1. Triggers

Add a `schedule` trigger with one daily cron, and a `workflow_dispatch` trigger:

```yaml
on:
  push:
    branches: [main]
    paths: [...]
  pull_request:
    paths: [...]
  # Catches breakage from outside the repository, such as a new dependency
  # release or runner image, when no change touches the paths above.
  schedule:
    - cron: '15 5 * * *' # daily at 05:15 UTC
  workflow_dispatch:
```

A `schedule` event ignores the `paths` filters of the other triggers, so the whole workflow runs. Give the workflow a time that no other workflow uses, and not on the hour, when Flutter CI starts its hourly run. The evals start at 00:00 UTC and the E2E tests at 01:30 UTC, and the other nightly runs start between 02:15 and 04:45 UTC, 15 minutes apart. Take the next free slot after the last one, so that the runs do not compete for runners.

`workflow_dispatch` lets a maintainer start the whole workflow from the Actions tab or with `gh workflow run <file>`, for example to check whether a nightly failure is fixed.

## 2. Concurrency group

If the workflow sets a concurrency group with `cancel-in-progress: true`, include `github.event_name` in the group key. Otherwise a push to `main` cancels the nightly run in progress, and that night has no result:

```yaml
# A scheduled run has a group of its own, so that a push does not cancel it.
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.ref_name || github.ref }}
  cancel-in-progress: true
```

## 3. Path filters inside jobs

On an event other than `push` or `pull_request`, `dorny/paths-filter` compares only the last commit, so a nightly run would skip whatever the last merged pull request did not touch. Skip the filter step on those events, and make every job or step that depends on it run when the filter did not:

1. Give the filter step `if: github.event_name == 'push' || github.event_name == 'pull_request'`. The checker requires this exact condition.
2. When jobs read the filter through job outputs, let each output fall back to `'true'`, as `web_ci.yml` and `docs.yml` do: `renderers: ${{ steps.filter.outputs.renderers || 'true' }}`. A filter output of `'false'` is a non-empty string, so it does not fall back.
3. When a step reads the filter directly, add `github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'` to its condition, as the iOS sample app build in `swift_build_and_test.yml` does.

A step with `if: github.event_name == 'pull_request'` does not run at night either. If it checks something, such as the build and link check in `docs.yml`, use `if: github.event_name != 'push'`. The checker cannot see these conditions, so check them yourself.

## 4. Failure report job

Add a `report-failure` job at the end of `jobs`:

```yaml
# Files an issue when the nightly run fails, or adds the run to the open
# issue. A manual run does not file one.
report-failure:
  needs: [<every job that no other job needs>]
  if: failure() && github.event_name == 'schedule'
  runs-on: ubuntu-latest
  permissions:
    # Lets create_issue.sh find the last passing run.
    actions: read
    contents: read
    issues: write
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - name: Create Issue
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: ./scripts/create_issue.sh "<name>" "ci_failure"
```

1. `needs` lists every job that no other job depends on. `failure()` is true when any job before it failed, so this covers the jobs those depend on. The checker names any job that `report-failure` does not wait for. Update `needs` when you add a job.
2. [`scripts/create_issue.sh`](../../../scripts/create_issue.sh) titles the issue "`<name>` failed on main for commit `<sha>`" and lists the pull requests merged since the last passing run. While that issue is open, it adds each new failing run to it as a comment, so a break that lasts a week files one issue. Give each workflow a name of its own; the checker rejects a name that another workflow uses.
3. The issue gets the `ci_failure` label, which `gh issue create` needs to exist in the repository.
4. A manual run does not file an issue, since whoever started it is watching it.

## 5. Workflows that do not run nightly

`EXEMPT` in `check_workflows.py` lists the workflows that need not follow these rules, each with the reason:

1. `e2e_test.yml` and `run_evals.yml` run nightly and file their issues from a step in the test job, with the `e2e_failure` and `eval_failure` labels.
2. `flutter_packages_test.yml` runs every hour. If it filed issues, it would add a comment every hour while it stays broken.
3. `pub_health.yml` checks the changelog of a pull request against its base branch, so a nightly run has nothing to check.
4. The release, triage and audit workflows do not test the code.

Add a workflow to `EXEMPT` only when it does not test or validate the code, or when a nightly run of it on `main` has nothing to check, and write down why.

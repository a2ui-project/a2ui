---
name: a2ui-release-python
description: Releases the Python SDKs (a2ui-core, a2ui-agent-sdk) to PyPI by running preflight checks, dispatching the release workflow as a dry run, confirming with the maintainer, publishing, and following the changelog pull request through to merge. Use when asked to cut, publish, or release a Python SDK version.
---

# Releasing the A2UI Python SDKs

This skill turns a one-line request such as _"release a2ui-core patch"_ or
_"release the Python SDKs"_ into the full release sequence.

Publishing is done by the
[Release Python SDKs](../../../.github/workflows/release-pypi.yml) workflow. This
skill does not reimplement any of it. Its job is the part the workflow cannot do
for itself: choosing the bump, catching the problems that a workflow run would
discover too late, and following through afterwards.

Background for anything not covered here:
[docs/contributing/release.md](../../../docs/contributing/release.md).

> [!CAUTION]
> **Publishing to PyPI is irreversible.** A version can be yanked but never
> reused or deleted. Step 4 is a mandatory stop. Never dispatch a run with
> `dry_run: false` without an explicit go-ahead from the maintainer in the
> current conversation.

### What runs where

**The workflow performs the release. Nothing here does.** Building, tagging,
pushing tags, staging in the Artifact Registry and triggering the Exit Gate all
happen inside `release-pypi.yml`, and only there. It could not be otherwise: the
Exit Gate authenticates by matching the OIDC claim
`…/release-pypi.yml@refs/heads/main`, so a local upload has no credentials to
use.

| Run locally                                    | Run by the workflow                               |
| :--------------------------------------------- | :------------------------------------------------ |
| `release_version.py notes`                     | `release_version.py plan` (authoritative)         |
| `release_version.py plan` (preview only)       | `release_version.py check`                        |
| `release_version.py check` (preview only)      | `release_version.py cut-changelog`                |
| `gh workflow run`, `gh run view`, `gh pr list` | `release_artifacts.py`, `confirm_pypi.py`         |
|                                                | `uv build`, `twine upload`, `git tag`, `git push` |

The local calls are limited to the read-only subcommands `notes`, `next`,
`current`, `tag`, `plan` and `check`. They exist to answer two questions before
spending a CI run: is there anything to release, and will preflight reject it.

> [!IMPORTANT]
> A local `plan` is a **prediction**, not the release. It is computed from the
> tags in the local checkout, so it is only as current as the last fetch — which
> is why Step 1 fetches first. The plan the workflow computes is the one that
> counts, and Step 3 reads it back out of the run before anyone approves it.

Never run `cut-changelog --write`, `git tag`, `git push`, `uv build` or `twine`
by hand to perform a release. If the workflow cannot do it, fix the workflow.

> [!IMPORTANT]
> One exception, and it is deliberate: **the changelog pull request has to be
> opened by a person, not by the workflow.** GitHub does not start workflow runs
> for events caused by `GITHUB_TOKEN`, so a pull request the workflow opened
> would never get the required checks and could never be merged. The workflow
> pushes the branch; Step 6 opens the pull request.

---

## Step 1: Work out what is being released

Two things are needed: `PACKAGE` (`a2ui-core`, `a2ui-agent-sdk`, or `both`) and
`BUMP` (`patch`, `minor`, or `major`). Derive both from the changelogs. Never
infer them from the phrasing of the request.

Fetch first. Versions are derived from tags, so every number below is wrong if
the checkout is behind:

```bash
git fetch origin main --tags
```

```bash
python3 .github/scripts/release_version.py notes --package a2ui-core
python3 .github/scripts/release_version.py notes --package a2ui-agent-sdk
```

**Choose the packages.** Release only those with a non-empty `## Unreleased`.
Empty output means that package has nothing to release, whatever was asked for.
A plural request such as _"release the Python SDKs"_ does not mean `both` — if
only one has pending entries, that one is the release. If neither does, stop and
say so.

Check the exit status, not just the output. The two failure shapes are
different answers:

| Result                     | Meaning                                                           | Do                                   |
| :------------------------- | :---------------------------------------------------------------- | :----------------------------------- |
| exit 0, output             | Entries pending                                                   | Release this package                 |
| exit 0, no output          | `## Unreleased` is empty                                          | Skip this package                    |
| exit 1, `error:` on stderr | Changelog is malformed, usually a missing `## Unreleased` heading | Stop. Report it and do not dispatch. |

> [!NOTE]
> Dispatching `both` when one side is empty is not dangerous, just wasteful. The
> plan builds, then preflight rejects the empty package and the run fails
> several minutes in. The check above costs a second.

**Choose the bump.** Read the entries: fixes only means `patch`, new features
mean `minor`, a breaking change means `major`. Preview the result with `plan`,
which returns exactly what the workflow will compute — version, tag and release
notes for every selected package:

```bash
python3 .github/scripts/release_version.py plan --package "${PACKAGE}" --bump "${BUMP}"
```

> [!IMPORTANT]
> **`both` applies one bump level to both packages.** The workflow takes a
> single `bump` input, so `build_plan` raises both versions by the same amount.
> When the two warrant different levels — say fixes in `a2ui-core` and a feature
> in `a2ui-agent-sdk` — there is no single right answer. Put the choice to the
> maintainer:
>
> - **Take the higher level for both.** One release, one changelog pull request.
>   The cost is an over-bumped version on the quieter package.
> - **Run two single-package releases.** Correct versioning, but the changelog
>   pull request from the first must be **merged before starting the second**,
>   or the Step 2 guard will block it. Release `a2ui-core` first if both are
>   going out, since `a2ui-agent-sdk` depends on it.

Put the proposal to the maintainer with `ask_question`, showing the pending
entries and the resulting versions, and let them correct it.

---

## Step 2: Preflight locally

These checks cost seconds and catch the failures that are expensive to hit
mid-run. Run all of them before dispatching anything.

**1. No outstanding changelog branch from a previous release.** This is the one
the workflow cannot detect. Until the last release's changelog lands, the
entries are still under `## Unreleased`, and this release would repeat them in
its notes.

```bash
git ls-remote --heads origin 'release/changelog-*'
```

Check the branch, not the pull request: the release stops at the branch, so
there may be no pull request yet. The repository deletes branches on merge, so
empty output means the last changelog landed.

Any output means stop. Get that change merged first — open the pull request if
nobody has — then start over from Step 1, because the pending entries will have
changed.

**2. The checkout is clean and matches the remote.** Step 1 already fetched. The
concern here is local edits: the workflow reads the changelogs and tags from
`main`, so an uncommitted changelog change makes the local preview describe a
release that is not the one that will go out.

```bash
git status --short --branch
```

Uncommitted changes under `agent_sdks/python/*/CHANGELOG.md`, or a branch behind
`origin/main`, mean stop and say what was found.

**3. The repository's own preflight passes.** Use the version from Step 1. This
is the same check the workflow runs, so a failure here is a failure there:

```bash
python3 .github/scripts/release_version.py check --package "${PACKAGE}" --version "${VERSION}"
```

It rejects an empty `## Unreleased`, a version that already has a tag, and an
`a2ui-core` version outside the range that `a2ui-agent-sdk` pins.

> [!IMPORTANT]
> That last one is the usual surprise. An `a2ui-core` **minor or major** bump
> needs the `a2ui-core>=...` pin in
> [a2ui_agent/pyproject.toml](../../../agent_sdks/python/a2ui_agent/pyproject.toml)
> widened in the same release. That is a code change requiring its own reviewed
> pull request, so it has to land before the release, not during it. If the
> check reports this, stop and tell the maintainer what needs widening.

---

## Step 3: Dry run

A dry run builds and stages the artifacts in the Exit Gate Artifact Registry,
removes them again, and pushes nothing.

```bash
gh workflow run release-pypi.yml --repo a2ui-project/a2ui --ref main \
  -f package="${PACKAGE}" -f bump="${BUMP}" -f dry_run=true
```

Wait a few seconds, then find the run and watch it:

```bash
gh run list --repo a2ui-project/a2ui --workflow=release-pypi.yml --limit 1 \
  --json databaseId,status,url
gh run watch "${RUN_ID}" --repo a2ui-project/a2ui --exit-status
```

> [!TIP]
> Use the full `databaseId`. A truncated run ID returns 404.

If it fails, read the failing step's log and consult Troubleshooting below
before retrying.

When it passes, read back the plan the run actually computed. The dry run does
not upload the plan artifact, and step summaries are not available over the API,
but the plan step prints the JSON into the log:

```bash
gh run view "${RUN_ID}" --repo a2ui-project/a2ui --log \
  | grep -A 20 'Build the release plan'
```

Compare it against the local `plan` output from Step 1. They are computed the
same way and should agree. If they differ, a tag landed in between — stop and
work out why before going any further.

---

## Step 4: Confirm with the maintainer

**Stop here.** Show the maintainer:

- the exact versions and tags from the dry run's plan,
- the changelog entries that will become the release notes,
- that the dry run passed.

Quote the version numbers in full, for example `a2ui-agent-sdk 0.7.0`. Do not
describe the release only as "a minor bump" — the bump level is the input, the
version is the irreversible consequence, and it is the version the maintainer
needs to approve.

Then ask for explicit confirmation to publish. Proceed only on a clear yes.

---

## Step 5: Publish

```bash
gh workflow run release-pypi.yml --repo a2ui-project/a2ui --ref main \
  -f package="${PACKAGE}" -f bump="${BUMP}" -f dry_run=false
```

Watch it as in Step 3. The run pushes the tags, stages the artifacts, uploads
the manifest that triggers the Exit Gate, and creates the GitHub releases.

Four jobs follow:

| Job         | What it does                               | If it fails                                                                                                                                      |
| :---------- | :----------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`     | Runs tests and builds distributions        | Test failure or malformed distribution. See Troubleshooting.                                                                                     |
| `release`   | Stages, tags, and triggers publishing      | Real failure. See Troubleshooting.                                                                                                               |
| `confirm`   | Polls PyPI, then links the GitHub releases | A timeout is not a failure. The hourly [Confirm PyPI publication](../../../.github/workflows/release-verify-pypi.yml) workflow finishes the job. |
| `changelog` | Pushes the changelog branch                | Publishing already succeeded. Cut the changelog by hand and open the PR yourself.                                                                |

> [!IMPORTANT]
> **The run stays active for several minutes after `release` goes green, and
> that is normal.** Triggering the Exit Gate is not publishing. The Exit Gate
> works asynchronously and reports only by email, so the `confirm` job sits and
> polls PyPI every 30 seconds for up to 20 minutes waiting for the version to
> appear.
>
> `gh run watch` blocks until all three jobs finish, so it is the wait. Let it
> run. Do not poll PyPI in a loop alongside it, and do not report the release as
> finished — or as failed — while `confirm` is still in progress.

---

## Step 6: Follow through

A release is not done when the workflow goes green.

1. **Confirm the version is live.** The waiting has already happened on the
   runner, so read the `confirm` job's outcome rather than starting a fresh
   wait:

   - **`confirm` succeeded** — the version is on PyPI and the GitHub releases
     have been updated with links. Verify once and move on:

     ```bash
     curl -s -o /dev/null -w '%{http_code}\n' "https://pypi.org/pypi/${PYPI_NAME}/${VERSION}/json"
     ```

     `200` confirms it. A `404` here, after `confirm` reported success, is a CDN
     lag of a minute or two — wait briefly and check again.

   - **`confirm` timed out** — publishing took longer than 20 minutes. **This is
     not a failed release.** The artifacts are staged and the Exit Gate still
     has them. Do not re-run the release, and do not try to publish the version
     again: that would burn a version number. Tell the maintainer it is
     outstanding, and leave it to the hourly
     [Confirm PyPI publication](../../../.github/workflows/release-verify-pypi.yml)
     workflow, which finds the release by its pending marker and links it once
     PyPI catches up. The Exit Gate also emails
     `a2ui-core-working-group@google.com` with the outcome either way.

   - **`confirm` failed for another reason** — read the log. The publish itself
     may still have succeeded, so check PyPI before concluding anything.

2. **Open the changelog pull request and get it merged.** The release pushed the
   branch but deliberately did not open the pull request — see "What runs
   where". Open it yourself:

   ```bash
   BRANCH=$(git ls-remote --heads origin 'release/changelog-*' \
     | sed 's#.*refs/heads/##')
   gh pr create --repo a2ui-project/a2ui --base main --head "$BRANCH" \
     --title "chore(release): changelog for ${RELEASED}" \
     --body "Moves the \`## Unreleased\` entries under the released versions."
   ```

   Check the diff touches only `CHANGELOG.md` files, then ask the maintainer to
   review it. Do not leave it open: Step 2 blocks the next release until the
   branch is gone.

3. **Report** the published versions, the GitHub release links, and the
   changelog pull request link.

---

## Troubleshooting

**`could not find any workflows named release-pypi.yml`** — the workflow is only
dispatchable once it is on `main`. Check it has merged.

**HTTP 403 from Artifact Registry** — the Exit Gate allowlists
`a2ui-project/a2ui` only. This is the expected result on a fork, and not a bug.
On the real repository it means the builder identity no longer matches; see
`go/oss-exit-gate-builders`.

**`Permission denied` or a failed OIDC exchange** — the Exit Gate matches the
workflow path and branch exactly:

```
github_workflow:a2ui-project/a2ui/.github/workflows/release-pypi.yml@refs/heads/main
```

Renaming or moving the workflow file breaks releases until the internal config
is updated. It also cannot be triggered from a branch or a tag, only `main`.

**`... is already on PyPI`** — the version was published previously. It cannot be
republished. Work out why the tag series and PyPI disagree before retrying.

**A dry run or failed staging left artifacts behind** — the cleanup step runs
even on partial failure, but if it was itself skipped, remove the staged version
by hand:

```bash
gcloud artifacts versions delete "${VERSION}" --package="${PYPI_NAME}" \
  --repository=a2ui--pypi --location=us --project=oss-exit-gate-prod --quiet
```

---

## Rules

- Never edit a version by hand. Versions come from git tags via `hatch-vcs`, and
  the workflow verifies the built artifacts against the version it planned.
- Never push tags or run the release scripts locally to publish. The scripts
  under `.github/scripts/` are safe to run read-only for `notes`, `next`,
  `current`, `tag`, and `check`. Everything else belongs to the workflow.
- Never dispatch `dry_run: false` without the Step 4 confirmation.
- If the maintainer asks to skip the dry run, push back once: it is the only
  rehearsal before an irreversible publish. Defer if they insist.

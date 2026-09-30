# Release process

## How to publish packages

Release cadence: every 1-2 weeks.

### Pub.dev publishing steps

**1. Identify publishable packages**

In the changelogs listed below, find the packages whose top version:

- is not `-wip...`
- is not published yet (follow the link in the CHANGELOG.md header to verify)

Changelogs:

- [a2ui_core CHANGELOG.md](../../dart/a2ui_core/CHANGELOG.md)
- [a2ui_agent CHANGELOG.md](../../dart/a2ui_agent/CHANGELOG.md)
- [genui CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genui/CHANGELOG.md)
- [genui_a2a CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genui_a2a/CHANGELOG.md)
- [genai_primitives CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genai_primitives/CHANGELOG.md)
- [json_schema_builder CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/json_schema_builder/CHANGELOG.md)

**2. Publish packages**

For each publishable package:

- Check out the latest `main`.
- Run `flutter pub publish`, making sure the console shows no warnings.
- Verify that the correct version was uploaded to pub.dev.

If any step fails, file a GitHub issue and inform the team.

For troubleshooting and maintenance, see [release-pub-dev.md](release-pub-dev.md).

### NPM

See [renderers/docs/web_publishing.md](../../renderers/docs/web_publishing.md).

### PyPI

Releasing `a2ui-core`, `a2ui-agent-sdk`, or both is performed by providing a prompt to an AI assistant:

```text
Release a2ui-core, a2ui-agent-sdk, or both with a <major|minor|patch> bump
```

The assistant uses the [`a2ui-release-python`](../../.agents/skills/a2ui-release-python/SKILL.md) skill to inspect changelogs, run local preflight checks, execute a dry run, confirm with you, trigger publishing via the GitHub Actions workflow, and open the changelog pull request. Once publication finishes, you only need to find a reviewer to approve and merge the pull request to update the changelog.

#### How it works behind the scenes

Publishing is handled by the [Release Python SDKs](../../.github/workflows/release-pypi.yml) workflow on `main`. There is no version file to edit and no package build or upload to run locally.

The workflow works out the new version from the latest release tag, tags the
release, builds, stages the artifacts in the OSS Exit Gate Artifact Registry,
and uploads the manifest that triggers publishing. The Exit Gate emails
`a2ui-core-working-group@google.com` when publishing starts and again when it
finishes. The GitHub release is updated with a link to the published version
once it appears on PyPI, either by the release run itself or by the hourly
[Confirm PyPI publication](../../.github/workflows/release-verify-pypi.yml)
workflow.

If an assistant is unavailable, maintainers can dispatch the workflow manually from the Actions tab on `main`. Always run with `dry_run: true` first to verify the plan and artifact staging before running with `dry_run: false`.

#### The release only pushes tags

`main` is covered by a ruleset that requires a pull request and allows no bypass
actors, so the workflow cannot push to it. Being refused mid-run would leave
artifacts staged in the Artifact Registry, so the workflow does not try: it
pushes only tags, which no ruleset covers, and raises the changelog edit as a
pull request afterwards.

Tags therefore point at the commit that was the tip of `main` when the run
started, not at the changelog commit. That is deliberate. The repository
requires linear history, so a tag created on a branch commit would be left
unreachable once the pull request is squashed, and the `git describe` check in
[python_ci.yml](../../.github/workflows/python_ci.yml) would start failing.

#### Why the workflow does not open the changelog pull request directly

The release workflow prepares the changelog edit on a `release/changelog-*` branch and
stops there. It could open the pull request, but that pull request could never
be merged: GitHub does not start workflow runs for events caused by the
built-in `GITHUB_TOKEN`, so none of the required checks would ever report, and
the ruleset allows no bypass. Opening it yourself from the link in the job
summary (or having an AI assistant open it using user credentials) allows
the required CI checks to run.

#### Versions come from git tags

Each package has its own tag series, `python/a2ui-core/v*` and
`python/a2ui-agent-sdk/v*`, and hatch-vcs derives the package version from it at
build time. Do not hand-edit a version anywhere; the `version.py` in each
package only reads the version back out of the installed distribution metadata.

A checkout without tags falls back to the version pinned as `fallback-version`
in `pyproject.toml`, which keeps shallow CI clones working. The release workflow
reads the version back out of every built artifact and fails if it does not
match the version it planned, so a release cannot go out on a fallback version.

#### Things that will stop a release

The preflight checks in
[release_version.py](../../.github/scripts/release_version.py) fail the run when
the Unreleased section is empty, when the target version already has a tag, and
when a proposed `a2ui-core` version falls outside the range that
`a2ui-agent-sdk` pins it to. That last one means a `a2ui-core` minor bump needs
the pin in
[a2ui_agent/pyproject.toml](../../python/a2ui_agent/pyproject.toml)
widened in the same release.

Releasing both packages together publishes `a2ui-core` first, because
`a2ui-agent-sdk` depends on it.

#### If authentication fails

The Exit Gate authorizes this repository through Workload Identity Federation,
matching the workflow file path and branch exactly against an allowlist entry in
Google's internal project config:

```
builders: "github_workflow:a2ui-project/a2ui/.github/workflows/release-pypi.yml@refs/heads/main"
```

Two consequences worth knowing. Renaming `release-pypi.yml` breaks releases
until the internal config is updated. And the workflow cannot be triggered by
pushing a tag, because the matched claim includes the triggering ref, which is
why the release is dispatched from `main` and creates its own tag rather than
being started by one.

To test access and artifact staging without publishing anything, run the
[Release Python SDKs](../../.github/workflows/release-pypi.yml) workflow with
`dry_run: true`. See go/oss-exit-gate-builders and go/oss-exit-gate-onduty.

### Documentation website

[MkDocs](https://www.mkdocs.org/), configured in [.github/workflows/docs.yml](../../.github/workflows/docs.yml), updates https://a2ui.org/ whenever the content of [docs/public](../public) changes.

## Internal troubleshooting and notes

See go/a2ui-release for internal information.

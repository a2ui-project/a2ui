---
name: a2ui-dart-versioning
description: Decides whether a change to a Dart package under dart/ needs a version bump, and how to write its CHANGELOG entry, by checking what is already published on pub.dev. Use before editing the version in a pubspec.yaml or adding a section to a CHANGELOG.md under dart/.
---

# Versioning the A2UI Dart packages

The Dart packages under `dart/` (`a2ui_core`, `a2ui_agent`) are published to
pub.dev from `main` by a maintainer, as described in
[docs/contributing/release.md](../../../docs/contributing/release.md). Several
pull requests usually land between two releases. Only the first of them opens a
new version. The rest add their notes to it.

The mistake this skill prevents is bumping the version on every pull request.
That produces versions that are never published, and the version bumps in two
open pull requests conflict.

## 1. Find out what is published

Read the package name from `pubspec.yaml`, then list the published versions:

```bash
curl -s https://pub.dev/api/packages/<name> | python3 -c \
  "import json, sys; print([v['version'] for v in json.load(sys.stdin)['versions']])"
```

The link in the heading of the package's `CHANGELOG.md` leads to the same
list. Do not guess from git history or tags: Dart releases are not tagged, and
a release commit only means the version was prepared.

## 2. Read the top section of the CHANGELOG

Compare the top section of `CHANGELOG.md` with that list:

- The heading is `## Unreleased`: the package collects notes there and sets
  the version only when it is released. Add your notes to that section and
  leave `version:` in `pubspec.yaml` untouched.
- The heading names a version that is not on pub.dev: that version is
  unreleased. Add your notes to its section and leave `version:` untouched.
- The heading names a version that is on pub.dev: open a new section above it
  with the next version (see below), and set `version:` in `pubspec.yaml` to
  the same value in the same pull request.

A package follows one of the first two conventions, and a pull request keeps
to the one it finds. The
[Pub Health](../../../.github/workflows/pub_health.yml) workflow checks that
the changelog is updated and agrees with `pubspec.yaml`.

## 3. Choose the next version

The rules are in
[docs/contributing/release-pub-dev.md](../../../docs/contributing/release-pub-dev.md):

- A `-wipNNN` version is followed by the next number, zero-padded to three
  digits: `0.0.1-wip004` becomes `0.0.1-wip005`.
- Before 1.0.0, a breaking change increments the minor number and any other
  change the patch number: `0.2.2` becomes `0.3.0` or `0.2.3`.
- A version that was already published is never reused.

## 4. Write the entry

- When notes go into an unreleased section, read the whole section first. An
  earlier pull request may describe something your change replaces, such as
  "Declared X as a stub" when you implement X. Rewrite those notes so the
  section describes the release as it will ship, rather than appending a
  second entry that contradicts the first.
- Describe what a user of the package sees: new API, changed behavior, and
  breaking changes marked `Breaking:`. Internal refactoring needs no entry.
- Another workspace package that depends on this one needs its constraint
  raised only if it uses API that the new version adds.

## 5. If a pull request already bumped the version

If an open pull request bumped the version but the previous version was never
published, put the version back to the unreleased one and merge the new notes
into its section, as in step 4.

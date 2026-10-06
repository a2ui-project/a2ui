---
name: a2ui-dart-versioning
description: Records a change to a Dart package under dart/ in its CHANGELOG.md, and explains how a release sets the version. Use before editing a CHANGELOG.md or the version in a pubspec.yaml under dart/.
---

# Versioning the A2UI Dart packages

The Dart packages under `dart/`, such as `a2ui_core` and `a2ui_agent`, are
published to pub.dev by a maintainer, as described in
[docs/contributing/release.md](../../../docs/contributing/release.md). Several
pull requests usually land between two releases, and only a release pull
request changes the version.

## Recording a change

- Add your notes to the `## Unreleased` section at the top of the package's
  `CHANGELOG.md`. If the package has no such section, add one above the newest
  version.
- Leave `version:` in `pubspec.yaml` untouched.
- Read the whole `## Unreleased` section first. An earlier pull request may
  describe something your change replaces, such as "Declared X as a stub" when
  you implement X. Rewrite those notes so the section describes the release as
  it will ship, rather than adding a second entry that contradicts the first.
- Describe what a user of the package sees: new APIs, changed behavior, and
  breaking changes marked `Breaking:`. Internal refactoring needs no entry.
- Another workspace package that depends on this one needs its constraint
  raised only if it uses the API that the next release adds.

## Releasing

A release is a pull request of its own. It moves the notes from
`## Unreleased` under a heading with the new version and sets `version:` in
`pubspec.yaml` to the same value. After it merges, the maintainer runs
`flutter pub publish` from the commit of that pull request.

The new version follows
[docs/contributing/release-pub-dev.md](../../../docs/contributing/release-pub-dev.md):

- A `-wipNNN` version is followed by the next number, zero-padded to three
  digits: `0.0.1-wip004` becomes `0.0.1-wip005`.
- Before 1.0.0, a breaking change increments the minor number and any other
  change the patch number: `0.2.2` becomes `0.3.0` or `0.2.3`.
- A version that was already published is never reused. Check the list on
  pub.dev, which the link in the heading of `CHANGELOG.md` leads to.

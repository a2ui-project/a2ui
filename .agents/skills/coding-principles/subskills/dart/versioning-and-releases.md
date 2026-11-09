# Subskill: Versioning the A2UI Dart Packages

## Activation Criteria

Activate this subskill when:

- Editing a `CHANGELOG.md` or `pubspec.yaml` under `dart/`.
- Adding, modifying, or removing public APIs or consumer-observable behavior in `dart/a2ui_core/`, `dart/a2ui_agent/`, `dart/a2ui_flutter/`, or `dart/a2ui_cli/`.
- Preparing a Dart package release pull request for `pub.dev`.

---

## Overview

The Dart packages under `dart/`, such as `a2ui_core` and `a2ui_agent`, are published to `pub.dev` by a maintainer, as described in [`docs/contributing/release/release.md`](../../../../../docs/contributing/release/release.md). Several pull requests usually land between two releases, and only a release pull request changes the version.

## Recording a Change

- Add your notes to the `## Unreleased` section at the top of the package's `CHANGELOG.md`. If the package has no such section, add one above the newest version.
- Leave `version:` in `pubspec.yaml` untouched.
- Read the whole `## Unreleased` section first. An earlier pull request may describe something your change replaces, such as "Declared X as a stub" when you implement X. Rewrite those notes so the section describes the release as it will ship, rather than adding a second entry that contradicts the first.
- Describe what a user of the package sees: new APIs, changed behavior, and breaking changes marked `Breaking:`. Internal refactoring needs no entry.
- Leave the constraint that other workspace packages have on this one untouched. The workspace resolves them against this package's `version:`, which only a release changes. If a dependent needs API that the next release adds, say so in the dependent's `## Unreleased` notes, and the release raises its constraint.

## Releasing

A release is a pull request of its own. It moves the notes from `## Unreleased` under a heading with the new version, adding that heading above the newest version if there are no notes, leaves an empty `## Unreleased` above it, and sets `version:` in `pubspec.yaml` to the same value. After it merges, the maintainer runs `flutter pub publish` from the commit of that pull request.

When `a2ui_core` is released, the packages that depend on it are handled as follows:

- If `a2ui_core` has a breaking change, every dependent is released too, even if its `## Unreleased` section is empty. Its `a2ui_core` constraint goes to `^<new a2ui_core version>`, its `CHANGELOG.md` notes the new constraint, and it gets a breaking version change, because its API exposes `a2ui_core` types. Otherwise the dependent on `pub.dev` still requires the old `a2ui_core`, and an app cannot install both.
- If `a2ui_core` has no breaking change, the dependents are left alone unless their `## Unreleased` sections have entries. Their `^` constraints already accept it.
- If a dependent's `## Unreleased` entries say it needs the new `a2ui_core`, its constraint is raised as well.

Publish `a2ui_core` first, and wait until `pub.dev` lists the new version before publishing the dependents.

The new version follows [`docs/contributing/release/pub-dev.md`](../../../../../docs/contributing/release/pub-dev.md):

- A `-wipNNN` version is followed by the next number, zero-padded to three digits: `0.0.1-wip004` becomes `0.0.1-wip005`.
- Before 1.0.0, a breaking change increments the minor number and any other change increments the patch number: `0.2.2` becomes `0.3.0` or `0.2.3`.
- A version that was already published is never reused. Check the list on `pub.dev`, which the link in the heading of `CHANGELOG.md` leads to.

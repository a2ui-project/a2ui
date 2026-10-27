# Maintenance information for publishing to pub.dev

This page contains maintenance information for publishing to pub.dev.
It is needed when main steps stop working or something needs to be changed.

For main publishing steps, see [release.md](release.md#pubdev-publishing-steps).

## Versioning

We use [Semver] for package versioning, although before 1.0.0, we will be
incrementing only the minor number for breaking changes and the patch number for
non-breaking changes.

<!-- references -->

[Semver]: https://semver.org/

Depending on the package category, the process of publishing to pub.dev follows different rules:

### The package is not published, and is not planned to be published

`pubspec.yaml` has `publish_to: none`.

### The package is planned to be published as production-ready (but wasn't published as such before)

The package should be published to pub.dev with a `-wip<three digit number>` suffix to reserve the name and maybe to try the package for development purposes.

### The package is published as production-ready

1. The package's `version:` in `pubspec.yaml` doesn't contain any suffix.
2. It is recommended to publish the changes after every pull requests.
3. If your feature is partially implemented, hide the feature's code behind a false-by-default flag, and make sure the version at `main` is still ready for production.

## CI

The following CI workflows support publishing, making sure the packages are always publish-ready:

In this repo:

- [pub_health.yaml](../../.github/workflows/pub_health.yml)

In genui repo:

- [pub_health.yaml](https://github.com/flutter/genui/blob/main/.github/workflows/pub_health.yaml)
- [pub_post_summaries.yaml](https://github.com/flutter/genui/blob/main/.github/workflows/pub_post_summaries.yaml)

## How to enable the workflows

For these workflows to function, the GitHub org needs to be configured.

This section instructs how to do that, in case some future reorg will require re-enabling them
(The permissions cover more than needed, because we may want to do more automation in future).

In https://github.com/organizations/a2ui-project/settings/actions:

1. Find the section "General actions permissions"
2. Either select "Allow all actions and reusable workflows" or choose "Allow enterprise, and select non-enterprise, actions and reusable workflows" and add these values (if they are already here, they will be de-dupped automatically):

    ```
    peter-evans/create-or-update-comment@*,
    peter-evans/create-pull-request@*,
    peter-evans/repository-dispatch@*,
    dart-lang/ecosystem/.github/workflows/health.yaml@*,
    dart-lang/ecosystem/.github/workflows/post_summaries.yaml@*,
    dart-lang/ecosystem/.github/workflows/publish.yaml@*,
    ```

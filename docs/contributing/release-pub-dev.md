# Pub.dev release process

This page contains maintenance information for releasing to pub.dev.

For main release steps, see [release.md](release.md).

## CI

CI workflows that support publishing, making sure the packages are always release-ready:

In this repo:

  - [pub_health.yaml](../../.github/workflows/pub_health.yml)

In genui repo:

  - [pub_health.yaml](https://github.com/flutter/genui/blob/main/.github/workflows/pub_health.yml)
  - [pub_post_summaries.yaml](https://github.com/flutter/genui/blob/main/.github/workflows/pub_post_summaries.yaml)

## How to enable the workflows

For these workflows to function, the GitHub org needs to be configured. 

This section instructs how to do that, in case some future reorg will require re-enabling them. The permissions cover more than needed, because we may
want to do more automation in future.

In https://github.com/organizations/a2ui-project/settings/actions:

1. Find the section "Allow or block specified actions and reusable workflows"
2. Add these values (if they are already here, they will be de-dupped automatically):

   ```
   peter-evans/create-or-update-comment@*,
   peter-evans/create-pull-request@*,
   peter-evans/repository-dispatch@*,
   dart-lang/ecosystem/.github/workflows/health.yaml@*,
   dart-lang/ecosystem/.github/workflows/post_summaries.yaml@*,
   dart-lang/ecosystem/.github/workflows/publish.yaml@*,
   ```



## Package categories

The maintained packages fall into the following categories:

1. **Not planned to be published**: `pubspec.yaml` contains `publish_to: none`. Workspace tools and example apps that are never pushed to pub.dev.
2. **Not yet published**: the package's `version:` ends with a `-wip<N>` suffix (see "Versioning" below). Not-ready-for-production versions are pushed to pub.dev to reserve the name and maybe to try the package in dev purposes.
3. **Published**: any other package. Each has its own version cadence on pub.dev.

## Versioning

We use [Semver] for package versioning, although before 1.0.0, we will be
incrementing only the minor number for breaking changes and the patch number for
non-breaking changes. After 1.0.0, we will be using standard Semver, bumping the
major number for breaking changes.

<!-- references -->

[Semver]: https://semver.org/ 

Version postfixes:

- **`-wip<three digit number>`**: not ready for production
- **no postfix**: release ready version, that should be pushed to pub.dev right after merging the PR that introduced the changes.

The packages code should be always release ready. That means:

1. Use `-wip` version (format `0.1.0-wip002`) if release-ready versions for this package were never published yet, and are planned to be published in the future. 

2. You can publish `-wip<number>` versions, if you need it for development, but do not merge `wip` versions for prod-ready published packages.

3. If your feature is partially implemented, hide the feature's code behind a false-by-default flag, and make sure the package is still ready to be released.

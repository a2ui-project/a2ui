# Release process

## How to release packages

Release cadance: every 1-2 weeks.

### Pub.dev release steps

For each packages, where the top version in CHANGELOG.md:

- is not `-wip...`
- and is not released yet (click link in the header to verify)

From main branch, release through `flutter publish`, making sure there is no warnings in console.

Changelogs of the packages:

- [a2ui_core](../../dart/a2ui_core/CHANGELOG.md)
- [a2ui_agent](../../dart/a2ui_agent/CHANGELOG.md)

For troubleshooting and maintanance check [release-pub-dev.md](release-pub-dev.md).

### NPM

See [renderers/docs/web_publishing.md](../../renderers/docs/web_publishing.md).

### Pypi

To release a new version of the SDK, follow these steps:

1. Check if there are entries in the Unreleased sections of the CHANGELOG files. If not, you are done.
    - a2ui_core [CHANGELOG](../../agent_sdks/python/a2ui_core/CHANGELOG.md)
    - a2ui_agent [CHANGELOG](../../agent_sdks/python/a2ui_agent/CHANGELOG.md)

2. Update the version in [version.py](../../agent_sdks/python/a2ui_agent/src/a2ui/version.py).

3. Run the [release.sh](../../agent_sdks/python/release.sh) script from the `agent_sdks/python` directory. The script will build the package, upload it to the Artifact Registry, and trigger the release pipeline.

### Documentation website

[Mkdocs](https://www.mkdocs.org/), configured in [.github/workflows/docs.yml](../../.github/workflows/docs.yml), updates https://a2ui.org/ every time when content of [docs/public](../public) changes.

## Internal troubleshooting and notes

See go/a2ui-release for internal information.

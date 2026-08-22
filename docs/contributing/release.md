# Release process

## How to publish packages

Release cadence: every 1-2 weeks.

### Pub.dev publishing steps

**1. Identify publishable packages**

Out of the package listed below, find those where the top version in the CHANGELOG.md:

- is not `-wip...`
- and is not published yet (click link in the header of the CHANGELOG.md
  to verify)

Changelogs:

- [a2ui_core CHANGELOG.md](../../dart/a2ui_core/CHANGELOG.md)
- [a2ui_agent CHANGELOG.md](../../dart/a2ui_agent/CHANGELOG.md)
- [genui CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genui/CHANGELOG.md)
- [genui_a2a CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genui_a2a/CHANGELOG.md)
- [genai_primitives CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/genai_primitives/CHANGELOG.md)
- [json_schema_builder CHANGELOG.md](https://github.com/flutter/genui/blob/main/packages/json_schema_builder/CHANGELOG.md)

**2. Publish packages**

For each publishable package:

- Make sure you're on the current version of the `main` branch.
- Run `flutter pub publish`.
- Make sure there are no warnings in console.
- Verify that the correct version of the package has been successfully uploaded to pub.dev.

If any of these steps fail, file a GitHub issue and inform the team.

For troubleshooting and maintenance check [release-pub-dev.md](release-pub-dev.md).

### NPM

See [renderers/docs/web_publishing.md](../../renderers/docs/web_publishing.md).

### Pypi

To release a new version of the SDK, follow these steps:

1. Check if there are entries in the unreleased sections of the CHANGELOG files. If not, you are done.
    - a2ui_core [CHANGELOG](../../agent_sdks/python/a2ui_core/CHANGELOG.md)
    - a2ui_agent [CHANGELOG](../../agent_sdks/python/a2ui_agent/CHANGELOG.md)

2. Update the version in [version.py](../../agent_sdks/python/a2ui_agent/src/a2ui/version.py).

3. Run the [release.sh](../../agent_sdks/python/release.sh) script from the `agent_sdks/python` directory. The script will build the package, upload it to the Artifact Registry, and trigger the release pipeline.

### Documentation website

[Mkdocs](https://www.mkdocs.org/), configured in [.github/workflows/docs.yml](../../.github/workflows/docs.yml), updates https://a2ui.org/ every time when content of [docs/public](../public) changes.

## Internal troubleshooting and notes

See go/a2ui-release for internal information.

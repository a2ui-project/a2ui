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

To release a new version of the SDK:

1. Check the unreleased sections of the CHANGELOG files. If they are empty, you are done.
    - a2ui_core [CHANGELOG](../../agent_sdks/python/a2ui_core/CHANGELOG.md)
    - a2ui_agent [CHANGELOG](../../agent_sdks/python/a2ui_agent/CHANGELOG.md)

2. Update the version in [version.py](../../agent_sdks/python/a2ui_agent/src/a2ui/version.py).

3. Run [release.sh](../../agent_sdks/python/release.sh) from the `agent_sdks/python` directory. It builds the package, uploads it to the Artifact Registry, and triggers the release pipeline.

### Documentation website

[MkDocs](https://www.mkdocs.org/), configured in [.github/workflows/docs.yml](../../.github/workflows/docs.yml), updates https://a2ui.org/ whenever the content of [docs/public](../public) changes.

## Internal troubleshooting and notes

See go/a2ui-release for internal information.

# Release process

## How to release packages

### Pub.dev

See https://github.com/flutter/genui/blob/main/docs/contributing/publishing.md.

### NPM

See https://github.com/a2ui-project/a2ui/blob/main/renderers/docs/web_publishing.md.

### Pypi

To release a new version of the SDK, follow these steps:

1. Check if there are entries in the Unreleased sections of the CHANGELOG files. If not, you are done.
   - a2ui_core [CHANGELOG](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_core/CHANGELOG.md)
   - a2ui_agent [CHANGELOG](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/CHANGELOG.md)

2. Update the version in [version.py](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/a2ui_agent/src/a2ui/version.py).

3. Run the [release.sh](https://github.com/a2ui-project/a2ui/blob/main/agent_sdks/python/release.sh) script from the `agent_sdks/python` directory. The script will build the package, upload it to the Artifact Registry, and trigger the release pipeline.


## Internal troubleshooting and notes

See go/a2ui-release for internal information.

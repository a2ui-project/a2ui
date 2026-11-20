# Specification v1.0

This directory contains the specification for version 1.0 of the A2UI protocol. This version was previously known as version 0.10.

**This specification is stable.** Breaking changes go into a future major version.

If you have proposed changes or new features, please open an issue or submit a pull request to the [A2UI repository](https://github.com/a2ui-project/a2ui).

## Core A2UI documentation

These documents describe the pure, transport-agnostic A2UI protocol:

- [Protocol specification](docs/a2ui_protocol.md): The core wire-level protocol envelopes, UI composition model, data binding rules, and execution boundaries.
- [Custom functions guide](docs/a2ui_custom_functions.md): How to define custom, application-specific renderer-side functions within your catalogs.
- [Evolution guide](docs/evolution_guide.md): The differences and migration paths between v0.9 and v1.0.

## Transport extensions

For integrations using specific communication channels, A2UI defines transport-specific extensions:

- [A2A (Agent-to-Agent) extension](extensions/a2a/docs/a2ui_extension_specification.md): The specification mapping A2UI envelopes into A2A messages, including Agent Card metadata and two-way data model synchronization.

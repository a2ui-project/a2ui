# Specification v1.0

This directory contains the specification for version 1.0 of the A2UI (Agent-to-UI) protocol. This version was previously known as version 0.10 when it was in draft.

**This specification is currently a candidate for becoming stable.**

Once a sufficient number of renderers are ported to use this version of the spec and feedback from that process has been incorporated, this will become the stable 1.0 release of the specification. There is a high bar for accepting breaking changes to a candidate specification.

If you have proposed changes or new features, please open an issue or submit a pull request to the [A2UI repository](https://github.com/a2ui-project/a2ui).

## Core A2UI documentation

These documents describe the pure, transport-agnostic A2UI protocol:

- [Protocol specification](docs/a2ui_protocol.md): The core wire-level protocol envelopes, UI composition model, data binding rules, and execution boundaries.
- [Custom functions guide](docs/a2ui_custom_functions.md): How to define custom, application-specific client-side functions within your catalogs.
- [Evolution guide](docs/evolution_guide.md): The differences and migration paths between v0.9 and v1.0.

## Transport extensions

For integrations using specific communication channels, A2UI defines transport-specific extensions:

- [A2A (Agent-to-Agent) extension](extensions/a2a/docs/a2ui_extension_specification.md): The specification mapping A2UI envelopes into A2A messages, including Agent Card metadata and two-way data model synchronization.

## Unreleased

- Initial release of `github.com/a2ui-project/a2ui/go/a2aext`, which connects the agent SDK to the
  Agent-to-Agent (A2A) protocol (`github.com/a2aproject/a2a-go`):
  - Extension URI helpers and `ActivateExtension` for A2UI v0.8, v0.9, v0.9.1, and v1.0.
  - `RendererCapabilitiesFromMessage` for reading and validating renderer capabilities on inbound
    A2A messages.
  - `DataPart` helpers and stream converters (`ToA2AParts`, `StreamPartsToA2AParts`,
    `StreamResponseToParts`, `ParseContentToParts`, and `ExtractA2UIJSONToParts`).

# A2UI Go A2A extension

`github.com/a2ui-project/a2ui/go/a2aext` (package `a2aext`) connects the [A2UI Go agent SDK](../agent/README.md) to the [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org) using [`github.com/a2aproject/a2a-go`](https://github.com/a2aproject/a2a-go).

## Installation

```bash
go get github.com/a2ui-project/a2ui/go/a2aext
```

## Package overview

1. Extension negotiation (`AgentExtension`, `ExtensionURI`, `ExtensionURIVersion`, `SelectNewestExtensionURI`, and `ActivateExtension`) builds the `a2a.AgentExtension` entries advertised on an `a2a.AgentCard` and activates the newest mutually supported A2UI version requested by the client.
2. Capability inspection (`RendererCapabilitiesFromMessage`) reads and validates renderer capabilities from an inbound `a2a.Message`, checking `Message.Metadata`, each `a2a.DataPart.Metadata`, and legacy `DataPart.Data["metadata"]` in order.
3. Part helpers (`CreateA2UIPart`, `CreateA2UIParts`, `IsA2UIPart`, `A2UIDataPart`, `A2UIMessages`, and `A2UIMessagesFromMessage`) wrap and unwrap A2UI envelopes in `a2a.DataPart` values with `application/a2ui+json` (v0.9.1 and v1.0) or `application/json+a2ui` (v0.8 and v0.9).
4. Response and stream converters (`ToA2AParts`, `StreamPartsToA2AParts`, `StreamResponseToParts`, `ParseContentToParts`, and `ExtractA2UIJSONToParts`) turn parsed or streamed LLM output into `a2a.Part` slices or `iter.Seq2` streams, returning parse errors alongside any `FallbackText` part so callers can retry or recover.

## Example

```go
package example

import (
	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/core"
)

func buildSample() {
	ext := a2aext.AgentExtension(core.Version1_0, &a2aext.AgentExtensionOptions{
		SupportedCatalogIDs: []string{"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"},
	})
	part := a2aext.CreateA2UIPart(core.AgentToRendererMessage{
		"version":       "1.0",
		"deleteSurface": map[string]any{"surfaceId": "main"},
	}, core.Version1_0)
	_, _ = ext, part
}
```

## Running tests

From the `go/` workspace directory:

```bash
cd go && go test ./a2aext/...
```

The shared conformance suite lives in [`conformance/extensions/a2a/a2a_integration.yaml`](../../conformance/extensions/a2a/a2a_integration.yaml).

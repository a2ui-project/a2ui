# A2UI Go Agent SDK (`github.com/a2ui-project/a2ui/go/agent`)

`github.com/a2ui-project/a2ui/go/agent` is the framework-agnostic Go Agent SDK for generating, streaming, validating, and decompiling A2UI payloads, negotiating renderer capabilities, and handling bidirectional function calls.

## Protocol support

For new projects, target **v1.0** (Current), defined in [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md). The SDK also supports v0.9, v0.9.1, and deprecated legacy v0.8 catalogs and wire envelopes where applicable.

## Package layout

1. Root package [`agent`](doc.go): capability negotiation (`Generator`, `RequestProcessor`, `ResolveCatalogs`, `ReadRendererCapabilities`), catalog providers and pruning transformers (`FileSystemCatalogProvider`, `InMemoryCatalogProvider`, `CatalogConfig`, `ComponentPruningTransformer`, `FunctionPruningTransformer`), Express DSL and Direct JSON formats (`ExpressFormat`, `DirectJSONFormat`), stateful multi-turn validation (`RendererState`, `ValidatePayload`), hybrid agent-renderer streaming (`StreamedAnswer`), bidirectional RPC in v1.0 and later (`RendererToAgentMessageProcessor`, `RendererFunctionCalls`), and skill generation (`SkillGenerator`, `SkillSet`).
2. [`agent/builder`](builder/doc.go), [`agent/builder/v1`](builder/v1/), and [`agent/builder/v09`](builder/v09/): typesafe component tree and function builders that flatten graphs into ordered wire messages.
3. [`agent/macros`](macros/doc.go): generic server-side composite UI macros (`MacroExpander`, `NewMacro`, `NewPureMacro`) with JSON Schema generation and transport-level expansion.

## Quick start

Register your agent's catalogs once on a `Generator`, negotiate a per-request `RequestProcessor` from the renderer's capabilities, inject `PromptSnippet()` into your model instructions, and stream chunks through `OpenStream` or `Stream`. Runnable versions of these snippets are in [`example_test.go`](example_test.go).

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func main() {
	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := agent.NewCatalogConfig(
		basicCat,
		&agent.ComponentPruningTransformer{AllowedComponents: []string{"Card", "Column", "Text", "Button"}},
	)
	if err != nil {
		log.Fatal(err)
	}

	// ExpressFormatFactory is the default; pass NewDirectJSONFormatFactory(nil) for <a2ui-json>.
	gen := agent.NewGenerator([]*agent.CatalogConfig{cfg}, nil)

	caps := core.RendererCapabilities{
		"1.0": {
			SupportedCatalogIDs: []string{basicCat.CatalogID()},
		},
	}
	proc, err := gen.CreateProcessor(caps, nil)
	if err != nil {
		log.Fatal(err)
	}

	systemInstructions, err := proc.PromptSnippet()
	if err != nil {
		log.Fatal(err)
	}
	_ = systemInstructions

	stream, err := proc.OpenStream(nil)
	if err != nil {
		log.Fatal(err)
	}
	chunks := []string{
		"Here is your card:\n<a2ui>\n",
		"surface(\"summary\")\nroot = Card(title)\ntitle = Text(\"Hello from Go\")\n",
		"</a2ui>",
	}
	for _, chunk := range chunks {
		parts, err := stream.Feed(chunk)
		if err != nil {
			log.Fatal(err)
		}
		for _, part := range parts {
			if part.IsText() {
				fmt.Println("Text:", part.Text)
			} else if part.IsA2UI() {
				fmt.Printf("A2UI messages (%d)\n", len(part.A2UI))
			}
		}
	}
	if _, err := stream.Close(); err != nil {
		log.Fatal(err)
	}
}
```

## Multi-turn state and bidirectional function calls

1. `RendererState` tracks active surfaces, component trees, and data models across turns with undo-log rollback (`Transaction`) when a block fails validation. Pass `&agent.ParseOptions{State: state}` or `&agent.StreamOptions{State: state}` across turns in the same conversation.
2. `StreamedAnswer` connects a `RequestProcessor` directly to a local `*core.MessageProcessor` for applications that run both the agent and the renderer in one process.
3. In v1.0 and later, `RendererToAgentMessageProcessor` validates inbound `action`, `error`, `callAgentFunction`, and `rendererFunctionResponse` envelopes and dispatches `core.AgentFunction` handlers registered on catalogs via `Catalog.CopyWith`. `RendererFunctionCalls` builds outbound `callRendererFunction` envelopes, tracks pending calls with configurable timeouts, and settles `PendingRendererCall` values when `Resolve` receives the matching `rendererFunctionResponse`.

## Running tests

From [`go/`](../README.md):

```bash
cd go
go vet ./agent/...
go test -race ./agent/...
```

To include the `scaling.yaml` growth and streaming-overhead benchmarks:

```bash
cd go
A2UI_RUN_TIMING=1 go test -race ./agent/...
```

See [`samples/agent/go/restaurant_finder`](../../samples/agent/go/restaurant_finder/README.md) for a working multi-turn HTTP and SSE agent server built with this module.

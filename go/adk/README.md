# A2UI Go ADK extension

`github.com/a2ui-project/a2ui/go/adk` connects the [A2UI Go agent SDK](../agent/README.md) to [Google's Agent Development Kit (ADK) for Go](https://google.github.io/adk-docs/) v2 (`google.golang.org/adk/v2`).

## Installation

```bash
go get github.com/a2ui-project/a2ui/go/adk
```

The module requires Go 1.26.10 or later, the minimum that ADK for Go v2 supports.

## Package overview

1. `SendA2UIToClientToolset` and `SendA2UIToClientTool` expose `send_a2ui_json_to_client` to an ADK `llmagent`. The tool appends the session processor's prompt instructions, compiles and validates `a2ui_payload` in the processor's inference format, sets `SkipSummarization = true` on valid payloads, and returns structured validation errors (`{"error": ...}`) so the model can self-correct.
2. `InstructionProvider` constructs an ADK instruction provider function that resolves `{key}` session-state placeholders in the agent's own instruction before appending `RequestProcessor.PromptSnippet()`, preventing ADK from misinterpreting A2UI `${expression}` bindings as session-state variables.
3. `ProcessorStore` (`Get` and `ForSession`) and `RendererCallsStore` (`Get` and `ForSession`) keep per-session `RequestProcessor` and `RendererFunctionCalls` instances in memory outside JSON-serialized ADK session state.
4. `PartConverter` and `EventConverter` translate GenAI model responses and ADK `session.Event` streams into A2A `DataPart` and `TaskStatusUpdateEvent` structures, feeding partial SSE chunks incrementally through `RequestProcessor.OpenStream()`.
5. `RPCCallback`, `RPCInterceptor`, `ExcludeRPCFromPrompt`, and `StripA2UIRPCParts` answer v1.0 `callAgentFunction` and `rendererFunctionResponse` turns deterministically without running an LLM step and strip RPC envelopes from subsequent model prompts.
6. Surface ownership helpers (`SurfaceOwner`, `SurfaceOwnerForClientEvent`, `SetSurfaceOwner`, `RemoveSurfaceOwner`, `UpdateSurfaceOwnership`, `StripUnownedSurfaces`, and `SurfaceIDAlreadyExistsError`) track which subagent owns each surface ID in ADK session state and strip unowned surfaces from `a2uiClientDataModel` payloads.

## Example

```go
package example

import (
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/tool"

	"github.com/a2ui-project/a2ui/go/adk"
)

func buildAgentConfig(processors *adk.ProcessorStore) llmagent.Config {
	toolset := adk.NewSendA2UIToClientToolset(adk.ToolsetConfig{
		EnabledProvider:   processors.IsEnabled,
		ProcessorProvider: processors.Get,
	})
	return llmagent.Config{
		Name:        "ui_assistant",
		Description: "Generates interactive A2UI surfaces.",
		InstructionProvider: adk.InstructionProvider(adk.InstructionConfig{
			Instruction:       "You help users in {city}.",
			EnabledProvider:   processors.IsEnabled,
			ProcessorProvider: processors.Get,
		}),
		BeforeModelCallbacks: []llmagent.BeforeModelCallback{
			adk.ExcludeRPCFromPrompt,
		},
		Toolsets: []tool.Toolset{toolset},
	}
}
```

### Connecting to A2A executors

1. In a custom `a2asrv.AgentExecutor` that iterates `runner.Run`, set the request's `RequestProcessor` in the `ProcessorStore` on every request (or clear it with `nil` for a request without A2UI), configure `adk.NewEventConverter(adk.EventConverterConfig{ProcessorProvider: processors.ForSession})`, and pass each yielded `*session.Event` to `ConvertEvent(ctx, sessionID, event, taskID, contextID)`. The converter returns `TaskStatusUpdateEvent` messages and sends each A2UI message as soon as it is complete, as the Python SDK's `A2uiEventConverter` does inside ADK's Python `A2aAgentExecutor`. [`pipeline_test.go`](pipeline_test.go) has a complete executor.
2. ADK for Go's own A2A executor, `google.golang.org/adk/v2/server/adka2a`, converts each GenAI part to one A2A part, but one A2UI tool response or block becomes several `DataPart`s. Inside `BeforeExecuteCallback`, store the session's `RequestProcessor` in `ProcessorStore` (the executor uses the A2A context ID as the session ID) and call `RPCInterceptor.BeforeAgent`. Inside `AfterEventCallback`, replace `processed.Artifact.Parts` with the parts that `adk.NewPartConverter(proc, nil)` returns, and call `RPCInterceptor.AfterAgent` from `AfterExecuteCallback`. [`adka2a_test.go`](adka2a_test.go) runs this recipe. ADK for Go v2 deprecates `server/adka2a` in favor of `server/adka2a/v2`, which uses A2A 1.0 types; this SDK, like the Python SDK, sends A2UI over A2A 0.3, so use `server/adka2a`.

## Running tests

From the `go/` workspace directory:

```bash
cd go && go test ./adk/...
```

The shared conformance suite lives in [`conformance/extensions/adk/adk_extensions.yaml`](../../conformance/extensions/adk/adk_extensions.yaml).

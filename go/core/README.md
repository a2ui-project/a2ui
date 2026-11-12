# A2UI Go core library

`github.com/a2ui-project/a2ui/go/core` is the protocol and state layer of the Go SDK. It holds the A2UI message schemas, the component and function catalogs, JSON Schema validation, the reactive data model, `${...}` expression evaluation, and the processor that applies agent messages to surfaces. The agent SDK ([`go/agent`](../agent/README.md)) and the A2A and ADK integrations build on it, and the same types serve renderer-side code written in Go.

The package has no UI dependencies and makes no network or file system calls: the specification schemas and the published catalogs are embedded in the module.

## Protocol versions

The package reads and validates v0.8, v0.9, v0.9.1 and v1.0 messages. For new projects, use v1.0, defined in [`specification/v1_0/docs/a2ui_protocol.md`](../../specification/v1_0/docs/a2ui_protocol.md). Bidirectional function calls (`callRendererFunction`, `callAgentFunction`) and agent functions exist only from v1.0. v0.8 is deprecated and supported so that servers can still read payloads from older clients.

Versions are named by the `ProtocolVersion` constants `Version0_8`, `Version0_9`, `Version0_9_1` and `Version1_0`. `ToProtocolVersion` accepts the spellings that appear on the wire, such as `"1.0"`, `"v1.0"` and `"v0.9.1"`.

## Installation

```bash
go get github.com/a2ui-project/a2ui/go/core
```

The module requires Go 1.26 or later.

## Usage

This program validates a v1.0 `createSurface` message against the basic catalog and reads the resulting data model. It is the `ExampleMessageProcessor` test in [`example_test.go`](example_test.go), so it runs with the package tests.

```go
package main

import (
	"errors"
	"fmt"
	"log"

	"github.com/a2ui-project/a2ui/go/core"
)

func main() {
	catalog, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		log.Fatal(err)
	}
	strict := core.StrictValidation()
	processor, err := core.NewMessageProcessor([]*core.Catalog{catalog}, &core.MessageProcessorOptions{
		ValidationConfig: &strict,
	})
	if err != nil {
		log.Fatal(err)
	}

	err = processor.ProcessMessages([]core.AgentToRendererMessage{{
		"version": "1.0",
		"createSurface": map[string]any{
			"surfaceId": "main",
			"catalogId": catalog.CatalogID(),
			"dataModel": map[string]any{"user": map[string]any{"name": "Ada"}},
			"components": []any{
				map[string]any{"id": "root", "component": "Text", "text": map[string]any{"@path": "/user/name"}},
			},
		},
	}}, nil)
	var validationErr *core.ValidationError
	if errors.As(err, &validationErr) {
		log.Fatalf("message rejected at %s: %v", validationErr.Path, validationErr)
	} else if err != nil {
		log.Fatal(err)
	}

	name, _, _ := processor.Model.Surface("main").DataModel.Get("/user/name")
	fmt.Println(name) // Ada
}
```

When a message is rejected, the processor also builds the protocol error envelope (`{"version": ..., "error": {"code", "message", "surfaceId", "path"}}`) and passes it to `MessageProcessorOptions.ErrorHandler` and to the `OutboundListener`, so a server can return it to the agent unchanged. `ExampleMessageProcessor_validationError` shows this.

## Main types

1. `Catalog` describes the components and functions a surface may use. `BasicCatalog` and `MCPCatalog` return the published catalogs. `CatalogFromJSON` and `CatalogFromJSONBytes` load any catalog document; the byte form also records the document's key order (`KeyOrder`). `ToJSON` serializes a catalog back to its document. `Derive` builds a catalog under a new ID from entries of an existing one, and `CopyWith` prunes entries or attaches agent functions. `ValidationSchema` returns the self-contained schema the validator compiles.
2. `MessageProcessor` validates agent-to-renderer messages and applies them to a `SurfaceGroupModel`. Validation covers the message envelope, each component against its catalog, function calls and their arguments, reserved `@` keys, component topology (cycles, dangling references, orphans and nesting depth) and the `allowedParents` and `allowedChildren` composition rules. The components of one message are applied only if all of them are valid, and a `createSurface` whose inline components or data are invalid is rolled back. `RendererCapabilities` and `RendererDataModel` build the payloads a renderer sends back to the agent.
3. `ValidationConfig` selects the checks: `StrictValidation` rejects everything the specification forbids, and `RelaxedValidation` accepts the partial trees that appear while a response is still streaming. A per-call config in `ExecutionContext` overrides the processor's own for that call.
4. `DataModel` stores a surface's data and resolves RFC 6901 JSON Pointers. `Set` creates missing objects and arrays along the path, setting a key to `nil` deletes it, and `Watch` reports the changes that affect a path.
5. `DataContext` resolves dynamic values, that is `@path` bindings and `@call` function calls (`path` and `call` before v1.0), relative to a scope. `ParseExpressionTemplate` parses the `${...}` templates that `formatString` interpolates.
6. `PayloadValidator` validates single components, function arguments and themes against a catalog, and `ValidateCommonType` validates a value against one definition of a version's `common_types.json`.
7. `RPCHandler` runs the v1.0 function calls in both directions: it answers `callRendererFunction` with `rendererFunctionResponse`, and sends `callAgentFunction` for a function the renderer does not implement, correlating each `agentFunctionResponse`, with timeouts and cancellation. `MessageProcessor.RPC` is the processor's handler.
8. `NodeResolver` turns a surface's flat component map into a tree of `ComponentNode` values with resolved props, two-way `ResolvedBinding` values and callable `ResolvedAction` values, and updates the tree as components and data change.
9. `CheckRegexSafety` and `RegexTest` implement the portable regular expression subset that the `regex` validation function accepts, so a pattern behaves the same in every SDK.

Errors are typed. Use `errors.As` with `*ValidationError`, `*IntegrityError`, `*RecursionError`, `*CatalogError`, `*DataError`, `*ExpressionError`, `*ParseError`, `*StateError` or `*RPCError`; each wraps an `*A2UIError`, which carries the code, path, surface ID and per-field details. `*IntegrityError` and `*RecursionError` also match `*ValidationError`.

## Limits

The validator and evaluator stop on inputs that could exhaust memory or time. Component trees and message payloads may nest at most 50 levels, and function calls at most 5. An expression template may be at most 10,000 characters long. A `regex` pattern may be at most 256 code points long, and an input longer than 4,096 code points never matches. Patterns outside the portable subset, and patterns that make backtracking engines slow (nested quantifiers, or alternatives and adjacent repeats that can match the same text), are refused.

## Concurrency

A `Catalog` is safe for concurrent use once loaded, apart from `SetFunctionEvaluator`. A `MessageProcessor` and the surfaces, data models and node resolvers it owns are not: use each from one goroutine at a time, or guard it with your own lock.

## Testing

Run the commands from the `go/` directory. The workspace has no root module, so name the module explicitly:

```bash
cd go
go test -race ./core/...
```

The module also tests on its own, outside the workspace:

```bash
cd go/core
GOWORK=off go test ./...
```

`TestConformanceSuite` runs every suite in [`conformance/core`](../../conformance/core) (see [`conformance/README.md`](../../conformance/README.md)). The timing suite, `message_processor_scaling.yaml`, runs only when `A2UI_RUN_TIMING=1` is set. Two suites test UI framework renderers, which this package does not include, so their cases are recorded as skipped: `accessibility.yaml` and `adapter_conformance.yaml`. One case in `agent_function_routing.yaml` is also skipped, because `DataModel` does not notify watchers when a path is set to an equal value; the rule it tests is covered by the case after it.

To record which cases ran, set `A2UI_CONFORMANCE_MANIFEST_DIR`. The test writes `go-core.jsonl` there, which the corpus check reads:

```bash
DIR=$(mktemp -d)
(cd go && A2UI_CONFORMANCE_MANIFEST_DIR="$DIR" go test ./core/)
uv run --project conformance python conformance/scripts/check_executed_cases.py \
  --manifest-dir "$DIR" --harness go-core --corpus core
```

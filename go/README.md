# A2UI Go SDKs

This workspace contains the Go implementations of the A2UI state engine, framework-agnostic agent SDK, A2A protocol extension, and Google ADK integration.

## Protocol support

For new projects, target **v1.0** (Current), defined in [`specification/v1_0/docs/a2ui_protocol.md`](../specification/v1_0/docs/a2ui_protocol.md). The Go packages also support v0.9, v0.9.1, and deprecated legacy v0.8 payloads where applicable so multi-version servers can interoperate with older clients.

## Modules

| Module                                   | Directory                     | Description                                                                                                                                                                                                                                        |
| :--------------------------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github.com/a2ui-project/a2ui/go/core`   | [`core/`](core/README.md)     | Core protocol schemas, catalogs, `DataModel`, `${...}` expressions, portable regex validation, `PayloadValidator`, `MessageProcessor`, `RPCHandler`, and `NodeResolver`.                                                                           |
| `github.com/a2ui-project/a2ui/go/agent`  | [`agent/`](agent/README.md)   | Framework-agnostic Agent SDK: `Generator`, `RequestProcessor`, Express DSL and Direct JSON streaming parsers/compilers/decompilers/prompt generators, `RendererState`, typesafe `builder`, `macros`, `SkillGenerator`, and v1.0 bidirectional RPC. |
| `github.com/a2ui-project/a2ui/go/a2aext` | [`a2aext/`](a2aext/README.md) | Agent-to-Agent (A2A) extension negotiation, capability extraction, and `DataPart` streaming helpers built on `github.com/a2aproject/a2a-go`.                                                                                                       |
| `github.com/a2ui-project/a2ui/go/adk`    | [`adk/`](adk/README.md)       | Google ADK for Go v2 integration: `SendA2UIToClientToolset`, `InstructionProvider`, session stores, `PartConverter`, `EventConverter`, RPC callbacks/interceptors, and subagent surface ownership helpers.                                         |

## Sample agent

See [`samples/agent/go/restaurant_finder`](../samples/agent/go/restaurant_finder/README.md) for a complete A2A HTTP JSON-RPC and SSE agent server supporting v1.0 and v0.9 across both Express DSL and Direct JSON formats.

## Building and testing

From the repository root, run the commands inside the `go/` workspace. `go.work` has no root module, so name each module explicitly rather than using `./...`:

```bash
cd go
go build ./core/... ./agent/... ./a2aext/... ./adk/...
go vet ./core/... ./agent/... ./a2aext/... ./adk/...
go test -race ./core/... ./agent/... ./a2aext/... ./adk/...
```

Each module also builds and tests independently with `GOWORK=off` using its relative `replace` directives:

```bash
(cd go/core && GOWORK=off go test ./...)
(cd go/agent && GOWORK=off go test ./...)
(cd go/a2aext && GOWORK=off go test ./...)
(cd go/adk && GOWORK=off go test ./...)
```

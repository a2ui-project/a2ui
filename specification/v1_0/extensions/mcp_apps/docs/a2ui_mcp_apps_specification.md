# SEP-XXXX: A2UI over MCP Apps Protocol Extension (v1.0)

**Track:** Extensions

**Status:** Draft

**Created:** 2026-08-18

## Abstract

This specification defines the standard protocol extension for delivering A2UI (Agent-to-User Interface) v1.0 interactive interfaces over the Model Context Protocol (MCP) and MCP Apps. By combining A2UI with MCP, servers and AI agents can provide dynamic, streaming, and stateful user interfaces directly to host clients. The protocol introduces a dual-mode capability negotiation mechanism that prioritizes native, iframe-free A2UI rendering while maintaining a robust HTML iframe fallback for broader compatibility.

## Motivation

While MCP Apps (SEP-1865) introduced a standardized pattern for declaring UI resources via the `ui://` URI scheme and rendering them in sandboxed iframes, it enforces an iframe-centric architecture. For native hosts that integrate A2UI rendering capabilities directly (using Angular, Android Mobile, iOS, Flutter, etc.), the iframe sandbox introduces unnecessary overhead, limits visual integration, and complicates event dispatching. 

Without this A2UI extension:
- Hosts incur the performance and memory overhead of double-iframe sandboxes.
- Seamless, zero-latency communication between the host application and the A2UI surface is impeded.
- Developers must maintain separate UI rendering paradigms for native and MCP contexts.

This specification addresses these limitations through an optional capability negotiation. It enables hosts with native A2UI rendering to receive raw UI payloads (`application/a2ui+json`) directly via MCP tools and resources, bypassing the iframe sandbox while retaining full HTML fallback support (`text/html;profile=mcp-app`) for legacy hosts.

## Specification

### Extension Identifiers

- **Extension URI**: `https://a2ui.org/mcp-apps-extension/a2ui/v1.0`
- **Capability Identifier**: `io.modelcontextprotocol/ui`
- **Native A2UI MIME Type**: `application/a2ui+json`
- **MCP App HTML MIME Type**: `text/html;profile=mcp-app`

### Overview

The A2UI MCP Apps extension enables servers to deliver interactive user interfaces to hosts through two rendering modes:

1. **Native A2UI Mode (Preferred)**: When the host client supports native A2UI (`application/a2ui+json`), UI payloads are delivered directly as MCP resources or embedded tool call results. The host application renders the UI natively using client-side A2UI renderers with zero iframe overhead, ensuring full fidelity with host styling and responsive layouts.
2. **Iframe Sandboxed Mode (Fallback)**: When the host client only supports standard MCP Apps HTML interfaces (`text/html;profile=mcp-app`), the server serves a self-contained HTML/JS bundle. The bundle embeds an isolated A2UI runtime inside a sandboxed iframe, communicating back to the host via MCP Apps JSON-RPC `postMessage` protocol.

### Capability Negotiation (`initialize`)

Clients advertise supported UI rendering capabilities to the MCP server during the initial MCP `initialize` handshake within `capabilities.extensions`.

#### Client Initialization Request

When connecting to the MCP server, a client supporting native A2UI and/or fallback MCP App HTML includes `io.modelcontextprotocol/ui` in its extension capabilities:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": {
      "name": "a2ui-host-client",
      "version": "1.0.0"
    },
    "capabilities": {
      "extensions": {
        "io.modelcontextprotocol/ui": {
          "mimeTypes": [
            "text/html;profile=mcp-app",
            "application/a2ui+json"
          ]
        }
      }
    }
  }
}
```

#### Server Capability Detection

Servers MUST inspect the `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` array during connection or tool invocation:

- If `application/a2ui+json` is present in `mimeTypes`: The server SHOULD deliver native A2UI JSON payloads (`application/a2ui+json`).
- If only `text/html;profile=mcp-app` is present: The server MUST provide the sandboxed HTML application bundle.

#### Component Catalog Capability Advertisement

To render native A2UI payloads, the host MUST declare the specific A2UI component catalogs it supports. Clients declare these capabilities either globally during connection setup or per-message.

**Option A: During MCP Initialization (Recommended)**

Because MCP is a stateful session protocol, the most efficient approach is to declare capabilities once during connection setup. The client declares its A2UI support under the root `capabilities` object:

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "id": "init-123",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": {
      "name": "a2ui-enabled-client",
      "version": "1.0.0"
    },
    "capabilities": {
      "a2ui": {
        "clientCapabilities": {
          "v1.0": {
            "supportedCatalogIds": [
              "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ]
          }
        }
      }
    }
  }
}
```

The server stores this state for the duration of the session.

**Option B: Per-Message Metadata (For Stateless Servers)**

If the server must remain stateless, the client CAN pass A2UI capabilities in the `_meta` field of every tool call:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": "id-123",
  "params": {
    "name": "generate_report",
    "arguments": {"date": "2026-03-01"},
    "_meta": {
      "a2ui": {
        "clientCapabilities": {
          "v1.0": {
            "supportedCatalogIds": [
              "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ],
            "inlineCatalogs": []
          }
        }
      }
    }
  }
}
```

### Resource Delivery (`resources/read`)

Clients can fetch UI definitions directly as static or dynamically generated resources.

#### Native A2UI Resource

When reading a native A2UI resource (e.g., `a2ui://counter-view`), the server returns `ReadResourceContents` with `mimeType: "application/a2ui+json"`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "a2ui://counter-view",
        "mimeType": "application/a2ui+json",
        "text": "{\"version\":\"v1.0\",\"createSurface\":{\"surfaceId\":\"counter-surface\",\"catalogId\":\"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json\",\"components\":[{\"id\":\"root\",\"component\":\"Column\",\"children\":[\"title\",\"counter_text\",\"btn_inc\"]},{\"id\":\"title\",\"component\":\"Text\",\"text\":\"MCP Interactive Counter\"},{\"id\":\"counter_text\",\"component\":\"Text\",\"text\":\"Current count: 0\"},{\"id\":\"btn_inc\",\"component\":\"Button\",\"text\":\"Increment\",\"action\":{\"event\":{\"name\":\"increment_counter\",\"context\":{}}}}]}}"
      }
    ]
  }
}
```

#### Fallback HTML MCP App Resource

If the client does not support native A2UI, reading `ui://counter-view` returns standard `text/html;profile=mcp-app` that bundles an A2UI renderer in the payload to render A2UI:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "ui://counter-view",
        "mimeType": "text/html;profile=mcp-app",
        "text": "<!DOCTYPE html><html><head><script type=\"module\" src=\"app.js\"></script></head><body><div id=\"root\"></div></body></html>"
      }
    ]
  }
}
```

### Tool Result Delivery (`tools/call`)

When an MCP Tool produces UI output, the server determines the response format based on the client's declared capabilities.

#### Native A2UI Tool Result

If the client supports native A2UI, the server returns a `CallToolResult` containing an `EmbeddedResource` with `mimeType: "application/a2ui+json"`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Counter successfully loaded."
      },
      {
        "type": "resource",
        "resource": {
          "uri": "a2ui://counter-state",
          "mimeType": "application/a2ui+json",
          "text": "[{\"version\":\"v1.0\",\"createSurface\":{\"surfaceId\":\"counter\",\"catalogId\":\"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json\"}},{\"version\":\"v1.0\",\"updateDataModel\":{\"surfaceId\":\"counter\",\"path\":\"/count\",\"value\":42}}]"
        }
      }
    ]
  }
}
```

#### Fallback HTML MCP App Tool Result

If the client does not support native A2UI, the server falls back to returning a standard `CallToolResult` containing an `EmbeddedResource` with `mimeType: "text/html;profile=mcp-app"`. This resource contains a self-contained HTML bundle that includes an A2UI renderer to render the interface inside a sandboxed iframe:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Counter successfully loaded."
      },
      {
        "type": "resource",
        "resource": {
          "uri": "ui://counter-state",
          "mimeType": "text/html;profile=mcp-app",
          "text": "<!DOCTYPE html><html><head><script type=\"module\" src=\"app.js\"></script></head><body><div id=\"root\"></div></body></html>"
        }
      }
    ]
  }
}
```

### Action-to-Tool Mapping

Interactive A2UI components trigger user actions with an `event.name` and an `event.context` payload. In Native Mode, these user actions map directly to MCP `tools/call` requests.

#### Client Action Dispatch Flow

1. The user interacts with a component (e.g., clicks a button with action `event.name: "increment_counter"` and context `{"step": 1}`).
2. The A2UI Surface dispatches an `A2uiClientAction`:
   ```json
   {
     "name": "increment_counter",
     "surfaceId": "counter",
     "sourceComponentId": "btn_inc",
     "timestamp": "2026-08-18T00:00:00.000Z",
     "context": {
       "step": 1
     }
   }
   ```
3. The client MCP Action Dispatcher invokes `tools/call`:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 4,
     "method": "tools/call",
     "params": {
       "name": "increment_counter",
       "arguments": {
         "step": 1
       }
     }
   }
   ```
4. The server processes the tool call and returns an `agentFunctionResponse` (along with any other updated A2UI messages, such as `updateDataModel` or `updateComponents`) in an embedded resource for the A2UI surface renderer to handle.
5. The client parses the A2UI messages and updates the local A2UI surface model.

### Message Format & Response Processing

A2UI messages returned inside `application/a2ui+json` resources MUST conform to the **A2UI v1.0 Agent-to-Renderer Schema** (`agent_to_renderer.json`).

Supported message types include:

- **`createSurface`**: Initializes a new surface with surface ID, catalog ID, and optional initial components and data model.
- **`updateComponents`**: Updates or replaces component definitions in the component hierarchy.
- **`updateDataModel`**: Mutates key/values or sub-paths in the surface data model.
- **`deleteSurface`**: Tears down an active surface.
- **`callRendererFunction`**: Requests local client-side function evaluation.
- **`agentFunctionResponse`**: Returns execution output for agent-side function invocations.

Servers MAY deliver payloads as a single JSON message object or an array of message objects (e.g., `[createSurface, updateComponents, updateDataModel]`).

### Security & Sandboxing Architecture

#### Architecture Diagram

```
+-------------------------------------------------------------------------+
| Client Host Application                                                 |
|                                                                         |
|  [ Native A2UI Mode (Zero Iframe Overhead) ]                            |
|    <a2ui-surface> <--- Native A2UI Messages (application/a2ui+json)     |
|      |                                                                  |
|      v Action Dispatcher                                                |
|      +------------> MCP Client tools/call ------------------------+     |
|                                                                   |     |
|  [ Iframe Sandboxed Mode (Fallback) ]                             |     |
|    <iframe src="sandbox_proxy.html">                              |     |
|      <iframe sandbox="..." srcdoc="<mcp-app>">                    |     |
|        postMessage JSON-RPC (ui/initialize, tools/call)           |     |
|          ^                                                        |     |
|          +---------> McpSandboxHost Controller -------------------+     |
+-------------------------------------------------------------------|-----+
                                                                    |
                                                            MCP Transport (SSE/stdio)
                                                                    |
                                                                    v
+-------------------------------------------------------------------------+
| MCP Server (Python / TypeScript)                                        |
|   - Inspects clientCapabilities.extensions["io.modelcontextprotocol/ui"]|
|   - Native Mode: Returns CallToolResult(EmbeddedResource(a2ui+json))    |
|   - Fallback Mode: Returns ReadResourceContents(text/html;mcp-app)      |
+-------------------------------------------------------------------------+
```

#### Security Isolation Rules

1. **Native Mode**: The host MUST render the UI with its certified component catalogs. The host MUST NOT execute arbitrary JavaScript or untrusted HTML strings in the DOM.
2. **Fallback Mode**: The host MUST restrict untrusted HTML bundles within a double-iframe sandbox with strict `sandbox` flags (omitting `allow-same-origin` on inner frames and omitting `allow-top-navigation`) and strict `Permissions-Policy` headers.

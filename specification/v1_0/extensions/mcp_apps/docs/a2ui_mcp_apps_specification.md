# A2UI over MCP Apps Protocol Extension Specification (v1.0)

## Overview

This specification defines the standard protocol extension for delivering **A2UI (Agent-to-User Interface) v1.0** interactive interfaces over the **Model Context Protocol (MCP)** and **MCP Apps**.

By combining A2UI with MCP, MCP servers and AI agents can provide dynamic, streaming, and stateful user interfaces directly to host clients. The protocol supports dynamic **dual-mode capability negotiation**:

1. **Native A2UI Mode (Preferred)**: When the host client supports native A2UI (`application/a2ui+json`), UI payloads are delivered directly as MCP resources or embedded tool call results. The host application renders the UI natively using client-side A2UI renderers (e.g. Angular, Lit, React) with zero iframe overhead, ensuring full fidelity with host styling and responsive layouts.
2. **Iframe Sandboxed Mode (Fallback)**: When the host client only supports standard MCP Apps HTML interfaces (`text/html;profile=mcp-app`), the server serves a self-contained HTML/JS bundle. The bundle embeds an isolated A2UI runtime inside a sandboxed iframe, communicating back to the host via MCP Apps JSON-RPC `postMessage` protocol.

---

## Extension Identifiers

- **Extension URI**: `https://a2ui.org/mcp-apps-extension/a2ui/v1.0`
- **Capability Identifier**: `io.modelcontextprotocol/ui`
- **Native A2UI MIME Type**: `application/a2ui+json`
- **MCP App HTML MIME Type**: `text/html;profile=mcp-app`

---

## 1. Capability Negotiation (`initialize`)

Clients advertise supported UI rendering capabilities to the MCP server during the initial MCP `initialize` handshake within `capabilities.extensions`.

### Client Initialization Request

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

### Server Capability Detection

Servers inspect the `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` array during connection or tool invocation:

- If `application/a2ui+json` is present in `mimeTypes`: The server delivers native A2UI JSON payloads (`application/a2ui+json`).
- If only `text/html;profile=mcp-app` is present: The server provides the sandboxed HTML application bundle.

---

## 2. Resource & Tool Delivery

A2UI payloads can be delivered via MCP **Resources** or MCP **Tools**.

### A. Resource Delivery (`resources/read`)

Clients can fetch UI definitions directly as static or dynamically generated resources.

#### Native A2UI Resource

When reading a native A2UI resource (e.g., `a2ui://counter-view` or `ui://counter/app` with native support), the server returns `ReadResourceContents` with `mimeType: "application/a2ui+json"`:

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

If the client does not support native A2UI, reading `ui://counter/app` returns standard `text/html;profile=mcp-app`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "ui://counter/app",
        "mimeType": "text/html;profile=mcp-app",
        "text": "<!DOCTYPE html><html><head><script type=\"module\" src=\"app.js\"></script></head><body><div id=\"root\"></div></body></html>"
      }
    ]
  }
}
```

---

### B. Tool Result Delivery (`tools/call`)

When an MCP Tool produces UI output, the server returns a `CallToolResult` containing an `EmbeddedResource` with `mimeType: "application/a2ui+json"`.

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

---

## 3. Action-to-Tool Mapping

Interactive A2UI components trigger user actions with an `event.name` and an `event.context` payload. In Native Mode, these user actions map directly to MCP `tools/call` requests.

### Client Action Dispatch Flow

1. User interacts with a component (e.g. clicks a button with action `event.name: "increment_counter"` and context `{"step": 1}`).
2. A2UI Surface dispatches `A2uiClientAction`:
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
4. The server processes the tool call and returns updated A2UI messages (e.g., `updateDataModel` or `updateComponents`) in an embedded resource.
5. The client parses the A2UI messages and updates the local A2UI surface model.

---

## 4. Message Format & Response Processing

A2UI messages returned inside `application/a2ui+json` resources must conform to the **A2UI v1.0 Agent-to-Renderer Schema** (`agent_to_renderer.json`).

Supported message types include:

- **`createSurface`**: Initializes a new surface with surface ID, catalog ID, and optional initial components and data model.
- **`updateComponents`**: Updates or replaces component definitions in the component hierarchy.
- **`updateDataModel`**: Mutates key/values or sub-paths in the surface data model.
- **`deleteSurface`**: Tears down an active surface.
- **`callRendererFunction`**: Requests local client-side function evaluation.
- **`agentFunctionResponse`**: Returns execution output for agent-side function invocations.

Payloads may be delivered as a single JSON message object or an array of message objects (e.g. `[createSurface, updateComponents, updateDataModel]`).

---

## 5. Security & Sandboxing Architecture

```
+-------------------------------------------------------------------------+
| Client Host Application (e.g. Lit / Angular / React Host)               |
|                                                                         |
|  [ Native A2UI Mode (Zero Iframe Overhead) ]                            |
|    <a2ui-surface> <--- Native A2UI Messages (application/a2ui+json)     |
|      |                                                                  |
|      v Action Dispatcher                                                |
|      +------------> MCP Client tools/call ------------------------+     |
|                                                                   |     |
|  [ Iframe Sandboxed Mode (Fallback) ]                             |     |
|    <iframe src="sandbox_proxy.html">                              |     |
|      <iframe sandbox="..." srcdoc="<mcp-app>">                     |     |
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
|   - Native Mode: Returns CallToolResult(EmbeddedResource(a2ui+json))   |
|   - Fallback Mode: Returns ReadResourceContents(text/html;mcp-app)     |
+-------------------------------------------------------------------------+
```

### Security Isolation Rules

1. **Native Mode**: UI is rendered with the host application's certified component catalogs. No arbitrary JavaScript or untrusted HTML strings are executed in the DOM.
2. **Fallback Mode**: Untrusted HTML bundles are restricted within a double-iframe sandbox with strict `sandbox` flags (omitting `allow-same-origin` on inner frames and omitting `allow-top-navigation`) and strict `Permissions-Policy` headers.

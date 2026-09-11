# A2UI MCP Catalog & Client SDK

The **A2UI MCP Catalog** provides first-class support for executing [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools from A2UI surfaces and clients. It allows AI agents to construct dynamic user interfaces that invoke MCP server tools directly from client-side UI actions, data bindings, or function evaluations.

---

## 1. Overview

A2UI separates UI layout from domain-specific backend logic through **Catalogs**. The MCP Catalog defines a client-side function—`callMcpTool`—that routes UI interactions to MCP tools through a host-supplied tool caller.

Key Capabilities:

- **Client-Side MCP Tool Routing**: Execute server tools directly via standard A2UI function invocations.
- **Transport-Agnostic**: The catalog holds no MCP `Client`. The host implements a `McpToolCaller` that resolves which connected server owns a tool and issues the `tools/call` request.
- **Renderer-Agnostic**: Compatible with all A2UI web renderers (Lit, Angular, React, etc.) and `MessageProcessor`.
- **Two-Way Data Binding Integration**: Pass form parameters, dynamic expressions, and state directly into MCP tool arguments.

---

## 2. Catalog Specification

- **Catalog ID**: `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`
- **Protocol Version**: v0.9 / v0.9.1

### `callMcpTool` Function Signature

The catalog provides the `callMcpTool` function:

| Parameter   | Type     | Required           | Description                                           |
| :---------- | :------- | :----------------- | :---------------------------------------------------- |
| `name`      | `string` | **Yes**            | The name of the MCP tool to execute.                  |
| `arguments` | `object` | No (default: `{}`) | Key-value dictionary of arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server: multi-server routing is a host concern, resolved inside the `McpToolCaller`.

**Return Value**: Returns the raw MCP `CallToolResult` object (containing `content: Array<{type, text, ...}>`, `isError`, etc.). The catalog function throws an `A2uiExpressionError` when the result is flagged with `isError`.

---

## 3. Installation & Setup

Ensure the MCP SDK and A2UI dependencies are available in your application:

```bash
yarn add @modelcontextprotocol/sdk @a2ui/web_core
```

---

## 4. Quick Start

### Step 1: Initialize MCP Client & Create MCP Catalog

Initialize your MCP client and transport (e.g. SSE, WebSocket, Stdio), connect to the server, and create the MCP catalog with a tool caller:

```typescript
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {createMcpCatalog, MCP_CATALOG_ID} from './v0_9/src/catalog.js';

// 1. Establish transport connection to MCP server
const transport = new SSEClientTransport(new URL('http://127.0.0.1:8000/sse'));
const client = new Client({
  name: 'my-a2ui-client',
  version: '1.0.0',
});

await client.connect(transport);

// 2. Create the MCP catalog bound to a tool caller
const mcpCatalog = createMcpCatalog((toolName, args) =>
  client.request(
    {method: 'tools/call', params: {name: toolName, arguments: args}},
    CallToolResultSchema,
  ),
);
```

For multi-server setups, keep a registry of which server advertises each tool (typically built from `listTools()` at connection time) and resolve it inside the caller:

```typescript
const mcpCatalog = createMcpCatalog((toolName, args) => {
  const client = mcpClients.get(toolServers.get(toolName)) ?? defaultClient;
  return client.request(
    {method: 'tools/call', params: {name: toolName, arguments: args}},
    CallToolResultSchema,
  );
});
```

---

### Step 2: Configure the A2UI MessageProcessor

Pass `mcpCatalog` alongside your UI component catalog (e.g. `basicCatalog`) to the A2UI `MessageProcessor`:

```typescript
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';

const processor = new MessageProcessor([basicCatalog, mcpCatalog], async action => {
  console.log('A2UI Action Triggered:', action);
});
```

---

### Step 3: Trigger MCP Tools from A2UI Payloads

Surfaces created under the MCP catalog or referencing `callMcpTool` can invoke server tools:

```json
{
  "createSurface": {
    "surfaceId": "weather-widget",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json"
  }
}
```

Direct execution example from TypeScript:

```typescript
const result = await mcpCatalog.invoker(
  'callMcpTool',
  {
    name: 'get_weather',
    arguments: {city: 'San Francisco'},
  },
  dataContext,
);

console.log('Tool Result:', result.content);
```

---

## 5. Running Tests

Unit tests are implemented using Node's test runner and TypeScript loader (`tsx`):

```bash
# Run tests in the MCP catalog
node --import tsx --test catalogs/mcp/v0_9/src/functions/callMcpTool.test.ts
```

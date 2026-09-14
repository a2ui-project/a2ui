# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools. It defines one client-side function, `callMcpTool`, so an agent can emit a payload whose buttons and data bindings call MCP server tools directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog contributes `callMcpTool` and the machinery behind it:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the client it returns for the tool call, the template read, and tool discovery.
- Tool results are applied for you. The catalog fetches and caches the presentation template a result points at, then processes any A2UI messages embedded in the result content.
- Tool arguments accept data bindings, so form state can be passed straight into a tool call.
- Nothing here is renderer-specific. It works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`, exported as `MCP_CATALOG_ID`. It targets protocol v0.9 and v0.9.1.

`callMcpTool` takes two arguments, declared in [mcp_catalog.json](v0_9/mcp_catalog.json):

| Parameter   | Type     | Required          | Description                   |
| :---------- | :------- | :---------------- | :---------------------------- |
| `name`      | `string` | Yes               | The MCP tool to execute.      |
| `arguments` | `object` | No (default `{}`) | Arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is a host concern resolved inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns nothing, or the result is flagged `isError`.

## Installation

```bash
yarn add @modelcontextprotocol/sdk @a2ui/web_core
```

## Quick start

### Connect an MCP client

```typescript
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

const client = new Client({name: 'my-a2ui-client', version: '1.0.0'});
await client.connect(new SSEClientTransport(new URL('http://127.0.0.1:8000/sse')));
```

### Build the function, the catalog, and the processor

`createCallMcpToolImplementation` takes the client resolver and the `MessageProcessor` that receives the messages derived from tool results.

A `MessageProcessor` takes its catalogs at construction time, which looks circular: the catalog holds the function, and the function needs the processor. It is not, because the processor keeps the array you give it and reads it lazily. Pass the array first, then fill it in:

```typescript
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {createCallMcpToolImplementation, MCP_CATALOG_ID} from './v0_9/src/index.js';

const catalogs: Catalog<any>[] = [basicCatalog];

const processor = new MessageProcessor(catalogs, async action => {
  console.log('A2UI action triggered:', action);
});

const callMcpTool = createCallMcpToolImplementation(() => client, processor);

catalogs.push(new Catalog(MCP_CATALOG_ID, [], [callMcpTool]));
```

Push every catalog before the first message arrives, since `getClientCapabilities` reports whatever the array holds when it is called.

To mix MCP tools with Basic Catalog components, build one composite catalog instead of two:

```typescript
catalogs.push(
  new Catalog(MY_COMPOSITE_CATALOG_ID, Array.from(basicCatalog.components.values()), [
    ...Array.from(basicCatalog.functions.values()),
    callMcpTool,
  ]),
);
```

For multi-server setups, keep a registry of which server advertises each tool, usually built from `listTools()` at connection time, and resolve it in the same hook:

```typescript
const callMcpTool = createCallMcpToolImplementation(
  toolName => mcpClients.get(toolServers.get(toolName)) ?? defaultClient,
  processor,
);
```

Resolving once per invocation is what keeps resource URIs meaningful: the template read and the tool call always happen on the same connection. The resolver may be async.

The resolver returns `McpToolClient`, which is `Pick<Client, 'request' | 'readResource' | 'listTools'>`. Signatures come from the MCP SDK, so they cannot drift, but the type is structural: pass the SDK's `Client`, a wrapper that adds retries or logging, or a test double.

### What a tool call does

On each invocation the catalog:

1. Resolves the client through `getMcpClientForTool(toolName)` and issues `tools/call`, with progress notifications resetting the request timeout.
2. Throws if the result is missing or flags `isError`.
3. Collects template URIs from `result._meta.ui.resourceUri`. When the result names none, it falls back to the URIs the tool declared under the same field in `tools/list`, so result URIs override declared ones rather than adding to them. Either field holds one URI or an array, and duplicates are dropped. Discovery runs lazily, once per client, and is skipped for clients without `listTools`.
4. Fetches each template through `resources/read`, once per URI, and decodes every content block whose `mimeType` is `application/a2ui+json`. A template carrying several such blocks contributes all of them, and one carrying none contributes nothing.
5. Processes each template in the order its URI appeared, skipping any that would recreate a live surface.
6. Processes the A2UI messages inlined in `result.content`, in content order. Only an embedded resource block declaring `application/a2ui+json` counts: a text block is prose for the model, even when it holds a message.

### Invoke a tool during bootstrap

Surfaces call `callMcpTool` through their own `DataContext`. A host loading its first screen has no surface yet, so evaluate the function directly against a scratch context. Literal arguments never touch the context, and both paths share one template cache because they share one function instance.

```typescript
import {DataContext, DataModel} from '@a2ui/web_core/v0_9';

const context = new DataContext({dataModel: new DataModel({}), catalog} as any, '/');
await callMcpTool.execute({name: 'get_recipe_form', arguments: {cuisine: 'italian'}}, context);
```

### Trigger tools from A2UI payloads

A surface created under a catalog that includes `callMcpTool` can invoke server tools:

```json
{
  "createSurface": {
    "surfaceId": "weather-widget",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json"
  }
}
```

Arguments may be data bindings, which resolve against the calling surface:

```json
{
  "call": "callMcpTool",
  "args": {
    "name": "get_weather",
    "arguments": {"city": {"path": "/form/city"}}
  }
}
```

An argument key named `path` or `call` stays a literal tool argument. Only a value that is itself a binding gets resolved.

## Module layout

| File                                   | Responsibility                                                             |
| :------------------------------------- | :------------------------------------------------------------------------- |
| `v0_9/src/index.ts`                    | Package entry: `MCP_CATALOG_ID` and public exports                         |
| `v0_9/src/functions/callMcpTool.ts`    | The whole tool call: request, template fetch and caching, message decoding |
| `v0_9/src/functions/callMcpToolApi.ts` | The `callMcpTool` argument schema                                          |
| `v0_9/src/dynamic-values.ts`           | Resolution of dynamic values nested in literal containers                  |

## Building

The package is `@a2ui/mcp-catalog`. It compiles to `dist/`, and consumers
import it by name rather than reaching into `v0_9/src`:

```bash
# Builds @a2ui/web_core first, then this package
yarn workspaces foreach -R --from @a2ui/mcp-catalog --topological-dev run build

# Or, if @a2ui/web_core is already built
yarn workspace @a2ui/mcp-catalog build
```

## Running tests

Tests run on Node's test runner with the `tsx` loader, directly against the
TypeScript sources, so they do not require a build:

```bash
# Every test in the MCP catalog workspace
yarn workspace @a2ui/mcp-catalog test

# Or a single file
node --import tsx --test catalogs/mcp/v0_9/src/functions/callMcpTool.test.ts
```

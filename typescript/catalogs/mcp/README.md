# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools. It defines `callMcpTool`, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog provides `callMcpTool`:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the returned client for tool execution, UI resource reads, and tool discovery.
- Tool results are processed automatically. The catalog fetches and caches UI resources referenced by results, then applies any A2UI messages embedded in the result content.
- Tool arguments support data bindings, allowing form state to pass directly into tool calls.
- `callMcpTool` returns the raw tool result, so functions a host registers next to it can reshape that result for servers that do not emit A2UI.
- The catalog works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The canonical schema lives at [`catalogs/mcp/catalog.json`](../../../catalogs/mcp/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-mcp/catalog.json`. The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`, exported as `MCP_CATALOG_ID`.

`callMcpTool` takes two arguments:

| Parameter   | Type            | Required          | Description                   |
| :---------- | :-------------- | :---------------- | :---------------------------- |
| `name`      | `DynamicString` | Yes               | The MCP tool to execute.      |
| `arguments` | `object`        | No (default `{}`) | Arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is resolved by the host inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns no result, or the result has `isError: true`.

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

`createCallMcpToolImplementation` builds `callMcpTool`. It takes the client resolver and the `MessageProcessor` that receives the messages derived from tool results.

Because `MessageProcessor` reads its catalog array lazily, pass the array to the processor constructor first, then populate the catalog with functions that reference the processor:

```typescript
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {createCallMcpToolImplementation, MCP_CATALOG_ID} from '@a2ui/catalog-mcp';

const catalogs: Catalog<any>[] = [basicCatalog];

const processor = new MessageProcessor(catalogs, async action => {
  console.log('A2UI action triggered:', action);
});

catalogs.push(
  new Catalog(
    MCP_CATALOG_ID,
    'v0.9',
    [],
    [createCallMcpToolImplementation(() => client, processor)],
  ),
);
```

Push every catalog before the first message arrives, since `getClientCapabilities` reports whatever the array holds when it is called.

To mix MCP tools with Basic Catalog components, build one composite catalog instead of two:

```typescript
catalogs.push(
  new Catalog(MY_COMPOSITE_CATALOG_ID, 'v0.9', Array.from(basicCatalog.components.values()), [
    ...Array.from(basicCatalog.functions.values()),
    createCallMcpToolImplementation(() => client, processor),
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

Resolving once per invocation is what keeps resource URIs meaningful: the UI resource read and the tool call always happen on the same connection. The resolver may be async.

The resolver returns `McpToolClient`, which is `Pick<Client, 'request' | 'readResource' | 'listTools'>`. Signatures come from the MCP SDK, so they cannot drift, but the type is structural: pass the SDK's `Client`, a wrapper that adds retries or logging, or a test double.

### What a tool call does

On each invocation the catalog:

1. Resolves the client through `getMcpClientForTool(toolName)` and issues `tools/call`, with progress notifications resetting the request timeout.
2. Throws if the result is missing or flags `isError`.
3. Collects UI resource URIs from `result._meta.ui.resourceUri`. When the result names none, it falls back to the URIs the tool declared under the same field in `tools/list`, so result URIs override declared ones rather than adding to them. Either field holds one URI or an array, and duplicates are dropped. Discovery runs lazily, once per client, and a discovery failure is logged and read as no declared URIs.
4. Fetches each UI resource through `resources/read`, once per URI, and decodes every content block whose `mimeType` is `application/a2ui+json`. A resource carrying several such blocks contributes all of them, and one carrying none contributes nothing.
5. Processes each UI resource in the order its URI appeared, skipping any that would recreate a live surface.
6. Processes the A2UI messages inlined in `result.content`, in content order. Only an embedded resource block declaring `application/a2ui+json` counts: a text block is prose for the model, even when it holds a message.
7. Returns the `CallToolResult` unchanged, for a surrounding function to reshape.

### Invoke a tool during bootstrap

A payload can declare the call that fills its first screen, which keeps the opening screen the payload's decision rather than the host's. Store the action in the data model and resolve it once the surface exists:

```typescript
import {DataContext} from '@a2ui/web_core/v0_9';

const context = new DataContext(surface, '/');
for (const action of surface.dataModel.get('/startup') ?? []) {
  await context.resolveDynamicValue(action);
}
```

A host with no surface at all evaluates the function directly against a scratch context instead. Literal arguments never touch the context, and both paths share one resource cache because they share one function instance.

```typescript
import {DataContext, DataModel} from '@a2ui/web_core/v0_9';

const callMcpTool = createCallMcpToolImplementation(() => client, processor);
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

### Translate a server that knows nothing about A2UI

Most MCP servers answer in their own shape: plain text, or structured content that no A2UI renderer understands. A payload can nest `callMcpTool` inside functions that reshape its result, so the host needs no code for the server it is talking to. Two things make such a chain work:

- A2UI resolves a function call's arguments before it invokes the function, but it has no way to await one. An argument that is a pending `callMcpTool` therefore arrives as a `Promise`, and a function composed around it has to settle its own arguments.
- `DataContext.resolveDynamicValue` reads any object holding a `path` key as a data binding, so a tool whose argument is named `path` cannot take a literal `arguments` object. Pass a binding to an object stored in the data model (`{"arguments": {"path": "/tool_args/list_directory"}}`), or a function call that returns the object.

A host that needs such a chain registers its own transformation functions (for example a JMESPath evaluator and a data model writer) next to `callMcpTool`, written to settle pending arguments.

## Module layout

| File                           | Responsibility                                                                         |
| :----------------------------- | :------------------------------------------------------------------------------------- |
| `src/catalog.json`             | Copy of `catalogs/mcp/catalog.json` made by `scripts/copy-catalog.js` at build time    |
| `src/index.ts`                 | Package entry: `MCP_CATALOG_ID`, `createCallMcpToolImplementation`, and public exports |
| `src/functions/callMcpTool.ts` | MCP tool execution, UI resource discovery, caching, and message decoding               |
| `src/dynamic-values.ts`        | Resolution of dynamic values nested in literal containers                              |

## Building

The package is `@a2ui/catalog-mcp`. It compiles to `dist/`, and consumers
import it by name rather than reaching into `src`:

```bash
# Builds @a2ui/web_core first, then this package
yarn workspaces foreach -R --from @a2ui/catalog-mcp --topological-dev run build

# Or, if @a2ui/web_core is already built
yarn workspace @a2ui/catalog-mcp build
```

## Running tests

Tests run on Node's test runner with the `tsx` loader, directly against the
TypeScript sources, so they do not require a build (the `test` script copies
`catalog.json` first):

```bash
# Every test in the MCP catalog workspace
yarn workspace @a2ui/catalog-mcp test

# Or a single file
node --import tsx --test typescript/catalogs/mcp/src/dynamic-values.test.ts
```

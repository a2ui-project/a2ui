# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools. It defines the `callMcpTool` function, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog provides:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the returned client for tool execution, UI resource reads, and tool discovery.
- Tool results are processed automatically. The catalog fetches and caches UI resources referenced by results, then applies any A2UI messages embedded in the result content.
- Tool arguments support data bindings, allowing form state to pass directly into tool calls.
- The catalog works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The canonical schema lives at [`catalogs/mcp/v1/catalog.json`](../../../catalogs/mcp/v1/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-mcp/catalog.json`. The catalog ID is `https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`, exported as `MCP_CATALOG_ID`.

`callMcpTool` takes three arguments:

| Parameter        | Type            | Required          | Description                                                                                                |
| :--------------- | :-------------- | :---------------- | :--------------------------------------------------------------------------------------------------------- |
| `name`           | `DynamicString` | Yes               | The MCP tool to execute.                                                                                   |
| `arguments`      | `object`        | No (default `{}`) | Arguments passed to the tool: an object of dynamic values, or a function call that returns one.            |
| `targetDataPath` | `DynamicString` | No                | Optional JSON Pointer path on the surface data model where a resolved MCP App resource payload is written. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is resolved by the host inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns no result, or the result has `isError: true`.

## Installation

```bash
yarn add @a2ui/catalog-mcp @modelcontextprotocol/sdk @a2ui/web_core
```

## Quick start

### Connect an MCP client

```typescript
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

const client = new Client({name: 'my-a2ui-client', version: '1.0.0'});
await client.connect(new SSEClientTransport(new URL('http://127.0.0.1:8000/sse')));
```

### Register the function and configure the host

`CallMcpToolImplementation` is the `callMcpTool` function, ready to register. Put it in a catalog under `MCP_CATALOG_ID`, hand that catalog to the `MessageProcessor`, then tell the package how to reach your MCP servers with `configureMcpCatalog`. `callMcpTool` reads that configuration when it runs, so the order of the two calls does not matter as long as both happen before the first tool call:

```typescript
import {basicCatalog, Catalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {CallMcpToolImplementation, configureMcpCatalog, MCP_CATALOG_ID} from '@a2ui/catalog-mcp';

const mcpCatalog = new Catalog(MCP_CATALOG_ID, '1.0', [], [CallMcpToolImplementation]);
const processor = new MessageProcessor([basicCatalog, mcpCatalog], async action => {
  console.log('A2UI action triggered:', action);
});

configureMcpCatalog({
  getMcpClientForTool: toolName => client,
  processor,
});
```

`processor` is where the catalog sends the A2UI messages it finds in tool results and UI resources. The configuration is module-level, like the sandbox configuration: one per page, read on every call, and `configureMcpCatalog` can be called again to change a single field.

Push every catalog before the first message arrives, since `getClientCapabilities` reports whatever the array holds when it is called.

Function calls in expressions (`${...}`, `@call`) always resolve through the surface's default catalog, the `catalogId` of its `createSurface` message. A payload that calls `callMcpTool` from expressions next to basic components creates its surface with a catalog that carries both; build one under the id the agent uses (`MCP_CATALOG_ID` is the canonical one):

```typescript
const processor = new MessageProcessor(
  [
    new Catalog(
      MCP_CATALOG_ID,
      '1.0',
      [...basicCatalog.components.values()],
      [...basicCatalog.functions.values(), CallMcpToolImplementation],
    ),
  ],
  onAction,
);
configureMcpCatalog({getMcpClientForTool: () => client, processor});
```

For multi-server setups, keep a registry of which server advertises each tool, usually built from `listTools()` at connection time, and resolve it in the same hook:

```typescript
configureMcpCatalog({
  getMcpClientForTool: toolName => mcpClients.get(toolServers.get(toolName)) ?? defaultClient,
  processor,
});
```

Resolving once per invocation is what keeps resource URIs meaningful: the UI resource read and the tool call always happen on the same connection. The resolver may be async.

The resolver returns `McpToolClient`, which is `Pick<Client, 'request' | 'readResource' | 'listTools'>`. Signatures come from the MCP SDK, so they cannot drift, but the type is structural: pass the SDK's `Client`, a wrapper that adds retries or logging, or a test double.

`configureMcpCatalog` takes three more options: `defaultVersion`, the A2UI protocol version given to decoded messages that carry none (`'v1.0'` unless set); `onMcpAppResource`, called when a tool call resolves an [MCP App](https://github.com/modelcontextprotocol/ext-apps) resource (see [Trigger tools from A2UI payloads](#trigger-tools-from-a2ui-payloads)); and `sandbox`, the location of the sandbox proxy pages that components embedding untrusted content load (see [Sandbox asset](#sandbox-asset)).

Without `configureMcpCatalog`, `callMcpTool` fails with an error that says so.

### What a tool call does

On each invocation the catalog:

1. Resolves the client through `getMcpClientForTool(toolName)` and issues `tools/call`, with progress notifications resetting the request timeout.
2. Throws if the result is missing or flags `isError`.
3. Collects UI resource URIs from `result._meta.ui.resourceUri`. When the result names none, it falls back to the URIs the tool declared under the same field in `tools/list`, so result URIs override declared ones rather than adding to them. Either field holds one URI or an array, and duplicates are dropped. Discovery runs lazily, once per client, and a discovery failure is logged and read as no declared URIs.
4. Fetches each UI resource through `resources/read`, once per URI, and decodes every content block whose `mimeType` is `application/a2ui+json`. A resource carrying several such blocks contributes all of them, and one carrying none contributes nothing.
5. Processes each UI resource in the order its URI appeared, skipping any that would recreate a live surface.
6. Processes the A2UI messages inlined in `result.content`, in content order. Only an embedded resource block declaring `application/a2ui+json` counts: a text block is prose for the model, even when it holds a message.
7. Returns the `CallToolResult` unchanged to the caller.

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
import {CallMcpToolImplementation} from '@a2ui/catalog-mcp';

const context = new DataContext({dataModel: new DataModel({}), catalog} as any, '/');
await CallMcpToolImplementation.execute(
  {name: 'get_recipe_form', arguments: {cuisine: 'italian'}},
  context,
);
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

## Sandbox asset

Components that embed untrusted content, such as the `McpApp` component this package adds, never run it directly in the host page. The host embeds `sandbox.html`, an un-sandboxed proxy page served from the host's own origin, and the proxy creates a strictly sandboxed inner frame for the app: `sandbox="allow-scripts"` only, so no `allow-same-origin`, no forms, no modal dialogs, no top navigation, no popups, and every sensitive permission denied. This double iframe keeps the outer frame reachable for developer tools and browser extensions, which crash with `SecurityError` when they meet a sandboxed frame directly in the page, while the app runs in an opaque origin with no access to the host's cookies, storage or DOM. The proxy checks the embedding page's origin, relays messages between the host and the inner frame, and rejects everything else.

The proxy is shipped in the `sandbox/` directory of the published package (`dist/sandbox/` in the repository):

| File               | Purpose                                                           |
| :----------------- | :---------------------------------------------------------------- |
| `sandbox.html`     | The proxy page for inline HTML content.                           |
| `sandbox-url.html` | The same proxy for external URLs, used by `@a2ui/catalog-iframe`. |
| `sandbox.js`       | The proxy script, shared by both pages.                           |

Copy that directory into your app's static assets so it is served at `/a2ui-sandbox/` on your origin:

- Angular CLI: add an entry to the `assets` array of your build options in `angular.json`:

  ```json
  {
    "glob": "**/*",
    "input": "node_modules/@a2ui/catalog-mcp/sandbox",
    "output": "a2ui-sandbox"
  }
  ```

- Vite: either copy the directory into `public/a2ui-sandbox/` (Vite serves `publicDir` as is), or use a static-copy plugin such as `vite-plugin-static-copy` with `{src: 'node_modules/@a2ui/catalog-mcp/sandbox/*', dest: 'a2ui-sandbox'}`.

- Plain static server: copy `node_modules/@a2ui/catalog-mcp/sandbox` to `<web root>/a2ui-sandbox`.

The proxy is the same one `@a2ui/catalog-iframe` ships, so an application that uses both packages serves either copy once.

The default proxy URL is `/a2ui-sandbox/sandbox.html`, resolved against the document base URL. To serve the directory somewhere else, set the base URL once at startup, in the same call that configures the MCP client:

```typescript
import {configureMcpCatalog} from '@a2ui/catalog-mcp';

configureMcpCatalog({sandbox: {baseUrl: '/static/frames/'}});
```

The proxy runs a self-test on startup: it fails unless it is isolated from the top window, which is only the case when the proxy is served from another origin than the host page. On the default same-origin deployment the test cannot pass, so the URL carries `disable_security_self_test=true` automatically. To serve the proxy from a dedicated origin (the stronger isolation), point `baseUrl` at it and list the host origin in the proxy page, which then keeps the self-test enabled:

```html
<meta name="a2ui-sandbox-host-origins" content="https://app.example.com" />
```

`configureMcpCatalog({sandbox: {disableSecuritySelfTest: true | false}})` overrides the automatic choice.

## Module layout

| File                           | Responsibility                                                                                                                                                                       |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/catalog.json`             | Copy of `catalogs/mcp/v1/catalog.json` made by the `copy-catalog` build step                                                                                                         |
| `src/index.ts`                 | Package entry: `MCP_CATALOG_ID`, `configureMcpCatalog` and `CallMcpToolImplementation`                                                                                               |
| `src/catalog.ts`               | `MCP_CATALOG_ID`                                                                                                                                                                     |
| `src/mcp_catalog_config.ts`    | `configureMcpCatalog`: the host's MCP client resolver, message processor and sandbox location                                                                                        |
| `src/functions/callMcpTool.ts` | MCP tool execution, UI resource discovery, caching, and message decoding                                                                                                             |
| `src/dynamic-values.ts`        | Resolution of dynamic values nested in literal containers                                                                                                                            |
| `src/shared/sandbox/`          | Copy of `typescript/catalogs/shared/sandbox/` made by the `copy-shared` build step: the proxy, the base element, the host adapter and the helpers shared with `@a2ui/catalog-iframe` |

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

The function tests run on Node's test runner with the `tsx` loader, directly against the TypeScript sources. The component, catalog and shared sandbox tests run with Karma in headless Chrome against the real sandbox proxy and a fixture app built on the MCP Apps App SDK. The `test` script runs both:

```bash
# Every test in the MCP catalog workspace
yarn workspace @a2ui/catalog-mcp test

# Only the Node tests, or only the browser tests
yarn workspace @a2ui/catalog-mcp test:node
yarn workspace @a2ui/catalog-mcp test:karma

# Or a single Node test file
node --import tsx --test typescript/catalogs/mcp/src/functions/callMcpTool.test.ts
```

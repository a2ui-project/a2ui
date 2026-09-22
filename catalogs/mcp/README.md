# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools and transform tool results into data model updates. It defines `callMcpTool` and five data functions, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog provides six functions:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the returned client for tool execution, UI resource reads, and tool discovery.
- Tool results are processed automatically. The catalog fetches and caches UI resources referenced by results, then applies any A2UI messages embedded in the result content.
- Tool arguments support data bindings, allowing form state to pass directly into tool calls.
- Data functions transform tool output into data model updates, enabling A2UI payloads to interact with standard MCP servers that do not natively emit A2UI.
- The catalog works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`, exported as `MCP_CATALOG_ID`. It targets protocol v0.9 and v0.9.1.

`callMcpTool` takes two arguments, declared in [mcp_catalog.json](v0_9/mcp_catalog.json):

| Parameter   | Type            | Required          | Description                   |
| :---------- | :-------------- | :---------------- | :---------------------------- |
| `name`      | `DynamicString` | Yes               | The MCP tool to execute.      |
| `arguments` | `object`        | No (default `{}`) | Arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is resolved by the host inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns no result, or the result has `isError: true`.

Five data functions transform tool results and write them to the data model:

| Function          | Arguments                         | Returns                                                                             |
| :---------------- | :-------------------------------- | :---------------------------------------------------------------------------------- |
| `jmespath`        | `expression`, `data`              | The result of evaluating `expression` against `data`, or `null` for missing fields. |
| `split`           | `value`, `separator`              | Substrings split by `separator` (or characters if `separator` is empty).            |
| `regexCapture`    | `value`, `pattern`                | Capture groups from the first RE2 match, or `null` if no match is found.            |
| `regexReplace`    | `value`, `pattern`, `replacement` | `value` with all RE2 matches replaced by literal `replacement` text.                |
| `updateDataModel` | `updates`                         | Nothing. Writes each key-value pair in `updates` to the surface data model.         |

Every argument above is required. `split`, `regexCapture`, and `regexReplace` accept either a single string or an array of strings in `value`, applying the operation element by element when given an array.

To test whether a string matches a pattern, use the basic catalog's `regex` function.

For `updateDataModel`, keys starting with `/` are absolute paths, while relative keys resolve against the calling data context (such as the current row scope inside a template list).

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

### Build the functions, the catalog, and the processor

`createMcpCatalogFunctions` returns every function this catalog defines, so a host registers them in one step. It takes the client resolver and the `MessageProcessor` that receives the messages derived from tool results.

Because `MessageProcessor` reads its catalog array lazily, pass the array to the processor constructor first, then populate the catalog with functions that reference the processor:

```typescript
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {createMcpCatalogFunctions, MCP_CATALOG_ID} from './v0_9/src/index.js';

const catalogs: Catalog<any>[] = [basicCatalog];

const processor = new MessageProcessor(catalogs, async action => {
  console.log('A2UI action triggered:', action);
});

catalogs.push(
  new Catalog(
    MCP_CATALOG_ID,
    [],
    createMcpCatalogFunctions(() => client, processor),
  ),
);
```

Push every catalog before the first message arrives, since `getClientCapabilities` reports whatever the array holds when it is called.

To mix MCP tools with Basic Catalog components, build one composite catalog instead of two:

```typescript
catalogs.push(
  new Catalog(MY_COMPOSITE_CATALOG_ID, Array.from(basicCatalog.components.values()), [
    ...Array.from(basicCatalog.functions.values()),
    ...createMcpCatalogFunctions(() => client, processor),
  ]),
);
```

For multi-server setups, keep a registry of which server advertises each tool, usually built from `listTools()` at connection time, and resolve it in the same hook:

```typescript
const mcpFunctions = createMcpCatalogFunctions(
  toolName => mcpClients.get(toolServers.get(toolName)) ?? defaultClient,
  processor,
);
```

Resolving once per invocation is what keeps resource URIs meaningful: the UI resource read and the tool call always happen on the same connection. The resolver may be async.

The resolver returns `McpToolClient`, which is `Pick<Client, 'request' | 'readResource' | 'listTools'>`. Signatures come from the MCP SDK, so they cannot drift, but the type is structural: pass the SDK's `Client`, a wrapper that adds retries or logging, or a test double.

A host that wants the tool call without the data functions can build it alone with `createCallMcpToolImplementation`, which takes the same two parameters.

### What a tool call does

On each invocation the catalog:

1. Resolves the client through `getMcpClientForTool(toolName)` and issues `tools/call`, with progress notifications resetting the request timeout.
2. Throws if the result is missing or flags `isError`.
3. Collects UI resource URIs from `result._meta.ui.resourceUri`. When the result names none, it falls back to the URIs the tool declared under the same field in `tools/list`, so result URIs override declared ones rather than adding to them. Either field holds one URI or an array, and duplicates are dropped. Discovery runs lazily, once per client, and a discovery failure is logged and read as no declared URIs.
4. Fetches each UI resource through `resources/read`, once per URI, and decodes every content block whose `mimeType` is `application/a2ui+json`. A resource carrying several such blocks contributes all of them, and one carrying none contributes nothing.
5. Processes each UI resource in the order its URI appeared, skipping any that would recreate a live surface.
6. Processes the A2UI messages inlined in `result.content`, in content order. Only an embedded resource block declaring `application/a2ui+json` counts: a text block is prose for the model, even when it holds a message.
7. Returns the `CallToolResult` unchanged, for a surrounding data function to reshape.

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

Most MCP servers answer in their own shape: plain text, or structured content that no A2UI renderer understands. The data functions let the payload translate that shape, so the host needs no code for the server it is talking to.

A payload nests the tool call inside the functions that reshape it, and wraps the whole thing in `updateDataModel`:

```json
{
  "call": "updateDataModel",
  "args": {
    "updates": {
      "call": "jmespath",
      "args": {
        "expression": "{\"/entries\": lines}",
        "data": {
          "call": "split",
          "args": {
            "value": {"call": "callMcpTool", "args": {"name": "list_directory"}},
            "separator": "\n"
          }
        }
      }
    }
  }
}
```

Read the chain inside out: the tool runs, `split` cuts its output into lines, `jmespath` shapes those lines into an object of data model paths, and `updateDataModel` writes each path. The [filesystem sample](../../samples/community/mcp/a2ui-over-mcp-filesystem/a2ui_filesystem.json) runs a longer version of this chain against a real server.

Both `jmespath` and `updateDataModel` resolve bindings nested inside a literal argument, so one document can combine a tool result with values already in the data model. The sample's search button builds its document this way:

```json
{
  "call": "jmespath",
  "args": {
    "expression": {"path": "/expr/search"},
    "data": {
      "dir": {"path": "/dir"},
      "nl": "\n",
      "pattern": {"path": "/search_pattern"}
    }
  }
}
```

The real payload adds one more key to `data`, `rows`, holding the pending tool chain. Holding the expression in the data model, as `{"path": "/expr/search"}` does above, keeps a long expression out of every control that uses it and lets a template row name the expression its own row needs.

### Composing asynchronous calls

A2UI resolves a function call's arguments before it invokes the function, but it has no way to await one. An argument that is a pending `callMcpTool` therefore arrives as a `Promise` rather than a value.

Each data function settles its own arguments, including pending values nested inside a literal object, which is what makes the chain above work without the host awaiting anything. A call whose arguments hold nothing pending stays synchronous, so these functions remain usable from a reactive binding and not only from an action.

### Writing a literal object that holds a `path` key

`DataContext.resolveDynamicValue` reads any object holding a `path` key as a data binding. A tool whose argument happens to be named `path` therefore cannot take a literal arguments object:

```json
{"name": "list_directory_with_sizes", "arguments": {"path": "~"}}
```

A2UI reads `{"path": "~"}` as a binding to the data model path `~`, resolves it to nothing, and the tool runs without the argument it needs.

Build the object with `jmespath` instead. The expression `{path: @}` names the key, and `@` is whatever `data` holds:

```json
{
  "call": "callMcpTool",
  "args": {
    "name": "list_directory_with_sizes",
    "arguments": {"call": "jmespath", "args": {"expression": "{path: @}", "data": "~"}}
  }
}
```

A binding in place of the whole object works too, because A2UI resolves it before `callMcpTool` sees it:

```json
{"arguments": {"path": "/tool_args/list_directory"}}
```

### Expression language and regular expressions

The `jmespath` function uses the standard [JMESPath](https://jmespath.org) specification (via [`jmespath`](https://www.npmjs.com/package/jmespath)), ensuring expressions remain portable across client implementations. Non-standard extensions such as `let` bindings, ternary operators (`? :`), arithmetic operators, and root references (`$`) are not supported.

To handle string splitting and regular expressions portably, compose `split`, `regexCapture`, and `regexReplace` before passing the resulting data into `jmespath`. Both regex functions use [RE2](https://github.com/google/re2) for linear-time execution without backtracking. To test whether a string matches a pattern, use the basic catalog's `regex` function.

Useful JMESPath idioms:

- **Conditionals**: Use `(cond && valueIfTrue) || valueIfFalse` (note that empty strings, empty arrays, empty objects, `null`, and `false` are falsy).
- **Intermediate values**: Pipe into a multi-select hash to name sub-results: `{n: length(rows)} | {"/count": n}`.
- **Mapping and filtering**: Use `rows[*]` to project over a list (`rows[]` flattens instead), and `rows[?@ != null]` to filter out non-matching `regexCapture` entries.
- **Newlines**: Raw strings do not process escape sequences (`'\n'` is literal). Use JSON string literals (`` `"\n"` ``) or pass newline characters in through `data`.

## Module layout

| File                                    | Responsibility                                                                   |
| :-------------------------------------- | :------------------------------------------------------------------------------- |
| `v0_9/mcp_catalog.json`                 | The published catalog schema: every function and its arguments                   |
| `v0_9/src/index.ts`                     | Package entry: `MCP_CATALOG_ID`, `createMcpCatalogFunctions`, and public exports |
| `v0_9/src/functions/callMcpTool.ts`     | MCP tool execution, UI resource discovery, caching, and message decoding         |
| `v0_9/src/functions/jmespath.ts`        | Standard JMESPath evaluation against data documents                              |
| `v0_9/src/functions/split.ts`           | String and string-array splitting                                                |
| `v0_9/src/functions/regexCapture.ts`    | Linear-time RE2 capture group extraction                                         |
| `v0_9/src/functions/regexReplace.ts`    | Literal RE2 string replacement                                                   |
| `v0_9/src/functions/updateDataModel.ts` | Writing key-value updates into the calling surface data model                    |
| `v0_9/src/functions/common.ts`          | Shared helpers for async argument settling, RE2 pattern caching, and coercion    |
| `v0_9/src/dynamic-values.ts`            | Resolution of dynamic values nested in literal containers                        |

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
node --import tsx --test catalogs/mcp/v0_9/src/functions/jmespath.test.ts
```

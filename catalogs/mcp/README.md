# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools and reshape what those tools return. It defines `callMcpTool` and six data functions, so an agent can emit a payload whose buttons and data bindings call MCP server tools directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog contributes seven functions and the machinery behind them:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the client it returns for the tool call, the UI resource read, and tool discovery.
- Tool results are applied for you. The catalog fetches and caches the UI resource a result points at, then processes any A2UI messages embedded in the result content.
- Tool arguments accept data bindings, so form state can be passed straight into a tool call.
- The data functions turn a tool result into data model updates, which lets a payload drive a server that knows nothing about A2UI.
- Nothing here is renderer-specific. It works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`, exported as `MCP_CATALOG_ID`. It targets protocol v0.9 and v0.9.1.

`callMcpTool` takes two arguments, declared in [mcp_catalog.json](v0_9/mcp_catalog.json):

| Parameter   | Type            | Required          | Description                   |
| :---------- | :-------------- | :---------------- | :---------------------------- |
| `name`      | `DynamicString` | Yes               | The MCP tool to execute.      |
| `arguments` | `object`        | No (default `{}`) | Arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is a host concern resolved inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult` and does nothing else with it. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns nothing, or the result is flagged `isError`.

Five data functions reshape that result and write it into the data model:

| Function          | Arguments                         | Returns                                                                     |
| :---------------- | :-------------------------------- | :-------------------------------------------------------------------------- |
| `jmespath`        | `expression`, `data`              | What the expression evaluates to, or `null` where it reads a missing field. |
| `split`           | `value`, `separator`              | The parts of `value`. An empty separator splits into characters.            |
| `regexCapture`    | `value`, `pattern`                | The capture groups of the first match, or `null` when the pattern misses.   |
| `regexReplace`    | `value`, `pattern`, `replacement` | `value` with every match replaced by literal text.                          |
| `updateDataModel` | `updates`                         | Nothing. Writes each key of `updates` into the calling surface.             |

Every argument above is required. `split`, `regexCapture`, and `regexReplace` also accept an array in `value` and apply element by element, which is how a payload processes every line of a tool result without a loop.

To test whether a string matches a pattern, use the basic catalog `regex` function rather than one published here.

For `updateDataModel`, a key starting with `/` is absolute, and a relative key resolves against the data context the call was made from, which is the row scope when the call came from a template list.

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

A `MessageProcessor` takes its catalogs at construction time, which looks circular: the catalog holds the functions, and one of them needs the processor. It is not, because the processor keeps the array you give it and reads it lazily. Pass the array first, then fill it in:

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

### The expression language

Expressions are [JMESPath](https://jmespath.org), the original specification and nothing more.

Evaluation runs on [`jmespath`](https://www.npmjs.com/package/jmespath) version `^0.16.0`, the reference JavaScript implementation, which accepts the original grammar and rejects everything else. The evaluator is therefore the portability guarantee, and no separate grammar check has to be kept in step with it. An expression that A2UI accepts runs unchanged on a client built against a stock JMESPath library in any language.

Dialect extensions that other packages add fail to parse, so none of the following are available:

- `let` bindings.
- A `? :` ternary.
- Arithmetic operators.
- A `$` root reference.

The language is also total. It has no loops, no recursion, and no way to reach the host, so an expression cannot run away or escape the document it was given. A payload cannot hang the host, so the host needs no timeout or worker thread.

Stock JMESPath has no regular expressions and no `split`, and this catalog registers no extension functions to add them, because doing so would make an A2UI expression unportable in exactly the way the reference implementation rules out. Call `split`, `regexCapture`, and `regexReplace` first, then pass their output in as `data`. To test whether a string matches a pattern, use the basic catalog `regex` function.

The two regular expression functions match with [RE2](https://github.com/google/re2), which uses a finite automaton rather than backtracking, so a pattern such as `^(a+)+$` runs in time linear in the input instead of exponential. RE2 rejects backreferences and lookaround, so a pattern using either fails to compile rather than running slowly. The basic catalog `regex` function uses the host `RegExp` instead, so reserve it for patterns and inputs the payload controls.

Two idioms replace the syntax that is unavailable:

- **Conditionals.** Write `(cond && valueIfTrue) || valueIfFalse`. Both branches must be truthy values, and an empty string, empty array, empty object, `null`, and `false` are all falsy.
- **Intermediate values.** Pipe into a multi-select hash to name subresults, then read them by name: `{n: length(rows)} | {"/count": n}`.

Three details catch people out:

- Use `rows[*]` to map over a list. `rows[]` flattens one level instead, which is rarely what a list of rows wants. Filter with `rows[?@ != null]`, which is how a payload drops the elements that `regexCapture` did not match.
- A raw string does not process escapes, so `'\n'` is a backslash and an `n`. Write a real newline as the JSON literal `` `"\n"` ``, or pass one in through `data` and read it by name.
- A projection rebinds the current node, and the original grammar has no root reference, so a value at the top of `data` is not visible inside `rows[*].{...}`. Build such a value in the component instead: a template row can read an absolute path, so `formatString` with `${/dir}/${name}` joins a value held once to a field held per row.

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

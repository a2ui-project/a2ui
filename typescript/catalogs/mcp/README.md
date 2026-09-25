# @a2ui/catalog-mcp

The A2UI MCP catalog for web renderers. It lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools, transform tool results into data model updates, and embed [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) in a sandboxed frame. It defines `callMcpTool`, five data functions and the `McpApp` universal component, allowing agents to emit declarative payloads whose controls, bindings and embedded apps interact with MCP servers directly.

The package has three entry points:

| Entry point                    | Contents                                                                                                                                          | Environment     |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------- |
| `@a2ui/catalog-mcp`            | Everything: `mcpCatalog` with the `McpApp` component and the data functions, the sandbox configuration, the host bridge, and the functions below. | Browser         |
| `@a2ui/catalog-mcp/functions`  | `MCP_CATALOG_ID`, `createMcpCatalogFunctions`, `callMcpTool` and the data functions. Imports nothing that needs a DOM.                            | Browser or Node |
| `@a2ui/catalog-mcp/components` | The `McpApp` component, its API and `McpAppBridge`, without the functions.                                                                        | Browser         |

`@a2ui/catalog-mcp/catalog.json` is the bundled catalog schema.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog provides six functions and one component:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the returned client for tool execution, UI resource reads, and tool discovery.
- Tool results are processed automatically. The catalog fetches and caches UI resources referenced by results, then applies any A2UI messages embedded in the result content.
- Tool arguments support data bindings, allowing form state to pass directly into tool calls.
- Data functions transform tool output into data model updates, enabling A2UI payloads to interact with standard MCP servers that do not natively emit A2UI.
- `McpApp` runs an MCP App inside a double-iframe sandbox and speaks the MCP Apps protocol to it: the tool calls the app is allowed to make become A2UI actions, and parts of the data model can be bound into the app both ways. See [The McpApp component](#the-mcpapp-component).
- The functions work with any A2UI web renderer built on `MessageProcessor`; the component needs a renderer that hosts universal components, which today is the Lit renderer.

## Catalog specification

The canonical schema lives at [`catalogs/mcp/catalog.json`](../../../catalogs/mcp/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-mcp/catalog.json`. The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`, exported as `MCP_CATALOG_ID`. The `McpApp` component and the protocol it speaks are described in [`catalogs/mcp/README.md`](../../../catalogs/mcp/README.md) and [`catalogs/mcp/mcp_app_specification.md`](../../../catalogs/mcp/mcp_app_specification.md).

`callMcpTool` takes two arguments:

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
npm install @a2ui/catalog-mcp @a2ui/web_core lit
```

`@a2ui/web_core` and `lit` are peer dependencies: `McpApp` is a universal component built on `A2uiLitElement` from `@a2ui/web_core/v0_9/universal`. `@modelcontextprotocol/sdk` and `@modelcontextprotocol/ext-apps` come with the package. A Node agent that only needs the functions imports `@a2ui/catalog-mcp/functions` and does not need `lit` at runtime.

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
import {createMcpCatalogFunctions, MCP_CATALOG_ID} from '@a2ui/catalog-mcp/functions';

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

A surface that also shows MCP Apps adds the `McpApp` component to that list; see [The McpApp component](#the-mcpapp-component).

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

Read the chain inside out: the tool runs, `split` cuts its output into lines, `jmespath` shapes those lines into an object of data model paths, and `updateDataModel` writes each path. The [filesystem sample](../../../samples/community/mcp/a2ui-over-mcp-filesystem/a2ui_filesystem.json) runs a longer version of this chain against a real server.

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

## The McpApp component

`McpApp` renders an [MCP App](https://github.com/modelcontextprotocol/ext-apps) in a surface. The app is an HTML document the agent sends in the component's `htmlContent`; it runs in a sandboxed inner frame behind a proxy page served from the host's origin (see [Sandbox asset](#sandbox-asset)) and talks to the host with the MCP Apps JSON-RPC protocol over `postMessage`, using `AppBridge` from `@modelcontextprotocol/ext-apps` on the host side. An app written with the MCP Apps App SDK works as it is; the [catalog examples](../../../catalogs/mcp/examples) show the raw protocol.

### Registration

The component is a custom element that any renderer able to host universal components can render. Today that is the Lit renderer, `@a2ui/lit`. `mcpCatalog` holds the component and the data functions under the MCP catalog id, so a surface that only shows apps registers it as it is:

```typescript
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor([basicCatalog, mcpCatalog]);
```

A surface is bound to one catalog: the `catalogId` of its `createSurface` message selects one of the registered catalogs, and only that catalog's components and functions are available in it. Surfaces that mix apps with basic components, as the [data binding example](../../../catalogs/mcp/examples/01_data-binding.json) does, or that call `callMcpTool`, therefore use a catalog that carries everything under the MCP catalog id:

```typescript
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {createMcpCatalogFunctions, MCP_CATALOG_ID, mcpCatalog} from '@a2ui/catalog-mcp';

const catalogs: Catalog<any>[] = [];
const processor = new MessageProcessor(catalogs, onAction);
catalogs.push(
  new Catalog(
    MCP_CATALOG_ID,
    [...basicCatalog.components.values(), ...mcpCatalog.components.values()],
    [...basicCatalog.functions.values(), ...createMcpCatalogFunctions(() => client, processor)],
  ),
);
```

The `Catalog` type parameter is `WebComponentImplementation` from `@a2ui/web_core/v0_9/universal` when the compiler cannot infer it.

### Properties

| Property           | Type                                | Purpose                                                                                                                                                                                        |
| :----------------- | :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlContent`      | `DynamicString`, required           | The HTML document of the app, rendered through `srcdoc`. A value prefixed with `url_encoded:` is decoded with `decodeURIComponent` first. An empty value loads nothing.                        |
| `title`            | `DynamicString`                     | Accessible name of the frame, unless `accessibility.label` is set. Defaults to "MCP App".                                                                                                      |
| `allowedTools`     | array of tool names                 | The tools the app may call. A `tools/call` request for a listed tool is dispatched as an A2UI action named after the tool, with the arguments as its context; any other tool call is rejected. |
| `allowedFunctions` | map of function name to JSON Schema | Catalog functions the app may call through `ui/requests/function-call`, each with the schema of its arguments. Unlisted functions and invalid arguments are rejected.                          |
| `data.paths`       | map of key to JSON pointer          | Data model paths bound into the app. Their values are sent when the app is initialized and whenever they change, and the app can write them back.                                              |
| `accessibility`    | `AccessibilityAttributes`           | `label` becomes the accessible name of the frame.                                                                                                                                              |

The message that renders the feedback form of [`catalogs/mcp/examples/00_inline-tool-call.json`](../../../catalogs/mcp/examples/00_inline-tool-call.json), markup shortened:

```json
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "gallery-mcp-app-tool-call",
    "components": [
      {
        "id": "root",
        "component": "McpApp",
        "title": "Feedback form",
        "allowedTools": ["submit_feedback"],
        "htmlContent": "<!doctype html><html><body><button id=\"send\">Send feedback</button><script>...</script></body></html>"
      }
    ]
  }
}
```

The app inside sends `ui/initialize`, gets the host's capabilities back, and later calls the `submit_feedback` tool with the form values. The host answers the call at once with an empty result and dispatches an action named `submit_feedback` from the `root` component, with the arguments as its context, which reaches the agent like any other action. A tool that is not listed gets a JSON-RPC error (`-32602`).

### What the host does

For each `McpApp`, the host:

- answers `ui/initialize` with its capabilities (`openLinks`, `logging`, `serverTools`), its name and version (`DEFAULT_MCP_APP_HOST_INFO`), and the frame's dimensions as the host context, then sends `ui/notifications/host-context-changed` when the frame is resized;
- sends one `ui/notifications/data-model-update` per key of `data.paths` once the app reports `ui/notifications/initialized`, and one more whenever a bound value changes: a whole value for primitives, one update per changed field, with `subpath`, for objects;
- writes `ui/notifications/data-model-change` notifications to the bound path (or the `subpath` under it) without echoing them back, and drops changes to keys that are not bound;
- dispatches allowed `tools/call` requests as actions, runs allowed `ui/requests/function-call` requests through the surface catalog and answers with `{status: 'success', result}` or a JSON-RPC error, and applies `ui/notifications/size-changed` to the frame;
- logs `notifications/message` to the console.

Every payload from the app is checked for prototype pollution keys, nesting depth and size before it is used. Anything that fails is rejected with a JSON-RPC error (requests) or dropped with a `console.warn` (notifications). Property changes are applied live: a new `htmlContent` reloads the app and connects a fresh bridge, and the allowlists are read on every request.

### Styling

The component has no `height` property; it is 500px tall until the app asks for a size, and it is styled through CSS custom properties, which can be set on any ancestor:

| Property                               | Default                                                              | Purpose                                |
| :------------------------------------- | :------------------------------------------------------------------- | :------------------------------------- |
| `--a2ui-sandboxed-frame-height`        | `500px`                                                              | Height until the app asks for one.     |
| `--a2ui-sandboxed-frame-border`        | `var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)` | Border around the frame.               |
| `--a2ui-sandboxed-frame-border-radius` | `var(--a2ui-border-radius, 8px)`                                     | Corner radius.                         |
| `--a2ui-sandboxed-frame-background`    | `#fff`                                                               | Background behind transparent content. |

An app that asks for a size through `ui/notifications/size-changed` resizes the frame and the element within the limits of the bridge (100px to 2000px high, 200px to 3000px wide).

## Sandbox asset

Untrusted content never runs directly in the host page. The host embeds `sandbox.html`, an un-sandboxed proxy page served from the host's own origin, and the proxy creates a strictly sandboxed inner frame for the app: `sandbox="allow-scripts"` only, so no `allow-same-origin`, no forms, no modal dialogs, no top navigation, no popups, and every sensitive permission denied. This double iframe keeps the outer frame reachable for developer tools and browser extensions, which crash with `SecurityError` when they meet a sandboxed frame directly in the page, while the app runs in an opaque origin with no access to the host's cookies, storage or DOM. The proxy checks the embedding page's origin, relays messages between the host and the inner frame, and rejects everything else.

The proxy is shipped in the `sandbox/` directory of the published package (`dist/sandbox/` in the repository):

| File               | Purpose                                                                                      |
| :----------------- | :------------------------------------------------------------------------------------------- |
| `sandbox.html`     | The page `McpApp` loads. Its CSP keeps the inner frame from loading external URLs.           |
| `sandbox-url.html` | The same proxy for external URLs, used by `@a2ui/catalog-iframe`. `McpApp` does not load it. |
| `sandbox.js`       | The proxy script, shared by both pages.                                                      |

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

The default proxy URL is `/a2ui-sandbox/sandbox.html`, resolved against the document base URL. To serve the directory somewhere else, set the base URL once at startup:

```typescript
import {configureSandbox} from '@a2ui/catalog-mcp';

configureSandbox({baseUrl: '/static/frames/'});
```

`resolveSandboxUrl('html')` returns the URL the component loads.

The proxy runs a self-test on startup: it fails unless it is isolated from the top window, which is only the case when the proxy is served from another origin than the host page. On the default same-origin deployment the test cannot pass, so the URL carries `disable_security_self_test=true` automatically. To serve the proxy from a dedicated origin (the stronger isolation), point `baseUrl` at it and list the host origin in the proxy page, which then keeps the self-test enabled:

```html
<meta name="a2ui-sandbox-host-origins" content="https://app.example.com" />
```

`configureSandbox({disableSecuritySelfTest: true | false})` overrides the automatic choice.

## Host bridge

The component owns its bridge; this section is for hosts that embed an MCP App frame without the component. `McpAppBridge` connects one frame to the surface that renders it. It takes the frame element, a `FrameHost` (five functions: read, write and subscribe to a data model path, invoke a catalog function, dispatch an action), a function that returns the component's current properties, and a callback for size requests. It creates the `AppBridge` and its `PostMessageTransport` to the frame, subscribes to the bound paths and watches the frame's size; the proxy handshake stays with the caller:

```typescript
import {McpAppBridge, resolveSandboxUrl} from '@a2ui/catalog-mcp';

const sandboxUrl = resolveSandboxUrl('html');
frame.src = sandboxUrl.href;

const bridge = new McpAppBridge({
  frame,
  host,
  getProps: () => ({
    allowedTools: props.allowedTools,
    allowedFunctions: props.allowedFunctions,
    dataPaths: props.data?.paths,
  }),
  onSizeChange: (width, height) => resize(frame, width, height),
});
bridge.start();
// Later, when the component is removed:
bridge.dispose();
```

A bridge is used once: create a new one when the frame content changes. Tests can pass a `transport` of their own instead of the frame's `postMessage` channel.

## Module layout

| File                                   | Responsibility                                                                                                                                                                                 |
| :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/catalog.json`                     | Copy of `catalogs/mcp/catalog.json` made by `scripts/copy-catalog.js` at build time                                                                                                            |
| `src/index.ts`                         | Browser entry point: the catalog, the component, the sandbox configuration, the bridge and the functions                                                                                       |
| `src/functions.ts`                     | `@a2ui/catalog-mcp/functions`: `MCP_CATALOG_ID`, `createMcpCatalogFunctions` and the functions, DOM-free                                                                                       |
| `src/catalog.ts`                       | `mcpCatalog`: the `McpApp` component and the data functions under the catalog id                                                                                                               |
| `src/components/mcp_app.ts`            | The `McpApp` universal component and its API                                                                                                                                                   |
| `src/components/mcp_app_bridge.ts`     | `McpAppBridge`: `AppBridge` setup, tool calls, function calls and data model sync                                                                                                              |
| `src/components/payload_validation.ts` | JSON Schema validation of function call arguments against `allowedFunctions`                                                                                                                   |
| `src/shared/sandbox/`                  | Copy of `typescript/catalogs/shared/sandbox/` made by `scripts/copy-shared.js` at build time: the proxy, the base element, the host adapter and the helpers shared with `@a2ui/catalog-iframe` |
| `src/functions/callMcpTool.ts`         | MCP tool execution, UI resource discovery, caching, and message decoding                                                                                                                       |
| `src/functions/jmespath.ts`            | Standard JMESPath evaluation against data documents                                                                                                                                            |
| `src/functions/split.ts`               | String and string-array splitting                                                                                                                                                              |
| `src/functions/regexCapture.ts`        | Linear-time RE2 capture group extraction                                                                                                                                                       |
| `src/functions/regexReplace.ts`        | Literal RE2 string replacement                                                                                                                                                                 |
| `src/functions/updateDataModel.ts`     | Writing key-value updates into the calling surface data model                                                                                                                                  |
| `src/functions/common.ts`              | Shared helpers for async argument settling, RE2 pattern caching, and coercion                                                                                                                  |
| `src/dynamic-values.ts`                | Resolution of dynamic values nested in literal containers                                                                                                                                      |

## Building

The package is `@a2ui/catalog-mcp`. It compiles to `dist/`, and consumers import it by name rather than reaching into `src`. The build copies the catalog schema and the shared sandbox code into `src/`, compiles with `tsc` and bundles the proxy into `dist/sandbox/`; the shared code is maintained in `typescript/catalogs/shared/`, so edit it there.

```bash
# Builds @a2ui/web_core first, then this package
yarn workspaces foreach -R --from @a2ui/catalog-mcp --topological-dev run build

# Or, if @a2ui/web_core is already built
yarn workspace @a2ui/catalog-mcp build
```

## Running tests

The function tests run on Node's test runner with the `tsx` loader, directly against the TypeScript sources, plus a smoke test that imports the built `@a2ui/catalog-mcp/functions` entry point. The component, catalog and shared sandbox tests run with Karma in headless Chrome against the real sandbox proxy and a fixture app built on the MCP Apps App SDK. The `test` script runs both:

```bash
# Every test in the MCP catalog workspace
yarn workspace @a2ui/catalog-mcp test

# Only the Node tests, or only the browser tests
yarn workspace @a2ui/catalog-mcp test:node
yarn workspace @a2ui/catalog-mcp test:karma

# Or a single Node test file
node --import tsx --test typescript/catalogs/mcp/src/functions/jmespath.test.ts
```

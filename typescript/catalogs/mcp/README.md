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

The canonical schema lives at [`catalogs/mcp/v1/catalog.json`](../../../catalogs/mcp/v1/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-mcp/catalog.json`. The catalog ID is `https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`, available as `mcpCatalog.id`.

`callMcpTool` takes three arguments:

| Parameter        | Type            | Required          | Description                                                                                                |
| :--------------- | :-------------- | :---------------- | :--------------------------------------------------------------------------------------------------------- |
| `name`           | `DynamicString` | Yes               | The MCP tool to execute.                                                                                   |
| `arguments`      | `object`        | No (default `{}`) | Arguments passed to the tool.                                                                              |
| `targetDataPath` | `DynamicString` | No                | Optional JSON Pointer path on the surface data model where a resolved MCP App resource payload is written. |

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

### Register the catalog and configure the host

`mcpCatalog` holds the `McpApp` component and every function of the catalog. Register it with the `MessageProcessor`, then tell the catalog how to reach your MCP servers with `configureMcpCatalog`. `callMcpTool` reads that configuration when it runs, so the order of the two calls does not matter as long as both happen before the first tool call:

```typescript
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor([basicCatalog, mcpCatalog], async action => {
  console.log('A2UI action triggered:', action);
});

configureMcpCatalog({
  getMcpClientForTool: toolName => client,
  processor,
});
```

`processor` is where the catalog sends the A2UI messages it finds in tool results and UI resources. The configuration is module-level, like the sandbox configuration below: one per page, read on every call, and `configureMcpCatalog` can be called again to change a single field.

Push every catalog before the first message arrives, since `getClientCapabilities` reports whatever the array holds when it is called.

A surface resolves components through its default catalog, the `catalogId` of its `createSurface` message, unless a component names another registered catalog with its own `catalogId`. A payload that mixes basic components with `McpApp` therefore needs no composed catalog: it creates the surface with the basic catalog id and sets `"catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"` on the `McpApp` component, as the [catalog examples](../../../catalogs/mcp/v1/examples) do.

Function calls in expressions (`${...}`, `@call`) are the exception: they always resolve through the surface's default catalog. A payload that calls `callMcpTool` or the data functions from expressions next to basic components creates its surface with a catalog that carries both; build one under the id the agent uses (`mcpCatalog.id` is the canonical one):

```typescript
import {basicCatalog, Catalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor(
  [
    new Catalog(
      mcpCatalog.id,
      '1.0',
      [...basicCatalog.components.values(), ...mcpCatalog.components.values()],
      [...basicCatalog.functions.values(), ...mcpCatalog.functions.values()],
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

`configureMcpCatalog` takes two more options: `defaultVersion`, the A2UI protocol version given to decoded messages that carry none (`'v1.0'` unless set), and `onMcpAppResource`, called when a tool call resolves an MCP App resource (see [Trigger tools from A2UI payloads](#trigger-tools-from-a2ui-payloads)).

A host that wants a subset of the functions registers the implementations it needs (`CallMcpToolImplementation`, `JmespathImplementation`, `SplitImplementation`, `RegexCaptureImplementation`, `RegexReplaceImplementation`, `UpdateDataModelImplementation`) in a catalog of its own; `callMcpTool` still reads the host configuration. Without `configureMcpCatalog`, `callMcpTool` fails with an error that says so, and `McpApp` dispatches the tool calls it allows as A2UI actions instead of executing them.

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

## The `McpApp` component

`McpApp` renders an [MCP App](https://github.com/modelcontextprotocol/ext-apps) in a surface. The app is an HTML document the agent sends in the component's `htmlContent`; it runs in a sandboxed inner frame behind a proxy page served from the host's origin (see [Sandbox asset](#sandbox-asset)) and talks to the host with the MCP Apps JSON-RPC protocol over `postMessage`, using `AppBridge` from `@modelcontextprotocol/ext-apps` on the host side. An app written with the MCP Apps App SDK works as it is.

### Registration

The component is a custom element that any renderer able to host universal components can render. `mcpCatalog` holds the component and every function of the catalog under the MCP catalog id; register it next to the catalogs you already use:

```typescript
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor([basicCatalog, mcpCatalog]);
```

A surface resolves components through its default catalog (the `catalogId` of `createSurface`), and a component can name another registered catalog with its own `catalogId`. A payload that shows an app next to basic components creates the surface with the basic catalog id and marks the `McpApp` component:

```json
{
  "id": "order_app",
  "component": "McpApp",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "title": "Order summary",
  "htmlContent": "..."
}
```

A surface whose default catalog is the MCP catalog renders `McpApp` without the marker, and can call the catalog's functions from expressions; it has no basic components unless the host composes a catalog that carries both (see [Quick start](#quick-start)).

Apps that call tools need the host configured with `configureMcpCatalog` (see [Quick start](#quick-start)); until then an allowed `tools/call` is dispatched as an A2UI action named after the tool.

### Properties

| Property           | Type                                | Purpose                                                                                                                                                                                      |
| :----------------- | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlContent`      | `DynamicString`, required           | The HTML document of the app, rendered through `srcdoc`. A value prefixed with `url_encoded:` is decoded with `decodeURIComponent` first. An empty value loads nothing.                      |
| `title`            | `DynamicString`                     | Accessible name of the frame, unless `accessibility.label` is set. Defaults to "MCP App".                                                                                                    |
| `allowedTools`     | array of tool names                 | The tools the app may call. A `tools/call` request for a listed tool is executed via `callTool` / `callMcpTool` (or dispatched as an A2UI action named after the tool); others are rejected. |
| `allowedFunctions` | map of function name to JSON Schema | Catalog functions the app may call through `ui/requests/function-call`, each with the schema of its arguments. Unlisted functions and invalid arguments are rejected.                        |
| `data.paths`       | map of key to JSON pointer          | Data model paths bound into the app. Supports `toolInput`, `toolResult`, `modelContext`, and custom A2UI keys.                                                                               |
| `csp`              | `McpAppCsp`                         | Per-resource Content Security Policy domain allowlists (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) from `_meta.ui.csp`.                                          |
| `permissions`      | `McpAppPermissions`                 | Browser capability permissions (`camera`, `microphone`, `geolocation`, `clipboardWrite`) delegated to the inner sandboxed iframe from `_meta.ui.permissions`.                                |
| `accessibility`    | `AccessibilityAttributes`           | `label` becomes the accessible name of the frame.                                                                                                                                            |

An `updateComponents` message that renders a feedback form `McpApp`:

```json
{
  "version": "v1.0",
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

The app inside sends `ui/initialize`, gets the host's capabilities back, and later calls the `submit_feedback` tool with the form values. When `callTool` (or `callMcpTool` in the surface catalog) is configured, the host executes the tool and returns the `CallToolResult`; otherwise the host answers the call with an empty result and dispatches an action named `submit_feedback` from the `root` component, with the arguments as its context. A tool that is not listed gets a JSON-RPC error (`-32602`).

### What the host does

For each `McpApp`, the host:

- answers `ui/initialize` with its capabilities (`openLinks`, `logging`, `serverTools`), its name and version (`DEFAULT_MCP_APP_HOST_INFO`), and the host context (`theme`, `displayMode`, `availableDisplayModes`, `locale`, `timeZone`, `platform`, `containerDimensions`), then sends `ui/notifications/host-context-changed` when the frame is resized or the color scheme changes;
- sends one `ui/notifications/data-model-update` per key of `data.paths` once the app reports `ui/notifications/initialized`, plus standard `ui/notifications/tool-input` and `ui/notifications/tool-result` notifications when `toolInput` or `toolResult` is bound, and updates whenever bound values change;
- writes `ui/notifications/data-model-change` notifications and `ui/update-model-context` requests (`structuredContent` and/or `content`) to the bound paths without echoing them back;
- executes allowed `tools/call` requests via `callTool` / `callMcpTool` (or dispatches them as A2UI actions), runs allowed `ui/requests/function-call` requests through the surface catalog, validates and opens `http:`/`https:` URLs for `ui/open-link`, dispatches `ui/message` as an `a2ui.mcpAppMessage` action, answers `ui/request-display-mode` with `{mode: 'inline'}`, and applies `ui/notifications/size-changed` to the frame;
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

### Sandbox asset

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

### Host bridge

The component owns its bridge: `McpAppBridge` (`src/components/mcp_app_bridge.ts`) connects one frame to the surface that renders it, creating the `AppBridge` and its `PostMessageTransport` to the frame, subscribing to the bound paths and watching the frame's size. It is an implementation detail of `McpApp` and is not part of the package entry point.

## Module layout

| File                                   | Responsibility                                                                                                                                                                       |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/catalog.json`                     | Copy of `catalogs/mcp/v1/catalog.json` made by the `copy-catalog` build step                                                                                                         |
| `src/index.ts`                         | Package entry: `mcpCatalog`, `A2uiMcpApp`, `configureMcpCatalog` and the function implementations                                                                                    |
| `src/catalog.ts`                       | `MCP_CATALOG_ID` and `mcpCatalog`: the `McpApp` component and every function of the catalog                                                                                          |
| `src/mcp_catalog_config.ts`            | `configureMcpCatalog`: the host's MCP client resolver, message processor and sandbox location                                                                                        |
| `src/functions/callMcpTool.ts`         | MCP tool execution, UI resource discovery, caching, and message decoding                                                                                                             |
| `src/functions/jmespath.ts`            | Standard JMESPath evaluation against data documents                                                                                                                                  |
| `src/functions/split.ts`               | String and string-array splitting                                                                                                                                                    |
| `src/functions/regexCapture.ts`        | Linear-time RE2 capture group extraction                                                                                                                                             |
| `src/functions/regexReplace.ts`        | Literal RE2 string replacement                                                                                                                                                       |
| `src/functions/updateDataModel.ts`     | Writing key-value updates into the calling surface data model                                                                                                                        |
| `src/functions/common.ts`              | Shared helpers for async argument settling, RE2 pattern caching, and coercion                                                                                                        |
| `src/dynamic-values.ts`                | Resolution of dynamic values nested in literal containers                                                                                                                            |
| `src/components/mcp_app.ts`            | The `McpApp` universal component and its API                                                                                                                                         |
| `src/components/mcp_app_bridge.ts`     | `McpAppBridge`: `AppBridge` setup, tool calls, function calls and data model sync                                                                                                    |
| `src/components/payload_validation.ts` | JSON Schema validation of function call arguments against `allowedFunctions`                                                                                                         |
| `src/shared/sandbox/`                  | Copy of `typescript/catalogs/shared/sandbox/` made by the `copy-shared` build step: the proxy, the base element, the host adapter and the helpers shared with `@a2ui/catalog-iframe` |

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
node --import tsx --test typescript/catalogs/mcp/src/functions/jmespath.test.ts
```

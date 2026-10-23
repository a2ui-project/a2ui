# A2UI MCP catalog

> **Experimental.** This package is under active development. Its API and the catalog schema may change between releases without notice.

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools, shape what they return, and render [MCP Apps](https://github.com/modelcontextprotocol/ext-apps). It defines the `callMcpTool` function, six data functions that shape tool results, and the `McpApp` component, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly.

## Overview

A2UI separates UI layout from backend logic through catalogs. This catalog provides:

- The host supplies one hook, `getMcpClientForTool(toolName)`. The catalog uses the returned client for tool execution, UI resource reads, and tool discovery.
- Tool results are processed automatically. The catalog fetches and caches UI resources referenced by results, then applies any A2UI messages embedded in the result content.
- Tool arguments support data bindings, allowing form state to pass directly into tool calls.
- Six data functions turn what a headless tool returns into data model updates, so a payload can render the output of a tool that knows nothing about A2UI: `parseJson`, `jmespath` and `updateDataModel` for JSON, `split`, `regexCapture` and `regexReplace` for plain text.
- The `McpApp` component embeds MCP Apps in a sandboxed double-iframe and connects them to the host through `AppBridge`.
- The catalog works with any A2UI web renderer built on `MessageProcessor`.

## Catalog specification

The canonical schema lives at [`catalogs/mcp/v1/catalog.json`](../../../catalogs/mcp/v1/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-mcp/catalog.json`. The catalog ID is `https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`, available as `mcpCatalog.id`.

`callMcpTool` takes three arguments:

| Parameter        | Type            | Required          | Description                                                                                                |
| :--------------- | :-------------- | :---------------- | :--------------------------------------------------------------------------------------------------------- |
| `name`           | `DynamicString` | Yes               | The MCP tool to execute.                                                                                   |
| `arguments`      | `object`        | No (default `{}`) | Arguments passed to the tool: an object of dynamic values, or a function call that returns one.            |
| `targetDataPath` | `DynamicString` | No                | Optional JSON Pointer path on the surface data model where a resolved MCP App resource payload is written. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is resolved by the host inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns no result, or the result has `isError: true`.

Six data functions turn that result into data model updates (see [Shape a headless tool result](#shape-a-headless-tool-result)):

| Function          | Arguments                                                                     | Returns                                                                                          |
| :---------------- | :---------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| `parseJson`       | `value: DynamicString`                                                        | The value encoded by the JSON string `value`.                                                    |
| `jmespath`        | `expression: DynamicString`, `data: DynamicValue`                             | The result of evaluating the JMESPath `expression` against `data`, or `null` for missing fields. |
| `updateDataModel` | `updates: DynamicValue`                                                       | Nothing. Writes each key-value pair in `updates` to the surface data model.                      |
| `split`           | `value: DynamicValue`, `separator: DynamicString`                             | Substrings of `value` split by the literal `separator` (or Unicode code points if it is empty).  |
| `regexCapture`    | `value: DynamicValue`, `pattern: DynamicString`                               | Capture groups from the first match of `pattern`, or `null` if there is no match.                |
| `regexReplace`    | `value: DynamicValue`, `pattern: DynamicString`, `replacement: DynamicString` | `value` with every match of `pattern` replaced by the literal `replacement` text.                |

Every argument is required, and the runtime validates each one against its `DynamicString` or `DynamicValue` type once it has resolved, so a `null` or missing argument fails with an `A2uiExpressionError` before the function runs. `parseJson` throws an `A2uiExpressionError` for a malformed `value`, `jmespath` for an expression that does not parse, and `updateDataModel` for `updates` that are not an object, or for a key that is empty or contains a `__proto__`, `constructor` or `prototype` segment. `updateDataModel` checks every key before it writes anything, so a rejected key leaves the data model unchanged. For `updateDataModel`, keys starting with `/` are absolute paths and relative keys resolve against the calling data context, such as the current row of a template list. `split`, `regexCapture` and `regexReplace` take a string or an array of strings in `value` and map over an array; a `null` element reads as the empty string, and so does a capture group that did not participate in the match. None of the functions evaluates `@path` or `@call` objects found inside its data: a tool result is data, not an expression.

Patterns are JavaScript regular expressions, checked with `isSafeRegex` from `@a2ui/web_core` (the check behind the basic catalog's `regex` function) before they are compiled, so a pattern that allows catastrophic backtracking is rejected with an `A2uiExpressionError`, as is one that is not valid JavaScript syntax. Lookarounds and backreferences are accepted when the check passes. RE2 syntax does not carry over: the `(?i)` inline flag is rejected, and `\pL` or `[[:alpha:]]` compile as JavaScript reads them rather than as Unicode or POSIX classes. `regexReplace` inserts `replacement` as written, so `$1` and `$$` stay literal.

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

`mcpCatalog` holds the `McpApp` component and the `callMcpTool` function. Register it with the `MessageProcessor`, then tell the catalog how to reach your MCP servers with `configureMcpCatalog`. `callMcpTool` reads that configuration when it runs, so the order of the two calls does not matter as long as both happen before the first tool call:

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

A surface resolves components and function calls through its default catalog, the `catalogId` of its `createSurface` message, unless the component or the `@call` object names another registered catalog with its own `catalogId`. A payload that mixes basic components with `McpApp` and the MCP functions therefore needs no composed catalog: it creates the surface with the basic catalog id and sets `"catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"` on the `McpApp` component and on each MCP function call, as the [catalog examples](../../../catalogs/mcp/v1/examples) do.

Function calls inside `${...}` string expressions are the exception: they resolve through the surface's default catalog. A payload that calls `callMcpTool` that way next to basic components creates its surface with a catalog that carries both; build one under the id the agent uses (`mcpCatalog.id` is the canonical one):

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

A host that only wants some of the functions registers the `*Implementation` exports it needs (`CallMcpToolImplementation`, `ParseJsonImplementation`, `JmespathImplementation`, `UpdateDataModelImplementation`, `SplitImplementation`, `RegexCaptureImplementation`, `RegexReplaceImplementation`) in a catalog of its own instead of `mcpCatalog`.

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

Without `configureMcpCatalog`, `callMcpTool` fails with an error that says so, and `McpApp` dispatches the tool calls it allows as A2UI actions instead of executing them.

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

A v1.0 payload calls `callMcpTool` from any surface whose host registered `mcpCatalog`, naming the catalog on the call. Arguments may be data bindings, which resolve against the calling surface:

```json
{
  "@call": "callMcpTool",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "name": "get_weather",
    "arguments": {"city": {"@path": "/form/city"}}
  }
}
```

A surface created with the MCP catalog id as its default needs no `catalogId` on the call.

### Shape a headless tool result

Most MCP tools return plain `content` blocks rather than A2UI resources. The data functions read such a result: `jmespath` picks `content[0].text` out of the `CallToolResult`, `parseJson` decodes it, a second `jmespath` builds an object of data model paths, and `updateDataModel` writes it. A button action that loads the open issues of a repository into `/issues`, from [mcp-json-tool-result.json](../../../catalogs/mcp/v1/examples/mcp-json-tool-result.json):

```json
{
  "functionCall": {
    "@call": "updateDataModel",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
    "args": {
      "updates": {
        "@call": "jmespath",
        "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
        "args": {
          "expression": "{\"/issues\": [?state == 'open'].{number: to_string(number), title: title}}",
          "data": {
            "@call": "parseJson",
            "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
            "args": {
              "value": {
                "@call": "jmespath",
                "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
                "args": {
                  "expression": "content[0].text",
                  "data": {
                    "@call": "callMcpTool",
                    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
                    "args": {
                      "name": "list_issues",
                      "arguments": {"repository": {"@path": "/repository"}}
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

`callMcpTool` is asynchronous, so its result reaches the enclosing `jmespath` as a pending Promise. The runtime awaits the pending arguments of a call before it validates them and runs the function, so each function in the chain returns a Promise in turn, which is why the action resolves to a Promise a host can await; with settled arguments the functions run synchronously, so a binding that uses them stays reactive.

A tool that answers in plain text goes through `split` and `regexCapture` instead of `parseJson`. [mcp-text-tool-result.json](../../../catalogs/mcp/v1/examples/mcp-text-tool-result.json) lists a directory whose tool prints one `[DIR] name` or `[FILE] name` line per entry:

```json
{
  "@call": "jmespath",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "expression": "{\"/entries\": [?@ != null].{kind: [0], name: [1]}}",
    "data": {
      "@call": "regexCapture",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
      "args": {
        "pattern": "^\\[(DIR|FILE)\\] (.+)$",
        "value": {
          "@call": "split",
          "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
          "args": {
            "separator": "\n",
            "value": {"...": "jmespath(content[0].text) over callMcpTool(list_directory)"}
          }
        }
      }
    }
  }
}
```

`regexCapture` maps over the lines `split` produced and yields `null` for a line that does not match, such as a header, which the `[?@ != null]` filter drops. The same example binds the heading to `regexReplace` over the directory path; with no pending argument the function runs synchronously, so the heading follows the path like any other binding.

## The `McpApp` component

`McpApp` renders an [MCP App](https://github.com/modelcontextprotocol/ext-apps) in a surface. The app is an HTML document the agent sends in the component's `htmlContent`; it runs in a sandboxed inner frame behind a proxy page served from the host's origin (see [Sandbox asset](#sandbox-asset)) and talks to the host with the MCP Apps JSON-RPC protocol over `postMessage`, using `AppBridge` from `@modelcontextprotocol/ext-apps` on the host side. An app written with the MCP Apps App SDK works as it is; the [catalog examples](../../../catalogs/mcp/v1/examples) show the raw protocol.

### Registration

The component is a custom element that any renderer able to host universal components can render. `mcpCatalog` holds the component and every function of the catalog under the MCP catalog id; register it next to the catalogs you already use:

```typescript
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor([basicCatalog, mcpCatalog]);
```

A surface resolves components through its default catalog (the `catalogId` of `createSurface`), and a component can name another registered catalog with its own `catalogId`. A payload that shows an app next to basic components creates the surface with the basic catalog id and marks the `McpApp` component, as the [3D geometry example](../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json) does:

```json
{
  "id": "scene3d_app",
  "component": "McpApp",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "title": "3D Holographic Geometry Studio",
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
| `src/index.ts`                         | Package entry: `mcpCatalog`, `A2uiMcpApp`, `configureMcpCatalog` and the `*Api` and `*Implementation` of every function                                                              |
| `src/catalog.ts`                       | `MCP_CATALOG_ID` and `mcpCatalog`: the `McpApp` component, `callMcpTool` and the data functions                                                                                      |
| `src/mcp_catalog_config.ts`            | `configureMcpCatalog`: the host's MCP client resolver, message processor and sandbox location                                                                                        |
| `src/functions/callMcpTool.ts`         | MCP tool execution, UI resource discovery, caching, and message decoding                                                                                                             |
| `src/functions/parse_json.ts`          | `parseJson`                                                                                                                                                                          |
| `src/functions/jmespath.ts`            | `jmespath`                                                                                                                                                                           |
| `src/functions/update_data_model.ts`   | `updateDataModel`                                                                                                                                                                    |
| `src/functions/split.ts`               | `split`                                                                                                                                                                              |
| `src/functions/regex_capture.ts`       | `regexCapture`                                                                                                                                                                       |
| `src/functions/regex_replace.ts`       | `regexReplace`                                                                                                                                                                       |
| `src/functions/regex_support.ts`       | `compileSafeRegex`, the cached `RegExp` compilation behind `isSafeRegex`, and `mapTextValue`, the string-or-array mapping of the text functions                                      |
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
node --import tsx --test typescript/catalogs/mcp/src/functions/callMcpTool.test.ts
```

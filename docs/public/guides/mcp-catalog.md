# MCP catalog

The **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)** is an open standard for connecting applications to external tools and data sources, such as GitHub, databases, search engines, or local files. An MCP server exposes tools (functions like `list_issues` or `get_weather` that return data) and optional UI resources (reusable layouts or interactive HTML widgets).

The `@a2ui/catalog-mcp` package connects A2UI v1.0 or later surfaces directly to MCP servers from your web app. It supports two main workflows:

1. Calling MCP tools from buttons, text fields, and other A2UI components, then displaying the returned JSON or text in your surface without waiting for another round-trip to your agent.
2. Embedding interactive [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (standalone HTML widgets provided by an MCP server, such as a 3D canvas or a Kanban board) inside an isolated iframe alongside your regular A2UI components.

The catalog works with Lit, React, Angular, and any other web renderer built on `@a2ui/web_core`.

---

## Setting up the MCP catalog

Setting up the package takes three steps, plus one extra step if you embed `McpApp` HTML widgets.

### 1. Install the packages

Install `@a2ui/catalog-mcp` alongside `@a2ui/web_core`, `lit`, and the MCP TypeScript SDK:

```bash
npm install @a2ui/catalog-mcp @a2ui/web_core lit @modelcontextprotocol/sdk
```

`@a2ui/web_core` and `lit` are peer dependencies so your renderer and catalog share a single copy of A2UI's core classes. `@modelcontextprotocol/sdk` provides the MCP `Client` your app uses to connect to an MCP server.

### 2. Connect your MCP client and register the catalog

Connect an MCP `Client` to your server, pass `mcpCatalog` to `MessageProcessor` alongside `basicCatalog` (or your own component catalog), and call `configureMcpCatalog`:

```ts
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// 1. Connect to your MCP server.
const mcpClient = new Client({name: 'my-web-app', version: '1.0.0'});
await mcpClient.connect(
  new StreamableHTTPClientTransport(new URL('http://localhost:8000/mcp')),
);

// 2. Register mcpCatalog alongside basicCatalog.
const processor = new MessageProcessor([basicCatalog, mcpCatalog], action => {
  console.log('Action dispatched:', action);
});

// 3. Tell the catalog how to reach your MCP client and message processor.
configureMcpCatalog({
  getMcpClientForTool: () => mcpClient,
  processor,
});
```

`getMcpClientForTool` receives the name of the tool being called and returns the MCP client that runs it. When your app connects to a single MCP server, return that client for every call. If your app connects to multiple MCP servers, see [Advanced configuration](#advanced-configuration).

??? note "Using Angular"

    In Angular, wrap `mcpCatalog` in an `AngularCatalog`, pass it to `provideA2UI` (which enables universal web components by default), and point `configureMcpCatalog` at `A2uiRendererService.processor`:

    ```ts
    import {ApplicationConfig, inject, provideEnvironmentInitializer} from '@angular/core';
    import {A2uiRendererService, AngularCatalog, BasicCatalog, provideA2UI} from '@a2ui/angular';
    import {configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';

    const mcpAngularCatalog = new AngularCatalog(
      mcpCatalog.id,
      mcpCatalog.protocolVersion,
      [...mcpCatalog.components.values()],
      [...mcpCatalog.functions.values()],
    );

    export const appConfig: ApplicationConfig = {
      providers: [
        provideA2UI(() => ({
          catalogs: [inject(BasicCatalog), mcpAngularCatalog],
        })),
        provideEnvironmentInitializer(() => {
          configureMcpCatalog({
            getMcpClientForTool: () => mcpClient,
            processor: inject(A2uiRendererService).processor,
          });
        }),
      ],
    };
    ```

### 3. Share the catalog with your agent

For your agent to emit MCP tool calls or `McpApp` components, include the MCP catalog schema in your agent setup:

1. Load `@a2ui/catalog-mcp/catalog.json` (or [`catalogs/mcp/v1/catalog.json`](../../../catalogs/mcp/v1/catalog.json) on non-Node backends) alongside your component catalog when building your agent's prompt and schema validator.
2. Include the MCP catalog ID (`https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`, exported as `mcpCatalog.id` and `MCP_CATALOG_ID`) in the client's `supportedCatalogIds`. Calling `processor.getRendererCapabilities({versions: ['1.0']})` includes every registered catalog automatically.

When an agent creates a surface on the basic catalog, it selects MCP functions and components by setting `"catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"` on each `@call` or `McpApp` component.

### 4. Serve the sandbox files (only for `McpApp`)

If you only call MCP tools with `callMcpTool`, your setup is complete and you can skip to [Calling MCP tools from your UI](#calling-mcp-tools-from-your-ui).

If you render `McpApp` widgets, `McpApp` runs untrusted HTML inside a sandboxed iframe loaded from `/a2ui-sandbox/` on your app's origin. Configure your bundler or web server to serve `node_modules/@a2ui/catalog-mcp/sandbox` at `/a2ui-sandbox/`:

=== "Vite"

    Copy the folder into `public/a2ui-sandbox/`, or copy it at build time with [`vite-plugin-static-copy`](https://github.com/sapphi-red/vite-plugin-static-copy):

    ```ts
    import {defineConfig} from 'vite';
    import {viteStaticCopy} from 'vite-plugin-static-copy';

    export default defineConfig({
      plugins: [
        viteStaticCopy({
          targets: [
            {src: 'node_modules/@a2ui/catalog-mcp/sandbox/*', dest: 'a2ui-sandbox'},
          ],
        }),
      ],
    });
    ```

=== "Angular CLI"

    Add the sandbox directory to the `assets` array in `angular.json`:

    ```json
    {
      "glob": "**/*",
      "input": "node_modules/@a2ui/catalog-mcp/sandbox",
      "output": "a2ui-sandbox"
    }
    ```

=== "Static server"

    Copy `node_modules/@a2ui/catalog-mcp/sandbox` to `<web root>/a2ui-sandbox` on the same origin as your app.

---

## Calling MCP tools from your UI

An A2UI component can invoke an MCP tool directly when a user clicks a button or edits a field. Because the browser calls your MCP server through `callMcpTool`, the UI updates right away without waiting for another round-trip to the agent.

### Displaying results directly with `targetDataPath`

The simplest way to use `callMcpTool` is to pass `targetDataPath`. When the tool succeeds, `callMcpTool` writes the response object to that path in the surface data model, so your components can bind to it directly without extra functions.

For example, this button action from [`mcp-json-tool-result.json`](../../../catalogs/mcp/v1/examples/mcp-json-tool-result.json) calls `list_issues` with the current value of `/repository` and stores the result at `/issueResponse`:

```json
{
  "@call": "callMcpTool",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "name": "list_issues",
    "arguments": {"repository": {"@path": "/repository"}},
    "targetDataPath": "/issueResponse"
  }
}
```

A list component on the same surface can then bind its children directly to `/issueResponse/structuredContent/issues` or `/issueResponse/json`.

`callMcpTool` writes (and returns) an object with these fields:

| Field               | Contents                                                                                                                               |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------- |
| `structuredContent` | Structured data object returned by the MCP server, when the server includes one.                                                       |
| `json`              | Parsed JSON value when `text` is a JSON object or array (or an array of parsed JSON blocks when the tool returns several text blocks). |
| `text`              | All `text` content blocks from the tool result, joined with `\n`.                                                                      |
| `toolName`          | Name of the tool that ran.                                                                                                             |
| `toolInput`         | Resolved arguments sent to the tool.                                                                                                   |
| `toolResult`        | Raw MCP `CallToolResult` from the server.                                                                                              |

If a tool call fails or returns `isError: true`, `callMcpTool` throws an `A2uiExpressionError` and leaves the data model unchanged.

!!! tip "Autocomplete and rapid inputs"

    When several calls write to the same `targetDataPath` at once (such as a search box calling a tool as the user types), only the latest call writes its result. Slower responses from earlier calls are ignored so stale results never overwrite newer ones. Give each independent UI feature its own `targetDataPath` so unrelated calls do not cancel each other's writes.

### Filtering and reshaping JSON results

Many MCP servers return general-purpose JSON payloads that contain more fields or rows than your UI needs. To filter fields or write results to specific data model paths, chain `callMcpTool` with `transformData` and `updateDataModel`:

```json
{
  "@call": "updateDataModel",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "updates": {
      "@call": "transformData",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
      "args": {
        "jmespath": "{\"/issues\": json[?state == 'open'].{number: to_string(number), title: title}}",
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
```

From the innermost call outward, this chain runs three steps:

1. `callMcpTool` calls `list_issues` and returns the payload object containing the parsed `json` array.
2. `transformData` runs a [JMESPath](https://jmespath.org/specification.html) query that keeps only open issues, formats each row to `{number, title}`, and wraps the list in `{"/issues": [...]}`.
3. `updateDataModel` writes `/issues` into the surface data model, updating any components bound to `/issues`.

Note that the stale-response guard only applies to `targetDataPath` on `callMcpTool`, not to `updateDataModel`. For inputs that fire on every keystroke, bind directly to `targetDataPath` instead of chaining `updateDataModel`.

### Parsing plain-text tool output

Some MCP servers return plain text meant for a language model to read (such as `Title: ...\nURL: ...` blocks) rather than JSON. The catalog includes `split` and `regexCapture` so an A2UI payload can turn that text into rows and fields before passing them to `transformData` and `updateDataModel`, without adding custom parsing code to your host app for each tool. Your host app still chooses which MCP servers to connect (see [Setting up the MCP catalog](#setting-up-the-mcp-catalog)). These built-in functions are most useful when users or admins configure that server list at runtime, such as in a chat app. If your app only connects to a few MCP servers that you control, writing a custom function in your own catalog is usually simpler (see _Adding your own data-parsing functions_ under [Advanced configuration](#advanced-configuration)).

Here are all four data functions in the catalog:

| Function          | Arguments            | What it does                                                                                                                         |
| :---------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `transformData`   | `jmespath`, `data`   | Evaluates a standard [JMESPath](https://jmespath.org/specification.html) query against `data` (returning `null` for missing fields). |
| `updateDataModel` | `updates`            | Writes each `{path: value}` pair in `updates` to the surface data model (`/` keys are absolute; others resolve relative to context). |
| `split`           | `value`, `separator` | Splits a string (or each item in an array of strings) by `separator`, or into individual characters when `separator` is `""`.        |
| `regexCapture`    | `value`, `pattern`   | Returns capture groups from the first match of `pattern` (or `null` if unmatched) for a string or each string in an array.           |

??? example "Example: parsing plain-text search results"

    In [`mcp-text-tool-result.json`](../../../catalogs/mcp/v1/examples/mcp-text-tool-result.json), a search tool returns text records separated by blank lines (`\n\n`), where each record starts with `Title: ...` and `URL: ...`. This chain splits the text into records, captures the title and URL from each record, drops non-matching header blocks (`[?@ != null]`), and writes the resulting array to `/results`:

    ```json
    {
      "@call": "updateDataModel",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
      "args": {
        "updates": {
          "@call": "transformData",
          "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
          "args": {
            "jmespath": "{\"/results\": [?@ != null].{title: [0], url: [1]}}",
            "data": {
              "@call": "regexCapture",
              "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
              "args": {
                "pattern": "^Title: (.*)\nURL: (.*)",
                "value": {
                  "@call": "split",
                  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
                  "args": {
                    "separator": "\n\n",
                    "value": {
                      "@call": "transformData",
                      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
                      "args": {
                        "jmespath": "text",
                        "data": {
                          "@call": "callMcpTool",
                          "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
                          "args": {
                            "name": "tavily-search",
                            "arguments": {"query": {"@path": "/query"}}
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
    }
    ```

### Tools that return A2UI surfaces

MCP servers built specifically for A2UI can attach `application/a2ui+json` UI resources to their tools or tool responses. When `callMcpTool` runs one of those tools, it fetches the UI resource and forwards the A2UI messages to the `processor` you passed to `configureMcpCatalog`. To build an MCP server that serves A2UI layouts, see [A2UI over MCP](a2ui_over_mcp.md).

---

## Embedding interactive MCP Apps

Some MCP servers provide interactive HTML widgets called [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) for interfaces that go beyond standard form controls, such as a 3D canvas or a drag-and-drop Kanban board.

The `McpApp` component renders an MCP App inside the sandboxed frame you set up in [Step 4](#4-serve-the-sandbox-files-only-for-mcpapp) and connects it to the surrounding A2UI surface:

```json
{
  "id": "scene3d_app",
  "component": "McpApp",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "title": "3D Holographic Geometry Studio",
  "allowedTools": ["capture_3d_snapshot"],
  "data": {
    "paths": {
      "scene3d": "/scene3d",
      "modelContext": "/scene3d/modelContext"
    }
  },
  "htmlContent": "<!doctype html><html><body>...<script>...</script></body></html>"
}
```

### Connecting the app to your surface

An embedded `McpApp` is isolated from your page DOM, cookies, and browser storage, and interacts with your surface only through explicit properties:

| Property           | Required | Purpose                                                                                                                                             |
| :----------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlContent`      | Yes      | HTML document of the app (values starting with `url_encoded:` are URL-decoded first).                                                               |
| `title`            | No       | Accessible title for the iframe (defaults to `"MCP App"`).                                                                                          |
| `data.paths`       | No       | Maps state keys inside the app (plus reserved `toolInput`, `toolResult`, and `modelContext` keys) to data model paths for two-way reactive sync.    |
| `allowedTools`     | No       | List of MCP tool names the app is allowed to call. Unlisted tool calls are rejected.                                                                |
| `allowedFunctions` | No       | Map of A2UI catalog function names to argument JSON Schemas that the app is allowed to invoke.                                                      |
| `csp`              | No       | Content Security Policy domain allowlists (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) from the resource `_meta.ui.csp`. |
| `permissions`      | No       | Browser permissions (`camera`, `microphone`, `geolocation`, `clipboardWrite`) delegated from the resource `_meta.ui.permissions`.                   |

When a tool result returned by `callMcpTool` contains an MCP App `ui://` resource, its `resourceUri`, `html`, `csp`, and `permissions` fields are also included in the `callMcpTool` payload so you can bind `McpApp` properties to them.

### Styling the frame

`McpApp` starts at `500px` tall and resizes automatically when the embedded app reports its content size. You can customize the frame with CSS custom properties on `a2ui-mcp-app` or any parent element:

```css
a2ui-mcp-app {
  --a2ui-sandboxed-frame-height: 400px;
  --a2ui-sandboxed-frame-border: 1px solid #e2e8f0;
  --a2ui-sandboxed-frame-border-radius: 12px;
  --a2ui-sandboxed-frame-background: #ffffff;
}
```

??? note "Default values for CSS custom properties"

    | CSS custom property                    | Default                                                              | Purpose                                |
    | :------------------------------------- | :------------------------------------------------------------------- | :------------------------------------- |
    | `--a2ui-sandboxed-frame-height`        | `500px`                                                              | Initial height before auto-resize.     |
    | `--a2ui-sandboxed-frame-border`        | `var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)` | Border around the frame.               |
    | `--a2ui-sandboxed-frame-border-radius` | `var(--a2ui-border-radius, 8px)`                                     | Corner radius of the frame.            |
    | `--a2ui-sandboxed-frame-background`    | `#fff`                                                               | Background behind transparent content. |

---

## Advanced configuration

The sections below cover multi-server routing, custom sandbox URLs, partial catalog registration, and custom data parsers:

??? note "Routing across multiple MCP servers and all `configureMcpCatalog` options"

    A2UI payloads refer to tools by name only and never hardcode server URLs. If your host connects to multiple MCP servers, discover each server's tools with `listTools()` at startup and route each `toolName` to the matching client inside `getMcpClientForTool` (which may also return a `Promise`):

    ```ts
    configureMcpCatalog({
      getMcpClientForTool: toolName => clientsByTool.get(toolName) ?? defaultClient,
      processor,
    });
    ```

    You can call `configureMcpCatalog` again at any time to update individual options:

    | Option                | Type                                                    | Purpose                                                                                                                               |
    | :-------------------- | :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
    | `getMcpClientForTool` | `(toolName: string) => McpToolClient \| Promise<...>`   | Returns the MCP client (`Pick<Client, 'request' \| 'readResource' \| 'listTools'>`) that handles `toolName`.                          |
    | `processor`           | `MessageProcessor`                                      | Receives A2UI messages extracted from tool results and `application/a2ui+json` UI resources.                                          |
    | `defaultVersion`      | `string`                                                | Protocol version stamped onto decoded tool-result messages that omit `version` (defaults to `'1.0'`).                                 |
    | `onMcpAppResource`    | `(payload: McpAppResourcePayload, uri: string) => void` | Optional callback invoked when `callMcpTool` resolves a `ui://` (`text/html;profile=mcp-app`) resource.                               |
    | `sandbox`             | `Partial<SandboxConfig>`                                | Overrides where `/a2ui-sandbox/` is hosted (`baseUrl`, default `'/a2ui-sandbox/'`) or its startup check (`disableSecuritySelfTest`).  |

    If you serve the sandbox directory from a custom path or a dedicated sandbox origin, set `sandbox.baseUrl` before rendering the first surface:

    ```ts
    configureMcpCatalog({sandbox: {baseUrl: '/static/frames/'}});
    ```

    If `getMcpClientForTool` is not configured, `McpApp` dispatches allowed tool calls from the embedded widget as A2UI actions named after the tool, so a backend proxy agent can handle them through the `MessageProcessor` action callback.

??? note "Registering only part of the catalog"

    If you want to expose `McpApp` and `callMcpTool` without the four data functions (or pick specific functions), derive a restricted catalog with `mcpCatalog.withEntries` and the individual `*Implementation` exports (`CallMcpToolImplementation`, `TransformDataImplementation`, `UpdateDataModelImplementation`, `SplitImplementation`, and `RegexCaptureImplementation`):

    ```ts
    import {CallMcpToolImplementation, mcpCatalog} from '@a2ui/catalog-mcp';

    const mcpAppOnlyCatalog = mcpCatalog.withEntries(
      [...mcpCatalog.components.values()],
      [CallMcpToolImplementation],
    );
    ```

??? note "Adding your own data-parsing functions"

    Every function in `@a2ui/catalog-mcp` must be implemented across every A2UI renderer, so the built-in function list stays small. If you need a specialized parser such as CSV, define it with `createFunctionImplementation` in [your own catalog](defining-your-own-catalog.md) and register that catalog alongside `mcpCatalog`:

    ```ts
    import {
      basicCatalog,
      Catalog,
      createFunctionImplementation,
      DynamicStringSchema,
      MessageProcessor,
    } from '@a2ui/web_core/v1_0';
    import {mcpCatalog} from '@a2ui/catalog-mcp';
    import {z} from 'zod';

    const ParseCsvImplementation = createFunctionImplementation(
      {
        name: 'parseCsv',
        returnType: 'any',
        schema: z.object({value: DynamicStringSchema}),
        description: 'Splits CSV text into rows of cells.',
      },
      ({value}) =>
        String(value)
          .split('\n')
          .map(line => line.split(',')),
    );

    const parsersCatalog = new Catalog(
      'https://example.com/catalogs/parsers.json',
      '1.0',
      [],
      [ParseCsvImplementation],
    );

    const processor = new MessageProcessor(
      [basicCatalog, mcpCatalog, parsersCatalog],
      onAction,
    );
    ```

    Payloads can then call `parseCsv` with `"catalogId": "https://example.com/catalogs/parsers.json"` and compose it with `callMcpTool` and `transformData`.

??? note "Regular expression rules in `regexCapture`"

    To keep payloads portable across web and native renderers, `regexCapture` accepts JavaScript regular expression syntax without lookahead or lookbehind assertions (`(?=`, `(?!`, `(?<=`, `(?<!`) and without backreferences (`\1` through `\9`, `\k<name>`). It also rejects patterns vulnerable to catastrophic backtracking, using the same safety check as the basic catalog's `regex` function. Unsupported or unsafe patterns throw an `A2uiExpressionError`.

---

## Troubleshooting

### The `McpApp` frame stays blank (404 under `/a2ui-sandbox/`)

Check that `node_modules/@a2ui/catalog-mcp/sandbox` is served at `/a2ui-sandbox/` on your app's origin (see [Step 4](#4-serve-the-sandbox-files-only-for-mcpapp)), or pass `configureMcpCatalog({sandbox: {baseUrl}})` with the path where you host those files.

### Tool or function calls from an embedded `McpApp` are rejected

Check the browser console for warnings. Every MCP tool the widget calls must be listed in `allowedTools`, and every A2UI function must be listed in `allowedFunctions` and registered in `mcpCatalog` or the surface's catalog.

### Custom element registration collisions or empty components

Loading two copies of `lit` or `@a2ui/web_core` breaks custom element registration and `Catalog` instance checks. Run `npm dedupe` (and check `npm ls lit @a2ui/web_core`), and in Vite add `resolve: {dedupe: ['lit', '@a2ui/web_core']}` to `vite.config.ts`.

---

## Next steps

1. Read how the double-iframe sandbox and JSON-RPC message channels work, and run complete sample applications in [MCP Apps in A2UI](mcp-apps-in-a2ui.md).
2. Build an MCP server that returns reusable A2UI layout templates in [A2UI over MCP](a2ui_over_mcp.md).
3. Browse the full TypeScript API reference in the [`@a2ui/catalog-mcp` README](../../../typescript/catalogs/mcp/README.md).
4. Read about the double-iframe security model and JSON-RPC message protocol in the [MCP App component specification](../../../catalogs/mcp/v1/mcp_app_specification.md).

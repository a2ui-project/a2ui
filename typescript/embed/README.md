# @a2ui/embed

Embed A2UI in [MCP Apps](https://github.com/modelcontextprotocol/ext-apps): an MCP server returns A2UI v1.0 messages from its tools, and a single-file app renders them in any MCP Apps host, so the host needs no A2UI support.

This package is under development. It currently provides the contract between the server and the app, the server API, the app's runtime, and the command that builds the app.

## Contract

The server and the app follow a versioned contract, exported from `@a2ui/embed/contract`. A server written in any language can serve an `@a2ui/embed` app by following it.

The contract version is `major.minor`. A minor version only adds optional fields; the app rejects a payload with a different major version and shows an error instead.

| Item                | Value                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract version    | `CONTRACT_VERSION`, currently `'1.0'`.                                                                                                                                                                                                                                                                                                                               |
| Tool result         | `content: [{type: 'text', text}]` holds a text summary for the model, never the A2UI. `structuredContent.a2ui` (`A2UI_STRUCTURED_KEY`) holds an `EmbedPayload`, which MCP Apps hosts keep out of the model context.                                                                                                                                                  |
| `EmbedPayload`      | `{contractVersion: string; messages: A2uiMessage[]; followUp?: {text: string}}`. `messages` are A2UI v1.0 server-to-client messages, applied in order. `followUp.text` is posted to the conversation by the app.                                                                                                                                                     |
| App resource        | Default URI `ui://a2ui/app.html` (`DEFAULT_RESOURCE_URI`), MIME type `text/html;profile=mcp-app`. Tools link to it through `_meta.ui.resourceUri`.                                                                                                                                                                                                                   |
| Action tool         | `a2ui_action` (`ACTION_TOOL_NAME`), visible to the app only (`_meta.ui.visibility: ['app']`). The app calls it for every A2UI action with an `ActionCall`: `{name: string; surfaceId: string; sourceComponentId?: string; context: Record<string, unknown>}`. It returns the same tool result shape, and an error result for an unknown action or invalid arguments. |
| Catalog schema file | `{contractVersion: string; catalogs: {[catalogId]: <catalog JSON schema>}}` (`CatalogSchemaFile`), written next to the app HTML as `*.catalog.json`. The server validates its components against it.                                                                                                                                                                 |

Helpers:

- `toToolResult({text, payload})` builds a tool result in the contract's shape.
- `readEmbedPayload(toolResult)` reads `structuredContent.a2ui` from a tool result. It checks the contract version and the payload shape, and returns an error result (`missing`, `unsupported-version` or `invalid`) instead of throwing.
- `checkContractVersion(version)` tells whether a contract version is compatible with this package.
- `EmbedPayloadSchema`, `ActionCallSchema` and `CatalogSchemaFileSchema` are the zod schemas of the contract types.

```ts
import {CONTRACT_VERSION, toToolResult} from '@a2ui/embed/contract';

return toToolResult({
  text: 'Revenue grew 12% in March.',
  payload: {contractVersion: CONTRACT_VERSION, messages},
});
```

## Server

`@a2ui/embed/mcp/server` serves an A2UI app from an MCP server built with the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). It runs in Node.js and needs `@modelcontextprotocol/sdk` as a peer dependency.

```ts
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {createA2uiApp} from '@a2ui/embed/mcp/server';
import {z} from 'zod';

const server = new McpServer({name: 'sales', version: '1.0.0'});
const app = createA2uiApp(server, {
  html: new URL('./dist/a2ui-app.html', import.meta.url),
  catalogSchema: new URL('./dist/a2ui-app.catalog.json', import.meta.url),
});

app.tool(
  'show_revenue',
  {description: 'Shows the revenue of a month.', inputSchema: {month: z.string()}},
  async ({month}) => {
    const revenue = await getRevenue(month);
    return {text: `Revenue in ${month} was ${revenue}.`, a2ui: revenueView(month, revenue)};
  },
);
```

`createA2uiApp` registers the app HTML as the `ui://a2ui/app.html` resource. Each tool registered with `app.tool` links to it, so the host renders the tool result in the app.

A tool handler returns a text summary for the model and, optionally, the A2UI messages for the app. The library puts the summary in `content` and the messages in `structuredContent.a2ui`, so the model never reads the A2UI. Without `a2ui`, the result is text only.

### Options

```ts
createA2uiApp(server, {
  html: 'dist/a2ui-app.html', // Path, URL, or {text}
  catalogSchema: 'dist/a2ui-app.catalog.json', // Path, URL, or the parsed file
  resourceUri: 'ui://sales/app.html', // Optional (default: 'ui://a2ui/app.html')
  resourceName: 'Sales', // Optional (default: 'A2UI app')
  csp: {resourceDomains: ['https://cdn.example.com']}, // Optional (default: no origins)
  prefersBorder: true, // Optional (default: the host decides)
});
```

- The HTML file is read again on every resource read, so a rebuilt app is served without restarting the server.
- The catalog schema file is read and compiled once. `createA2uiApp` throws if it is invalid or was written for another major contract version.
- Relative paths resolve against the working directory, which MCP hosts often set to something unexpected. Prefer a URL relative to `import.meta.url` or an absolute path.
- `csp` lists the origins the app may load resources from (`resourceDomains`) or connect to (`connectDomains`). The app built by `a2ui-embed build` inlines everything, so it needs none by default.

### Validation

Before a tool result is sent, its messages are validated:

- Each message must be an A2UI v1.0 server-to-client message.
- Each component must match the schema of its catalog: the `@catalogId` of the component, else the `catalogId` of its surface. Updates can target a surface created by an earlier tool call. When the app includes a single catalog, it is the default.
- Component IDs, function names and argument names must be UAX #31 identifiers, as the app's renderer requires: `issue_body` is valid, `issue-body` is not.
- A message must not define the same component ID twice, and a data model `path` must be a JSON Pointer such as `/user/name`.
- Each surface the messages create needs a `root` component once all of them apply, and its components can only reference components it defines, without cycles. Surfaces created by earlier calls aren't checked this way.
- Only `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface` messages reach the app.

An invalid result becomes an error result that lists the problems, and nothing reaches the app:

```text
Tool "show_revenue" returned invalid A2UI, so nothing was rendered:
- Component "kpi_value" (Text): property "variant" must be one of "caption", "body"
```

`app.validate(messages)` runs the same checks and returns `{ok, errors}`. Each error has a `message` and, when known, the `messageIndex`, `surfaceId`, `componentId`, `component` type and `property`. Use it to check A2UI that a model composed before returning it.

A handler that throws also becomes an error result, with the error message.

### Actions

Every A2UI event in the app calls the `a2ui_action` tool, which only the app can see. The server routes the event by name to an action or a follow-up registered on the app; any other name is rejected. The event's `context` is validated against the `argsSchema` of the action.

An action updates the app in place. Its handler receives the context and the event's source, and returns the messages to apply:

```ts
app.action('refresh', {argsSchema: {month: z.string()}}, async ({month}, {surfaceId}) => ({
  a2ui: revenueUpdate(surfaceId, await getRevenue(month)),
}));
```

A follow-up posts a message to the conversation on the user's behalf, as if the user had typed it:

```ts
app.followUp('breakdown', {
  template: 'Break down the revenue of {month} by {dimension}',
  argsSchema: {month: z.string(), dimension: z.string()},
  maxValueLength: 40, // Optional (default: 80)
});
```

The message text only comes from the template in your code. Each `{name}` placeholder is replaced with the context value, stringified, stripped of control characters, truncated to `maxValueLength` characters and quoted, so a value can never read as part of the template's own text: `Break down the revenue of "March" by "country"`. A missing value makes the action fail.

## App runtime

`@a2ui/embed/mcp` runs inside the app's iframe. `startEmbedApp` connects to the host with the [MCP Apps App SDK](https://github.com/modelcontextprotocol/ext-apps) and renders the A2UI payload of each tool result with the Lit renderer and the catalogs you pass.

```ts
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {startEmbedApp} from '@a2ui/embed/mcp';

startEmbedApp({
  catalogs: [basicCatalog],
  appInfo: {name: 'sales-app', version: '1.0.0'}, // Optional (default: {name: 'a2ui-embed', version: '1.0.0'})
  root: document.getElementById('app')!, // Optional (default: document.body)
  modelContext: {maxBytes: 8192}, // Optional (default: {maxBytes: 16384})
});
```

It returns a handle with the App SDK `app`, a `ready` promise that settles after the host handshake, and `close()`.

The app:

- Shows a loading state while the tool runs, then renders each surface of `structuredContent.a2ui`. A new tool result replaces the surfaces.
- Applies each batch of messages only if the whole batch is valid against the catalogs, so an invalid payload never renders partially. A payload that is invalid, or written for another contract major version, shows an error card instead. A text-only tool result, without `structuredContent.a2ui`, shows nothing, and the app reports a height of 0.
- Sends every A2UI action to the server's `a2ui_action` tool as an `ActionCall`, with at most four calls in flight. The messages in the result update the surfaces in place. A `followUp.text` is posted to the conversation as a user message when the host supports `ui/message`. A failed action shows a dismissible notice and keeps the surfaces.
- Reports its size to the host and follows the host theme: it applies the host's theme, style variables and fonts, and maps the standard MCP Apps variables onto the A2UI basic catalog theme.
- Shares the data model of each surface created with `sendDataModel: true` with the model, as described below.
- Runs under the default MCP Apps CSP (`default-src 'none'` with inline scripts and styles): it never evaluates code or makes network requests.

### Model context

When the user changes the data model of a surface created with `sendDataModel: true`, for example by typing in a text field, or triggers an action whose result changes it, the app sends the data model to the host with `ui/update-model-context`. The host adds it to the model's context with the user's next message, without starting a turn, so the model can answer questions about what the user entered.

- Only changes the user causes send an update: their own edits, and the data model changes of the result of an action they triggered, such as a status that turns to "applied" after they click Apply. The initial render and tool results never send one. An update waits until the changes stop for 300 ms.
- Each update replaces the previous one and holds one text block with the data model of every `sendDataModel` surface, as JSON: `A2UI surface "form" data model:` followed by `{"name":"Grace"}`.
- The JSON of one update is limited to `modelContext.maxBytes` (16 KiB by default). Above it, the largest data models are left out, largest first, and named with their size instead, so the model never reads partial JSON.
- A new tool result clears the shared context, and deleting a `sendDataModel` surface removes its data model from it.
- Nothing is sent when the host does not support `ui/update-model-context`.

### Theming

The app maps these host variables onto the A2UI theme. Each mapping falls back to the A2UI default when the host omits the variable.

| A2UI property                                                                                                 | Host variable                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `--a2ui-color-background`                                                                                     | `--color-background-primary`   |
| `--a2ui-color-on-background`, `--a2ui-color-on-surface`, `--a2ui-color-on-secondary`, `--a2ui-color-on-input` | `--color-text-primary`         |
| `--a2ui-color-surface`                                                                                        | `--color-background-secondary` |
| `--a2ui-color-secondary`                                                                                      | `--color-background-tertiary`  |
| `--a2ui-color-input`                                                                                          | `--color-background-primary`   |
| `--a2ui-color-primary`                                                                                        | `--color-ring-primary`         |
| `--a2ui-color-border`                                                                                         | `--color-border-primary`       |
| `--a2ui-text-caption-color`                                                                                   | `--color-text-secondary`       |
| `--a2ui-border-radius`                                                                                        | `--border-radius-md`           |
| `--a2ui-border-width`                                                                                         | `--border-width-regular`       |
| `--a2ui-font-family-monospace`                                                                                | `--font-mono`                  |

The document text uses `--font-sans` and `--color-text-primary`. The app's rules have no specificity, so any rule on `.a2ui-embed` overrides them, including these app-level properties:

| Property                          | Default                     |
| --------------------------------- | --------------------------- |
| `--a2ui-embed-max-width`          | `960px`                     |
| `--a2ui-embed-padding`            | `0`                         |
| `--a2ui-embed-error-color`        | `--color-text-danger`       |
| `--a2ui-embed-error-background`   | `--color-background-danger` |
| `--a2ui-embed-error-border-color` | `--color-border-danger`     |

## Building the app HTML

The `a2ui-embed build` command builds the app as one HTML file, with the renderer, your catalogs and their components inlined. The app loads nothing from the network, so it runs under the default MCP Apps content security policy, which only allows inline scripts and styles and `data:` or `blob:` media.

Describe the app in `a2ui-embed.config.ts` (or `.mts`, `.mjs`, `.js`) next to your `package.json`:

```ts
import {basicCatalog, defineConfig} from '@a2ui/embed/build';

import {salesCatalog} from './src/sales_catalog.js';

export default defineConfig({
  catalogs: [basicCatalog, salesCatalog],
  renderer: 'lit', // Optional (default: 'lit')
  output: 'dist/a2ui-app.html',
  title: 'Sales', // Optional (default: 'A2UI app')
});
```

Then run:

```sh
yarn a2ui-embed build
```

The command writes two files, at paths relative to the config file:

- `dist/a2ui-app.html`: the app. Serve it as the app resource of your MCP server.
- `dist/a2ui-app.catalog.json`: the catalog schema file, with the JSON schema of each catalog keyed by catalog ID. Your server validates the components it sends against it.

`catalogs` lists web_core `Catalog` objects for A2UI v1.x, with unique IDs. `basicCatalog` is the A2UI v1.0 basic catalog. Custom components can be Lit elements or plain Web Components.

The build evaluates the config file in Node to write the catalog schema file, and bundles the same config file into the app, so the schema and the app always come from the same catalogs. As a result, the config file and the catalog modules it imports must load both in Node and in the browser: keep browser-only code, such as `document` access, inside component methods that run on render, and Node-only code, such as `node:fs`, out of the config file.

The build fails if the app would load a script, stylesheet or other resource from the network, and warns when the app is larger than 5 MiB, since hosts may reject large resources. Use `--config <path>` to build from another config file. In code, `build({config?, cwd?})` from `@a2ui/embed/build` runs the same build and returns the paths and the size of the written files.

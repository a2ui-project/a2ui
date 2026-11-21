# @a2ui/embed

Embed A2UI in [MCP Apps](https://github.com/modelcontextprotocol/ext-apps): an MCP server returns A2UI v1.0 messages from its tools, and a single-file app renders them in any MCP Apps host, so the host needs no A2UI support.

This package is under development. It currently provides the contract between the server and the app, and the server API.

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

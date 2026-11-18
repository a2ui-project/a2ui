# @a2ui/embed

Embed A2UI in [MCP Apps](https://github.com/modelcontextprotocol/ext-apps): an MCP server returns A2UI v1.0 messages from its tools, and a single-file app renders them in any MCP Apps host, so the host needs no A2UI support.

This package is under development. It currently provides the contract between the server and the app.

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

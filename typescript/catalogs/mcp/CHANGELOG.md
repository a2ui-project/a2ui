## Unreleased

- Emit `'1.0'` as `version` on synthesized `createSurface` and `updateComponents` messages in `callMcpTool` when creating a standalone MCP App surface, matching the unified v1.0 protocol version wire format. [#3097](https://github.com/a2ui-project/a2ui/issues/3097)
- The published package contains only the runtime build output; test files and TypeScript build info are no longer included. [#3348](https://github.com/a2ui-project/a2ui/pull/3348)
- **BREAKING CHANGE**: Hosts set up the catalog once with `configureMcpCatalog`; `createCallMcpToolImplementation`, `CallMcpToolApi` and `A2UI_MIME_TYPE` are removed and `MCP_CATALOG_ID` now identifies the v1.0 catalog (`catalogs/mcp/v1/catalog.json`, bundled as `@a2ui/catalog-mcp/catalog.json`). `callMcpTool` now hands `ui://` MCP App resources to the host. [#3186](https://github.com/a2ui-project/a2ui/pull/3186)
- `callMcpTool` returns a payload with `toolName`, `toolInput`, `toolResult`, `structuredContent`, `text` and `json`, and writes it to `targetDataPath` when set, where the latest call to a path wins. [#3728](https://github.com/a2ui-project/a2ui/pull/3728)
- The `transformData` (standard JMESPath) and `updateDataModel` data functions shape the `callMcpTool` payload into data model updates; their `*Api` and `*Implementation` are exported for hosts that register functions one by one. [#3573](https://github.com/a2ui-project/a2ui/pull/3573), [#3736](https://github.com/a2ui-project/a2ui/pull/3736)
- Add `mcpCatalog`, the v1.0 MCP catalog with the `McpApp` universal component (`A2uiMcpApp`) and `callMcpTool`, ready to hand to a `MessageProcessor`. `McpApp` renders an MCP App in the shared sandbox, binds host data through `data.paths` and dispatches the tools it is allowed to call as A2UI actions. [#2799](https://github.com/a2ui-project/a2ui/pull/2799)

## 0.0.1-alpha.1

- `@a2ui/catalog-mcp` provides `callMcpTool`: it runs a tool on a connected MCP server, returns the raw result, and applies the A2UI messages found in the result and in the UI resources it references to the host's `MessageProcessor`. [#3171](https://github.com/a2ui-project/a2ui/pull/3171)

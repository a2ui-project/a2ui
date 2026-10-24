## Unreleased

- Add the `parseJson`, `jmespath`, `updateDataModel`, `split`, `regexCapture` and `regexReplace` data functions to `mcpCatalog` and `catalogs/mcp/v1/catalog.json`, so a v1.0 payload can read the JSON or plain text a headless tool returns and write it to the data model; their `*Api` and `*Implementation` are exported for hosts that register functions one by one. Patterns are JavaScript regular expressions checked with `isSafeRegex` before compilation. `callMcpTool` now validates its arguments with the v1.0 schemas, which accept `@path` and `@call` bindings. [#3573](https://github.com/a2ui-project/a2ui/pull/3573)
- The published package contains only the runtime build output; test files and TypeScript build info are no longer included. [#3348](https://github.com/a2ui-project/a2ui/pull/3348)
- **BREAKING CHANGE**: Hosts set up the catalog once with `configureMcpCatalog`; `createCallMcpToolImplementation`, `CallMcpToolApi` and `A2UI_MIME_TYPE` are removed and `MCP_CATALOG_ID` now identifies the v1.0 catalog (`catalogs/mcp/v1/catalog.json`, bundled as `@a2ui/catalog-mcp/catalog.json`). `callMcpTool` now hands `ui://` MCP App resources to the host. [#3186](https://github.com/a2ui-project/a2ui/pull/3186)
- Add `mcpCatalog`, the v1.0 MCP catalog with the `McpApp` universal component (`A2uiMcpApp`) and `callMcpTool`, ready to hand to a `MessageProcessor`. `McpApp` renders an MCP App in the shared sandbox, binds host data through `data.paths` and dispatches the tools it is allowed to call as A2UI actions. [#2799](https://github.com/a2ui-project/a2ui/pull/2799)

## 0.0.1-alpha.1

- `@a2ui/catalog-mcp` provides `callMcpTool`: it runs a tool on a connected MCP server, returns the raw result, and applies the A2UI messages found in the result and in the UI resources it references to the host's `MessageProcessor`. [#3171](https://github.com/a2ui-project/a2ui/pull/3171)

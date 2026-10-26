## Unreleased

- The published package contains only the runtime build output; test files and TypeScript build info are no longer included. [#3348](https://github.com/a2ui-project/a2ui/pull/3348)

## 0.0.1-alpha.1

- `@a2ui/catalog-mcp` provides `callMcpTool`: it runs a tool on a connected MCP server, returns the raw result, and applies the A2UI messages found in the result and in the UI resources it references to the host's `MessageProcessor`. [#3171](https://github.com/a2ui-project/a2ui/pull/3171)

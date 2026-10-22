## Unreleased

- The published package contains only the runtime build output; test files and TypeScript build info are no longer included. [#3348](https://github.com/a2ui-project/a2ui/pull/3348)
- `callMcpTool` accepts a function call or data binding as `arguments`, evaluated to the argument object before the call, in addition to an object of dynamic values. This is the form a payload needs to pass an argument literally named `path`, and payload validation now admits it.
- `@a2ui/catalog-mcp/testing` provides `createStubMcpClient`, an in-memory MCP server, and `stubMcp`, a plugin for `createSurfaceHarness` from `@a2ui/testing` that drives a payload against the stub and records its tool calls.

## 0.0.1-alpha.1

- `@a2ui/catalog-mcp` provides `callMcpTool`: it runs a tool on a connected MCP server, returns the raw result, and applies the A2UI messages found in the result and in the UI resources it references to the host's `MessageProcessor`. [#3171](https://github.com/a2ui-project/a2ui/pull/3171)

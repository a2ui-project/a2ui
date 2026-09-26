## Unreleased

- The bundled `catalog.json` now declares the `McpApp` component, which renders a sandboxed MCP App in a surface. Its `allowedFunctions` property is a map of function name to the JSON Schema of the function's arguments rather than a list of names; `allowedTools` stays a list of tool names. This package still implements the catalog functions only, so a renderer that shows MCP Apps must provide its own `McpApp` component. [#2795](https://github.com/a2ui-project/a2ui/pull/2795)

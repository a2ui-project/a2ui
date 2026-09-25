# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools and transform tool results into data model updates. It defines `callMcpTool` and five data functions, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly, and the `McpApp` component, which renders a sandboxed [MCP App](https://github.com/modelcontextprotocol/ext-apps) inside a surface.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json`.

`callMcpTool` takes two arguments, declared in [catalog.json](catalog.json):

| Parameter   | Type            | Required          | Description                   |
| :---------- | :-------------- | :---------------- | :---------------------------- |
| `name`      | `DynamicString` | Yes               | The MCP tool to execute.      |
| `arguments` | `object`        | No (default `{}`) | Arguments passed to the tool. |

Tools are addressed by name only. A2UI payloads never name a server, because multi-server routing is resolved by the host inside `getMcpClientForTool`.

The function returns the raw MCP `CallToolResult`. It throws an `A2uiExpressionError` if the client cannot be resolved, the call returns no result, or the result has `isError: true`.

Five data functions transform tool results and write them to the data model:

| Function          | Arguments                         | Returns                                                                             |
| :---------------- | :-------------------------------- | :---------------------------------------------------------------------------------- |
| `jmespath`        | `expression`, `data`              | The result of evaluating `expression` against `data`, or `null` for missing fields. |
| `split`           | `value`, `separator`              | Substrings split by `separator` (or characters if `separator` is empty).            |
| `regexCapture`    | `value`, `pattern`                | Capture groups from the first RE2 match, or `null` if no match is found.            |
| `regexReplace`    | `value`, `pattern`, `replacement` | `value` with all RE2 matches replaced by literal `replacement` text.                |
| `updateDataModel` | `updates`                         | Nothing. Writes each key-value pair in `updates` to the surface data model.         |

Every argument above is required. `split`, `regexCapture`, and `regexReplace` accept either a single string or an array of strings in `value`, applying the operation element by element when given an array.

To test whether a string matches a pattern, use the basic catalog's `regex` function.

For `updateDataModel`, keys starting with `/` are absolute paths, while relative keys resolve against the calling data context (such as the current row scope inside a template list).

## McpApp component

`McpApp` renders an MCP App in a double-iframe sandbox and connects it to the surface through the MCP Apps JSON-RPC bridge. Its properties are declared in [catalog.json](catalog.json):

| Property           | Type                     | Required | Description                                                                                                                                   |
| :----------------- | :----------------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlContent`      | `DynamicString`          | Yes      | The HTML of the app, rendered through `srcdoc`. A value prefixed with `url_encoded:` is decoded first.                                        |
| `title`            | `DynamicString`          | No       | The accessible title of the frame.                                                                                                            |
| `allowedTools`     | `array` of `string`      | No       | The MCP tools the app may call. The host dispatches an authorized `tools/call` request as an A2UI action named after the tool.                |
| `allowedFunctions` | `object` of JSON Schemas | No       | The catalog functions the app may call through `ui/requests/function-call`, each mapped to the schema of its arguments.                       |
| `data.paths`       | `object` of `string`     | No       | A map of state keys to JSON Pointer paths in the data model. The host pushes changes to the app and writes the app's data model changes back. |

Tool calls and function calls that are not listed are rejected with a JSON-RPC error. The bridge protocol, the sandbox layout and the security controls are defined in the [MCP App component specification](mcp_app_specification.md).

The [examples](examples/) directory holds A2UI message sequences that validate against this catalog combined with the basic catalog:

- [00_inline-tool-call.json](examples/00_inline-tool-call.json) renders an inline feedback form whose `submit_feedback` tool call is declared in `allowedTools`.
- [01_data-binding.json](examples/01_data-binding.json) binds the app to the `/player` data path so it stays in sync with sibling basic components.

## Implementations

| Language   | Package                                               |
| :--------- | :---------------------------------------------------- |
| TypeScript | [`@a2ui/catalog-mcp`](../../typescript/catalogs/mcp/) |

The [Iframe and MCP catalogs guide](../../docs/public/guides/iframe-and-mcp-catalogs.md) covers installing the package, serving the sandbox proxy `McpApp` loads and registering the catalog with a web renderer.

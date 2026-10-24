# A2UI MCP catalog

The A2UI MCP catalog lets A2UI surfaces invoke [Model Context Protocol](https://modelcontextprotocol.io/) tools and transform tool results into data model updates. It defines `callMcpTool` and five data functions, allowing agents to emit declarative payloads whose controls and bindings interact with MCP servers directly. Its v1 catalog adds the `McpApp` component, which renders a sandboxed [MCP App](https://github.com/modelcontextprotocol/ext-apps) inside a surface.

## Catalog specification (protocol v0.9)

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

## v1 catalog (protocol v1.0)

The v1 catalog, [v1/catalog.json](v1/catalog.json), targets A2UI protocol v1.0. Its catalog ID is `https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`. It declares `callMcpTool` and the data functions below, with argument and return types taken from the v1.0 `common_types.json`, and the `McpApp` component.

### Data functions

Most MCP tools return plain `content` blocks rather than A2UI resources, so a surface needs to read the text of a `CallToolResult`, decode it, pick the fields it wants and write them to the data model. The v1 catalog declares these functions for that:

| Function          | Arguments                         | Returns                                                                                          |
| :---------------- | :-------------------------------- | :----------------------------------------------------------------------------------------------- |
| `parseJson`       | `value`                           | The value encoded by the JSON string `value`.                                                    |
| `jmespath`        | `expression`, `data`              | The result of evaluating the JMESPath `expression` against `data`, or `null` for missing fields. |
| `updateDataModel` | `updates`                         | Nothing. Writes each key-value pair in `updates` to the surface data model.                      |
| `split`           | `value`, `separator`              | Substrings of `value` split by the literal `separator` (or characters if `separator` is empty).  |
| `regexCapture`    | `value`, `pattern`                | Capture groups from the first match of `pattern`, or `null` if there is no match.                |
| `regexReplace`    | `value`, `pattern`, `replacement` | `value` with every match of `pattern` replaced by the literal `replacement` text.                |

Every argument is required. `value` of `parseJson`, `expression`, `separator`, `pattern` and `replacement` are `DynamicString`; `data`, `updates` and the `value` of the three text functions are `DynamicValue`, so each can be a literal, a `@path` binding or a nested `@call`. `split`, `regexCapture` and `regexReplace` accept either a single string or an array of strings in `value`, applying the operation element by element when given an array, and read `null` as the empty string. For `updateDataModel`, keys starting with `/` are absolute paths, while relative keys resolve against the calling data context (such as the current row scope inside a template list).

Patterns are JavaScript regular expressions, compiled without flags (`regexReplace` adds `g`) after a check for catastrophic backtracking; a pattern that fails the check, or is not valid JavaScript syntax, raises an `A2uiExpressionError`. Lookarounds and backreferences are accepted when the check passes. RE2 syntax does not carry over: the `(?i)` inline flag is rejected, and `\pL` or `[[:alpha:]]` compile as JavaScript reads them (a literal `p` followed by `L`, a character class followed by a literal `]`) rather than as Unicode or POSIX classes. To test whether a string matches a pattern, use the basic catalog's `regex` function.

A surface is usually created on the basic catalog, so each call selects the MCP catalog with its own `catalogId`. The button of [mcp-json-tool-result.json](v1/examples/mcp-json-tool-result.json) chains the functions this way:

```json
{
  "@call": "updateDataModel",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "updates": {
      "@call": "jmespath",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
      "args": {
        "expression": "{\"/issues\": [?state == 'open'].{number: to_string(number), title: title}}",
        "data": {
          "@call": "parseJson",
          "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
          "args": {
            "value": {
              "@call": "jmespath",
              "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
              "args": {
                "expression": "content[0].text",
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
      }
    }
  }
}
```

The inner `jmespath` reads the text block out of the `CallToolResult`, `parseJson` decodes it, the outer `jmespath` builds the `{path: value}` object, and `updateDataModel` writes it. A tool that returns lines of text instead of JSON goes through `split` and `regexCapture` in place of `parseJson`, as [mcp-text-tool-result.json](v1/examples/mcp-text-tool-result.json) does with a directory listing: `split` on `"\n"`, `regexCapture` with `^\[(DIR|FILE)\] (.+)$`, then `jmespath` with `{"/entries": [?@ != null].{kind: [0], name: [1]}}` to drop the lines that did not match. The functions do not evaluate `@path` or `@call` objects found inside tool output: a tool result is data, not an expression.

### McpApp component

`McpApp` renders an MCP App in a double-iframe sandbox and connects it to the surface through the MCP Apps JSON-RPC bridge. Its properties are declared in [v1/catalog.json](v1/catalog.json):

| Property           | Type                     | Required | Description                                                                                                                                                                                          |
| :----------------- | :----------------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlContent`      | `DynamicString`          | Yes      | The HTML of the app, rendered through `srcdoc`. A value prefixed with `url_encoded:` is decoded first.                                                                                               |
| `title`            | `DynamicString`          | No       | The accessible title of the frame.                                                                                                                                                                   |
| `allowedTools`     | `array` of `string`      | No       | The MCP tools the app may call. The host dispatches an authorized `tools/call` request as an A2UI action named after the tool (and executes a configured `callTool` callback when provided).         |
| `allowedFunctions` | `object` of JSON Schemas | No       | The catalog functions the app may call through `ui/requests/function-call`, each mapped to the schema of its arguments.                                                                              |
| `data.paths`       | `object` of `string`     | No       | A map of state keys (or reserved keys `toolInput`, `toolResult`, `modelContext`) to JSON Pointer paths in the data model. The host pushes changes to the app and writes the app's data changes back. |
| `csp`              | `object`                 | No       | Per-resource Content Security Policy domain allowlists (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) from `_meta.ui.csp`.                                                  |
| `permissions`      | `object`                 | No       | Browser capability permissions (`camera`, `microphone`, `geolocation`, `clipboardWrite`) delegated to the inner sandboxed iframe from `_meta.ui.permissions`.                                        |

Tool calls and function calls that are not listed are rejected with a JSON-RPC error. The bridge protocol, the sandbox layout and the security controls are defined in the [MCP App component specification](v1/mcp_app_specification.md).

The [v1/examples](v1/examples/) directory holds A2UI message sequences that validate against the v1 catalog combined with the v1 basic catalog:

- [mcp-app-3d-geometry.json](v1/examples/mcp-app-3d-geometry.json) renders a 3D Holographic Geometry Studio `McpApp`: a 60fps canvas renderer that A2UI components alone cannot express. It showcases two-way `data.paths` binding (the sibling `TextField` preset and the app's camera telemetry), `ui/update-model-context` publishing the camera pose and preset to `/scene3d/modelContext`, `tools/call` (`capture_3d_snapshot`), and `ui/notifications/host-context-changed` (`containerDimensions`) driving a responsive canvas; `tests/examples/mcp_app_3d_geometry.test.ts` of the TypeScript package runs it end to end.
- [mcp-json-tool-result.json](v1/examples/mcp-json-tool-result.json) loads the open issues of a repository from a headless `list_issues` tool: a button chains `callMcpTool`, `jmespath`, `parseJson` and `updateDataModel` to fill a template list from the JSON in the tool's text block; `src/catalog.test.ts` of the TypeScript package runs the button action against a mock client.
- [mcp-text-tool-result.json](v1/examples/mcp-text-tool-result.json) lists a directory through a headless `list_directory` tool that answers in plain text: a button chains `callMcpTool`, `jmespath`, `split`, `regexCapture` and `updateDataModel` to turn `[DIR] name` and `[FILE] name` lines into rows, and the heading binds `regexReplace` to the directory path; `src/catalog.test.ts` runs both against a mock client.

## Implementations

| Language   | Package                                               |
| :--------- | :---------------------------------------------------- |
| TypeScript | [`@a2ui/catalog-mcp`](../../typescript/catalogs/mcp/) |

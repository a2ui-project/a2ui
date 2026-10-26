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

### Tool data payload

In the v1 catalog, `callMcpTool` returns a payload with `toolName`, `toolInput`, `toolResult` (the raw `CallToolResult`), `structuredContent` (when the server sends one), `text` (the `text` blocks joined with `\n`) and `json` (the parsed value of `text` when it is a JSON object or array; when instead several text blocks are each a JSON object or array, the array of their parsed values; absent otherwise). When the result has an MCP App resource, the payload also carries its `resourceUri`, `html`, `csp` and `permissions`.

The optional `targetDataPath` argument writes the payload of each successful call to that path, replacing the object there. A call whose response arrives after a newer call to the same path has started does not write, so the latest call wins. A result flagged `isError` fails the call and writes nothing.

### Data functions

Most MCP tools return plain `content` blocks rather than A2UI resources, so a surface needs to pick the fields it wants out of the payload and write them to the data model. The v1 catalog declares these functions for that:

| Function          | Arguments            | Returns                                                                                                                                   |
| :---------------- | :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `transformData`   | `jmespath`, `data`   | The result of evaluating the [JMESPath](https://jmespath.org/specification.html) expression against `data`, or `null` for missing fields. |
| `updateDataModel` | `updates`            | Nothing. Writes each key-value pair in `updates` to the surface data model.                                                               |
| `split`           | `value`, `separator` | Substrings of `value` split by the literal `separator`, or its characters if `separator` is empty.                                        |
| `regexCapture`    | `value`, `pattern`   | The capture groups of the first match of `pattern`, or `null` if there is no match.                                                       |

Every argument is required, and a `null` or missing argument is rejected. `transformData` implements standard JMESPath, with no extensions. `jmespath`, `separator` and `pattern` are `DynamicString`; `data`, `updates` and `value` are `DynamicValue`, so each can be a literal, a `@path` binding or a nested `@call`. `split` and `regexCapture` accept a single string or an array of strings in `value`, applying the operation to each element of an array. For `updateDataModel`, keys starting with `/` are absolute paths, while relative keys resolve against the calling data context (such as the current row scope inside a template list).

`regexCapture` patterns use a portable subset that every renderer can implement: JavaScript regular expression syntax without lookahead or lookbehind assertions and without backreferences. Implementations also reject patterns that allow catastrophic backtracking. To test whether a string matches a pattern, use the basic catalog's `regex` function.

The set of data functions is closed, because each one has to be specified, tested and implemented in every renderer. The four cover the JSON and text output of most MCP servers: `split` and `regexCapture` exist because many servers return list data only as text, mostly as records of `Key: value` lines. These functions are mainly for general-purpose hosts (such as chat apps or playgrounds) where users configure which MCP servers to connect, so the host does not need custom parsing code for each tool. A host that needs another parser, or that only connects to a few servers it controls, can define its own function in a custom catalog and call it with that `catalogId`. The [TypeScript package README](../../typescript/catalogs/mcp/README.md#data-functions) explains the choice of each function and shows how to add one.

A surface is usually created on the basic catalog, so each call selects the MCP catalog with its own `catalogId`. The first button of [mcp-json-tool-result.json](v1/examples/mcp-json-tool-result.json) chains the functions this way:

```json
{
  "@call": "updateDataModel",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
  "args": {
    "updates": {
      "@call": "transformData",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json",
      "args": {
        "jmespath": "{\"/issues\": json[?state == 'open'].{number: to_string(number), title: title}}",
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
```

`transformData` reads the parsed `json` of the payload and builds the `{path: value}` object, and `updateDataModel` writes it. The second button only sets `targetDataPath: "/issueResponse"`, and its list binds to `/issueResponse/structuredContent/issues`. A tool that answers in plain text goes through `split` and `regexCapture`, as [mcp-text-tool-result.json](v1/examples/mcp-text-tool-result.json) does with search results: `transformData` reads `text`, `split` cuts it on `"\n\n"` into records, `regexCapture` with `^Title: (.*)\nURL: (.*)` reads each record, and `transformData` with `{"/results": [?@ != null].{title: [0], url: [1]}}` drops the records that did not match and names the fields. The functions do not evaluate `@path` or `@call` objects found inside tool output: a tool result is data, not an expression.

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
- [mcp-json-tool-result.json](v1/examples/mcp-json-tool-result.json) loads the open issues of a repository from a headless `list_issues` tool: one button chains `callMcpTool`, `transformData` and `updateDataModel` to fill a template list from the `json` of the payload, and a second button writes the payload to `targetDataPath` and binds a list to its `structuredContent`; `src/catalog.test.ts` of the TypeScript package runs both actions against a mock client.
- [mcp-text-tool-result.json](v1/examples/mcp-text-tool-result.json) searches the web through a headless `tavily-search` tool that answers in plain text: a button chains `callMcpTool`, `transformData`, `split`, `regexCapture` and `updateDataModel` to turn `Title:` and `URL:` records into rows; `src/catalog.test.ts` runs it against a mock client.

## Implementations

| Language   | Package                                               |
| :--------- | :---------------------------------------------------- |
| TypeScript | [`@a2ui/catalog-mcp`](../../typescript/catalogs/mcp/) |

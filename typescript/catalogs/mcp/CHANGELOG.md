## Unreleased

- Remove the five data transformation functions (`jmespath`, `split`, `regexCapture`, `regexReplace`, `updateDataModel`) from the package and from the v1 catalog schema; they now live with the [filesystem sample](../../../samples/community/mcp/a2ui-over-mcp-filesystem/client/functions/). `createMcpCatalogFunctions` returns `callMcpTool` only. [#3171](https://github.com/a2ui-project/a2ui/pull/3171)

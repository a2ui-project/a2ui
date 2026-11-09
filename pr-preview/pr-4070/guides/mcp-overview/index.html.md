# MCP Integration Overview

> Choose the right pattern for connecting A2UI surfaces and Model Context Protocol (MCP) servers and apps.

Canonical URL: https://a2ui.org/guides/mcp-overview/

A2UI and the **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)** integrate in four ways depending on whether your application or an external MCP client owns the outer host, and whether the MCP server returns structured JSON data, reusable A2UI layout templates, or sandboxed HTML apps.

## Choose an MCP integration pattern

Use the table below to pick the guide that matches your host environment and MCP server output:

| Your goal                                                       | Outer host             | MCP server output                               | Guide                                                      |
| :-------------------------------------------------------------- | :--------------------- | :---------------------------------------------- | :--------------------------------------------------------- |
| Invoke headless MCP tools from A2UI inputs and buttons          | Your A2UI web app      | JSON or plain-text tool results                 | [Call MCP Tools from A2UI](../mcp-catalog/)                |
| Return reusable A2UI layouts and per-call data from tools       | Your A2UI web app      | `a2ui://` templates (`application/a2ui+json`)   | [Serve A2UI Layouts from an MCP Server](../a2ui-over-mcp/) |
| Embed third-party interactive HTML widgets on an A2UI surface   | Your A2UI web app      | `ui://` HTML apps (`text/html;profile=mcp-app`) | [Embed MCP Apps in A2UI Surfaces](../mcp-apps-in-a2ui/)    |
| Display A2UI surfaces inside Claude Desktop, Cursor, or VS Code | External MCP Apps host | `ui://` HTML bundle containing an A2UI renderer | [Render A2UI Inside an MCP App](../a2ui-in-mcp-apps/)      |

## How the patterns fit together

1. When you own the web application, `@a2ui/catalog-mcp` connects your Lit, React, or Angular renderer directly to MCP `Client` sessions. Surfaces can call tools with `callMcpTool` and write returned JSON into the surface [Data Model](../../concepts/data-binding/) ([Call MCP Tools from A2UI](../mcp-catalog/)), or mount third-party `ui://` HTML widgets inside a double-iframe sandbox with `McpApp` ([Embed MCP Apps in A2UI Surfaces](../mcp-apps-in-a2ui/)).
2. When an MCP server emits A2UI messages (`application/a2ui+json`), it can publish declarative component layouts as `a2ui://` resources and return compact `updateDataModel` updates from `tools/call` ([Serve A2UI Layouts from an MCP Server](../a2ui-over-mcp/)). If the outer client supports MCP Apps (`ui://` HTML iframes) rather than A2UI natively, your server can package an A2UI web renderer inside the `ui://` HTML bundle itself ([Render A2UI Inside an MCP App](../a2ui-in-mcp-apps/)).

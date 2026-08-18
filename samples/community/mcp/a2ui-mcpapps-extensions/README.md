# A2UI over MCP Apps Dual-Mode Sample

This sample demonstrates end-to-end integration of **A2UI v1.0 over Model Context Protocol (MCP) Apps**, supporting dynamic capability negotiation between:

1. **Native A2UI Mode (Preferred)**: When the client advertises `application/a2ui+json` under `io.modelcontextprotocol/ui.mimeTypes`, the server returns direct A2UI specifications wrapped in an `EmbeddedResource`. The client renders `<a2ui-surface>` directly in the host DOM with zero iframe overhead, and user interactions dispatch directly as MCP tool calls via the `@a2ui/web_core/v1_0` Action Dispatcher.
2. **Iframe Sandboxed Mode (Fallback)**: When the client only supports `text/html;profile=mcp-app`, the server returns a self-contained HTML application bundle. The client renders the app inside an isolated double-iframe sandbox managed by `McpSandboxHost`.

---

## Directory Structure

- **`server/`**: Python MCP Server built with `mcp` and `a2ui.mcp`.
- **`client/`**: Web application built with `@a2ui/lit` and `@a2ui/web_core/v1_0`.

---

## Running the Sample

### 1. Start the Server

```bash
cd server
uv run server.py --transport sse --port 8000
```

### 2. Start the Client

```bash
cd client
yarn install
yarn dev
```

Open your browser to `http://localhost:5173`. Use the mode switcher at the top to toggle between **Native A2UI Mode** and **Iframe Sandboxed Mode**, then click **Connect** to interact with the live counter!

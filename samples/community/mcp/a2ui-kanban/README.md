# Kanban board MCP App showcase

This sample pairs an MCP server that serves a drag-and-drop Kanban board as an MCP Application Resource (`ui://kanban/board`) with a Python A2A agent and a Lit chat host built on `@a2ui/catalog-mcp`.

The three services run as separate processes:

- `mcp-server/` (`http://localhost:8788/mcp`) holds the in-memory board, exposes the `list_board`, `move_task`, `create_task`, `assign_task`, and `open_board` tools over Streamable HTTP, and serves the bundled board app (`text/html;profile=mcp-app`).
- `agent/` (`http://localhost:10007`) is a Python ADK and A2A agent that connects to the MCP server as an MCP client and streams A2UI v1.0 messages (`createSurface`, `updateComponents`, `updateDataModel`) to the chat host. Setting `KANBAN_AGENT=scripted` runs a deterministic intent matcher for the walkthrough without an API key.
- `client/` (`http://localhost:5173`) is a Lit chat host that registers `basicCatalog` and `mcpCatalog`, connects `callMcpTool` to the MCP server, evaluates declarative `@a2ui/catalog-mcp` function bindings (`callMcpTool`, `transformData`, `updateDataModel`) on the surface, and forwards `a2ui.mcpAppMessage` actions and the surface data model to the agent.

## Running the sample

First, build the monorepo packages that `@a2ui/catalog-mcp` depends on from the repository root, then install the community workspace dependencies:

```bash
yarn install
yarn workspace @a2ui/catalog-mcp run build
yarn workspace @a2ui/lit run build

cd samples/community
yarn install
```

### Terminal 1: Start the MCP server

Build the TypeScript server and the single-file board app bundle, then start the Streamable HTTP server on port 8788:

```bash
cd samples/community/mcp/a2ui-kanban/mcp-server
yarn build
yarn start
```

### Terminal 2: Start the agent

Run the Python A2A agent on port 10007 with a Gemini API key, or pass `KANBAN_AGENT=scripted` to run without a model:

```bash
cd samples/community/mcp/a2ui-kanban/agent
export GEMINI_API_KEY="your-api-key"   # or use KANBAN_AGENT=scripted
uv run .
```

### Terminal 3: Start the chat host

Copy the sandbox proxy assets and start the Vite development server on port 5173:

```bash
cd samples/community/mcp/a2ui-kanban/client
yarn dev
```

Open `http://localhost:5173` in a browser. You can override the backend URLs with `?mcp_url=http://localhost:8788/mcp&agent_url=http://localhost:10007`.

## Communication channels

The sample exercises four paths between the agent, the embedded MCP App, and the surrounding A2UI surface:

1. Agent to MCP App control (`updateDataModel` to `ui/notifications/data-model-update`). When the agent calls `move_task` or `create_task` on the MCP server, it emits an `updateDataModel` message writing the returned board to `/kanban/board`. Because the `McpApp` binds `data.paths.board` to `/kanban/board`, the host sends `ui/notifications/data-model-update` to the iframe and the board re-renders in place.
2. Agent reading MCP App state (`ui/update-model-context` to the turn data model). Selecting a card or changing the assignee filter inside the board app calls `app.updateModelContext` with the selection, active filter, and column counts. `McpApp` writes those values to `/kanban/modelContext` and `/kanban/selection`, and the chat host attaches the surface data model to the next user turn so the agent can answer questions about the current view.
3. MCP App to sibling A2UI components (`ui/notifications/data-model-change`). Dragging a card across columns sends `ui/notifications/data-model-change` for `board`. The host updates `/kanban/board` locally, which immediately re-evaluates the sibling `Text` badges (`Todo`, `Review` WIP status, `Done`, and `selection_text`) bound via declarative `@call: transformData` expressions before any agent turn runs.
4. MCP App to agent (`tools/call` and `ui/message` to `a2ui.mcpAppMessage`). On a card drop, the board app persists the move on the MCP server through `app.callServerTool` (`move_task` in `allowedTools`) and sends a `ui/message` notification with the move metadata. Clicking "Ask agent to split" on a card also sends a `ui/message` request. `McpApp` dispatches each message as an `a2ui.mcpAppMessage` action that the chat host forwards to the agent as a new turn.
5. Direct A2UI-to-MCP function pipeline (`callMcpTool`, `transformData`, `updateDataModel`). The Quick-Add Task Bar has title and assignee fields. Its button calls `callMcpTool("create_task")` with them, `transformData` maps `structuredContent` and `toolResult` from the returned payload to `/kanban/board` and `/kanban/toolResult`, and `updateDataModel` writes both. This runs in the browser, so the `McpApp` iframe and the sibling badges update without an agent round-trip.

## Try it

1. Click "Show me the sprint board". The agent calls `open_board`, reads `ui://kanban/board`, and creates the `kanban` surface with the declarative `transformData` summary badges, the Quick-Add Task Bar, and the `McpApp`.
2. In the Quick-Add Task Bar, edit or keep the title `Document MCP catalog` and the assignee `Ana`, then click "Add task". The browser chains `callMcpTool("create_task")`, `transformData`, and `updateDataModel`, so the new card appears in Todo and `Todo: 3` updates with zero agent turns.
3. Drag "Fix login" into Review. The sibling WIP counter updates immediately to `Review 4/3 (over limit)` via its `transformData` binding, the move is saved on the MCP server, and the agent replies offering to move a card back.
4. Click "Move Write docs back to Todo" (or reply to the agent). The agent calls `move_task` on the MCP server and pushes `/kanban/board` via `updateDataModel`; the board animates the card back to Todo and the WIP badge returns to `Review 3/3`.
5. Click "Migrate DB" on the board to select it, then click "Who owns the selected card and when is it due?". The agent reads `/kanban/modelContext` from the turn payload and reports the owner and due date.
6. Click "Ask agent to split" on "Migrate DB", then reply `yes` when the agent proposes three subtasks. The agent calls `create_task` for each subtask and updates `/kanban/board` so the new cards appear in Todo.
7. Click "Switch to the tabs layout", "Use the split inspector layout", or "Wrap the board in cards layout" (or ask the Gemini agent for any custom layout). The agent sends an `updateComponents` message that restructures the surface with Basic Catalog components (`Tabs`, `Card`, `Divider`, `Row`, `Column`, `Text`) while rendering the `McpApp` and Quick-Add Task Bar inside them.
8. Inspect the collapsible Protocol Debug Inspector pane on the right. It includes a "How this surface works (@a2ui/catalog-mcp)" guide explaining every component and function on the surface, shows the live `/kanban` data model (with who last wrote each key: the agent, the app, or the host), and displays one panel per hop the browser can observe, each with both directions: A2UI between the agent and the renderer, MCP Apps between the host and the iframe, MCP between the host and the server, and the raw A2A `message/send` envelopes to and from the agent (collapsed by default).

## Running the tests

```bash
cd samples/community/mcp/a2ui-kanban/mcp-server && yarn test
cd samples/community/mcp/a2ui-kanban/client && yarn test
cd samples/community/mcp/a2ui-kanban/client && yarn test:e2e
cd samples/community/mcp/a2ui-kanban/agent && uv run pytest
```

The Playwright suite in `client/e2e/` starts the MCP server, the scripted agent (no model) and the chat host unless they are already running, and drives the four communication channels above end to end. The `kanban-e2e` job of `.github/workflows/community_code.yml` runs it on every pull request that touches the sample or the catalog packages it depends on.

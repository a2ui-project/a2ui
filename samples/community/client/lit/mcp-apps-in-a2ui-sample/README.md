# MCP Apps in A2UI Sample

This sample demonstrates how a sandboxed MCP (Model Context Protocol) application running in an iframe can communicate with the A2UI Agent. It showcases a 2-way communication flow where the UI in the iframe can trigger actions that are handled by the backend agent.

## How It Works

1. **Initial Load**: The A2UI Client loads the sample and sends a "Load MCP App" request to the Agent.
2. **UI Delivery**: The Agent responds with a surface containing a custom component `McpApp`. This component includes the raw HTML content for the app in the `htmlContent` property.
3. **Sandbox Isolation**: The client renders an iframe with strict sandbox attributes (`allow-scripts allow-forms allow-popups allow-modals allow-same-origin`) to isolate the app.
4. **Handshake**: The client component (`mcp-apps-component.ts`) and the iframe content establish a postMessage bridge. The iframe sends a `ui/initialize` message to acknowledge it is ready.
5. **Action Trigger**: When you click the "Call Agent Tool" button in the iframe, it sends a `tools/call` message to the parent window (the A2UI client).
6. **Action Forwarding**: The A2UI client intercepts this message, verifies that the tool name is in `allowedTools`, and dispatches an `a2ui.action` event.
7. **Agent Execution**: The framework forwards this action to the Agent via the A2A protocol.
8. **UI Update**: The Agent processes the action (in this case, it just reads the arguments `{"foo": "bar"}`) and returns a `surfaceUpdate` that replaces the app with a success message: "Agent processed action: ...".

## Rationale for Implementation Pattern

This sample follows the pattern established in the `custom-components-example` (specifically the floor plan map):

- It uses **raw postMessage** communication in the iframe instead of loading external scripts like `AppBridge` from `unpkg.com`. This makes it robust against network issues and CSP restrictions in the sandbox.
- It relies on the A2UI host to act as the orchestrator, translating MCP tool calls into A2UI actions.

## How to Run

### 1. Run the Agent

Navigate to the agent sample directory and run the agent:

```bash
cd samples/agent/adk/mcp-apps-in-a2ui-sample
uv run agent.py
```

The agent will start on `http://localhost:8000`.

### 2. Run the Client

Navigate to the client sample directory and start the dev server:

```bash
cd samples/client/lit/mcp-apps-in-a2ui-sample
yarn dev
```

The client will start (typically on `http://localhost:5173/`). Open this URL in your browser to interact with the sample.

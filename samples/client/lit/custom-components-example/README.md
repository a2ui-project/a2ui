# A2UI Generator

This is a UI to generate and visualize A2UI responses.

## Prerequisites

1. [nodejs](https://nodejs.org/en)

## Running

This sample depends on the Lit renderer. Before running this sample, you need to build the renderer.

1. **Install and build dependencies:**
   From the repository root, install dependencies and build all packages:

   ```bash
   yarn install
   yarn build:all
   ```

2. **Run this sample:**

   ```bash
   cd samples/client/lit/custom-components-example
   ```

3. **Run the servers:**
   - Run the [A2A server](../../../agent/adk/custom-components-example/)
     - By default, the server uses the `McpAppsCustomComponent` which wraps MCP Apps in a secure, isolated double-iframe sandbox (`sandbox.html`) communicating strictly via JSON-RPC.
     - Optionally run the server using `USE_MCP_SANDBOX=false uv run .` to bypass this security and use the standard `WebFrame` element.
     - **Observing the difference**: Search for "Alex Jordan" in the UI and click the Location button to open the floor plan. If you inspect the DOM using your browser's Developer Tools, you will see that `McpAppsCustomComponent` securely points the iframe `src` to the local proxy (`/sandbox.html`). In contrast, `WebFrame` directly injects the untrusted HTML via a data blob/srcdoc, lacking defense-in-depth origin isolation.
   - Run the dev server: `yarn dev`

After starting the dev server, you can open http://localhost:5173/ to view the sample.

## Available Custom Components

This sample showcases several custom components that go beyond standard A2UI rendering:

- **MCP Apps (`mcp-apps-component.ts`)**: Sandboxed UI widgets using the MCP protocol, communicating securely via a JSON-RPC channel.
- **Secure iFrame Web Frame (`web-frame.ts`)**: Powerful component that allows rendering raw HTML in an isolated context (used for the Office Floor Plan).
- **Org Chart (`org-chart.ts`)**: A custom tree structure visualization component.

## Mix and Match A2UI Surfaces

This sample demonstrates how standard A2UI surfaces (such as contact profile cards using standard `Card` and list items) can live on the same canvas as custom extensions.
The A2UI renderer library seamlessly manages the standard component catalog, while custom components (like the Org Chart or iframe-based floor plans) hook into the same event lifecycle. You can swap between standard profile views and rich custom widgets using a unified routing layer.

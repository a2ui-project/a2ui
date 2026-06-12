# A2UI Custom Components & Client Architecture Guide

This guide explains how the **Contact Client** works in tandem with the **Contact Multiple Surfaces Agent** to define and render rich, custom user interfaces.

## Client-First Extension Model

This sample demonstrates a powerful pattern where the **Client** controls the capabilities of the agent:

1.  **Component Definition**: This client defines custom components (`OrgChart`, `WebFrame`) in `ui/custom-components/`.
2.  **Schema Generation**: Each custom component has an associated JSON schema.
3.  **Handshake**: When connecting to the agent, the client sends these schemas in the `metadata.inlineCatalog` field of the initial request.
4.  **Dynamic Support**: This allows _any_ A2UI agent (that supports inline catalogs) to immediately start using these components without prior knowledge.

## Custom Components Implemented

### 1. `OrgChart`

_Located in: `ui/custom-components/org-chart.ts`_
A visual tree illustrating the organizational hierarchy.

- **Implementation**: A standard LitElement component.
- **Interaction**: Emits `chart_node_click` events when nodes are clicked, which are sent back to the agent as A2UI Actions.

### 2. `WebFrame` (Interactive Iframe)

_Located in: `ui/custom-components/web-frame.ts`_
A tailored iframe wrapper for embedding external content or static HTML tools.

- **Use Case**: Used here to render the "Office Floor Plan" map.
- **Security**: Uses `sandbox` attributes to restrict script execution while allowing necessary interactions.
- **Bridge**: Includes a `postMessage` bridge to allow the embedded content (the map) to trigger A2UI actions in the main application.

## Multiple Surfaces

The client is designed to render multiple A2UI "Surfaces" simultaneously. Instead of a single chat stream, the `contact.ts` shell manages:

- **Main Profile (`contact-card`)**: The primary view.
- **Side Panel (`org-chart-view`)**: A persistent side view for context.
- **Overlay (`location-surface`)**: A temporary surface for specific tasks like map viewing.

## How to Run in Tandem

To see this full experience, you must run this client with the specific `contact_multiple_surfaces` agent.

### 1. Start the Agent

The agent serves the backend logic and the static assets (like the floor plan HTML).

```bash
cd ../../../agent/adk/contact_multiple_surfaces
uv run .
```

_Runs on port 10004._

### 2. Start this Client

The client connects to the agent and renders the UI.

```bash
# In this directory (samples/client/lit/custom-components-example)
yarn install
yarn dev
```

_The client acts as a shell, connecting to localhost:10004 by default._

## Configuration

The connection to the agent is configured in `middleware/a2a.ts`. If you need to change the agent port, update the URL in that file:

```typescript
const agentUrl = 'http://localhost:10004';
```

# A2UI Custom Components & Multiple Surfaces Guide

This guide explains how the **Contact Client** and **Contact Multiple Surfaces Agent** work in tandem to deliver rich, custom user interfaces beyond the standard A2UI library.

## Architecture Overview

Unlike standard A2UI agents that rely solely on the core component library, this sample demonstrates a **Client-First Extension Model**:

1.  **Client Defines Components**: The web client (`contact` sample) defines custom components (`OrgChart`, `WebFrame`) and their schemas.
2.  **Inline Catalog Negotiation**: When the client connects to the agent, it sends these schemas in its connection handshake (Client Event) under `metadata.inlineCatalog`.
3.  **Agent Adaptation**: The agent (`custom-components-example`) dynamically reads this catalog and injects the schema into the LLM's system prompt (via `[SYSTEM]` messages).
4.  **Rich Rendering**: The LLM can then instruct the client to render these custom components.

## Key Features

### 1. Multiple Surfaces

The agent manages multiple distinct UI areas ("surfaces") simultaneously:

- **`contact-card`**: The main profile view validation.
- **`org-chart-view`**: A side-by-side organizational chart.
- **`location-surface`**: A transient modal/overlay for map views.

### 2. Custom Components

#### `OrgChart`

A custom LitElement component created in the client that renders a hierarchical view.

- **Schema**: Defined in `samples/client/lit/contact/ui/custom-components`.
- **Usage**: The agent sends a JSON structure matching the schema, and the client renders it natively.

#### `WebFrame` (Iframe Component)

A powerful component that allows embedding external web content or local static HTML files within the A2UI interface.

- **Usage in Sample**: Used to render the "Office Floor Plan".
- **Security**: Uses standard iframe sequencing and sandbox attributes.
- **Interactivity**: Can communicate back to the parent A2UI application (e.g., clicking a desk on the map triggers an A2UI action `chart_node_click`).

## How to Run in Tandem

1.  **Start the Agent**:

    ```bash
    cd samples/agent/adk/custom-components-example
    uv run .
    ```

    _Runs on port 10004._

2.  **Start the Client**:
    ```bash
    cd samples/client/lit/contact
    yarn dev
    ```
    _Configured to connect to localhost:10004._

## Flow Example: "View Location"

1.  **User Trigger**: User clicks "Location" on a profile card.
2.  **Action**: Client sends standard A2UI action `view_location`.
3.  **Agent Response**: Agent detects the intent and returns a message to render the `location-surface`.
4.  **Component Payload**:
    ```json
    {
      "WebFrame": {
        "url": "http://localhost:10004/static/floorplan.html?data=...",
        "interactionMode": "interactive"
      }
    }
    ```
5.  **Rendering**: Client receives the message, creates the surface, and instantiates the `WebFrame` component, loading the static HTML map served by the agent.

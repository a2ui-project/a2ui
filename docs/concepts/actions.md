# Handling User Actions

This guide explains how A2UI handles user interactions. Components use the `action` property to trigger either local **Functions** (executed on the renderer) or **Events** (dispatched to the agent). In addition, **Data Model Synchronization** ensures the agent always has access to the full UI state, enabling seamless multi-modal interactions like voice commands. This design enables highly responsive interfaces while maintaining a secure, restricted environment.

## Action Architecture

Actions allow UI components to trigger behavior defined in the [`Action`](../../specification/v0_9/json/common_types.json#L271-L313) schema in `common_types.json`. Actions can trigger:

1.  **Events**: Dispatched to the Agent for processing (executed on Agent, e.g., clicking "Submit").
2.  **Functions**: Executed entirely on the renderer using [`FunctionCall`](../../specification/v0_9/json/common_types.json#L200-L242) (executed on Renderer, e.g., opening a URL).

### 1. Functions (Local)

Functions execute immediate behavior on the renderer without a network round-trip. The agent is not informed of local function calls. They use the `functionCall` keyword.

```json
{
  "id": "help-btn",
  "component": "Button",
  "child": "help-text",
  "action": {
    "functionCall": {
      "call": "openUrl",
      "args": {"url": "https://a2ui.org/help"}
    }
  }
}
```

Common uses for Functions include:

- **Navigation**: Opening a URL or switching tabs.
- **Validation**: Checking inputs before submission (see Checks below).

### 2. Events (Agent)

Events send data to the agent for processing. They use the `event` keyword.

Components like `Button` expose an `action` property. Here is how an Event is wired:

```json
{
  "id": "submit-btn",
  "component": "Button",
  "child": "btn-text",
  "action": {
    "event": {
      "name": "submit_reservation",
      "context": {
        "time": {"path": "/reservationTime"},
        "size": {"path": "/partySize"}
      }
    }
  }
}
```

- **`name`**: A stable identifier for the agent to switch on.
- **`context`**: A map of key-value pairs. Values can be literal or use a `path` to pull from the current state of the data model.

NOTE: **Context vs. Data Model**: While the Data Model represents the entire state tree of a surface, the `context` in an action is effectively a hand-picked **"view"** or subset of that state. This simplifies the Agent's job by providing exactly the values needed for a specific event, without requiring the Agent to navigate a potentially large and complex data model.

### Basic Catalog Function Validation (Checks)

The basic catalog defines a limited set of checks that can be performed on the renderer. Interactive components can define a list of `checks` (using the [`Checkable`](../../specification/v0_9/json/common_types.json#L258-L270) schema in `common_types.json`). For a `Button`, if any check fails, the button is **automatically disabled** on the renderer.

- **UX Focus**: Validation checks are designed to manage **UI State (User Experience)** by preventing invalid interactions before they happen. They are not a replacement for **Data Integrity** checks, which must still be performed on the agent.

This allows the UI to enforce requirements (like a non-empty field) before the user even tries to submit.

```json
{
  "id": "submit-button",
  "component": "Button",
  "child": "submit-text",
  "checks": [
    {
      "condition": {
        "call": "required",
        "args": {"value": {"path": "/partySize"}}
      },
      "message": "Party size is required"
    }
  ],
  "action": {"event": {"name": "submit_booking"}}
}
```

## Local State Updates & The "Write" Contract

Before an Event is even dispatched, the renderer is already managing the state of the UI locally. A2UI defines a **Read/Write Contract** for all input components (like `TextField`, `CheckBox`, or `Slider`).

1.  **Read (Model → View)**: When a component renders, it pulls its value from the bound `path` in the Data Model.
2.  **Write (View → Model)**: As soon as a user interacts (e.g., typing a character or clicking a checkbox), the renderer **immediately** writes the new value into the local Data Model.

This means the local model is **always** the source of truth for the UI's current state. This "View-to-Model" synchronization happens purely on the renderer. The data model is only sent to the agent when an event occurs (like a Button click).

IMPORTANT: **Synchronous Updates**: Local model updates are **synchronous**. This guarantees that the Data Model is fully updated before any Event resolves its `context` paths or a `DataModelSync` payload is packaged. There are no race conditions between typing and clicking; the "Write" is always committed first.

This local-first approach offers a significant **Performance Benefit**. Because synchronization is immediate and local, developers don't need to implement network debouncing or worry about latency jitters as a user types in a `TextField`. The network is completely protected from "UI noise" (like individual keystrokes) until the user is ready to dispatch a formal Event.

### The Form Submission Pattern

This separation allows for a robust form submission pattern:

- **Binding**: A `TextField` is bound to `/reservationTime`.
- **Interaction**: The user types "7:00 PM". The local model at `/reservationTime` is updated instantly.
- **Submission**: The user clicks a "Book" button. The button's Event resolves the `path: "/reservationTime"` from the local model and sends the current value to the agent.

## User Interaction Flow

When a user interacts with a component (e.g., clicks a button):

1.  **Resolve**: The renderer resolves all `path` references in the `context` against the local **Data Model**.
2.  **Construct**: The renderer builds an `action` payload conforming to [`client_to_server.json`](../../specification/v0_9/json/client_to_server.json).
3.  **Dispatch**: The payload is sent via the chosen transport (e.g., A2A, WebSockets).

### Example: The Action Payload (v0.9)

If a user clicks the button above with a data model containing `{"reservationTime": "7:00 PM", "partySize": 4}`, the renderer sends a message using the `action` key:

```json
{
  "version": "v0.9",
  "action": {
    "name": "submit_reservation",
    "surfaceId": "booking-surface",
    "sourceComponentId": "submit-btn",
    "timestamp": "2026-02-25T10:40:00Z",
    "context": {
      "time": "7:00 PM",
      "size": 4
    }
  }
}
```

IMPORTANT: **A Note on Versioning (v0.8 vs v0.9)**: In v0.8, the top-level payload key was `userAction` (e.g., `{"userAction": {...}}`). v0.9 transitioned to the simpler `action` key shown above. Standard protocol parsers expect the key corresponding to the version declared in the payload.

## Agent Processing

The Agent (or an Orchestrator) receives this event and acts on it. In an agentic system, the agent usually converts the event into a hidden user query for the LLM.

**Example Agent Processing (Python):**

```python
if action_name == "submit_reservation":
    time = context.get("time")
    size = context.get("size")
    # Feed this to the LLM
    query = f"User submitted a reservation for {size} people at {time}."
    response = await llm.generate(query)
```

## Renderer-to-Agent Error Reporting

In addition to Events triggered by the user, the renderer can report system-level errors back to the agent using the `error` payload defined in [`client_to_server.json`](../../specification/v0_9/json/client_to_server.json).

### Validation Failures

If the agent sends A2UI JSON that violates the catalog schema or protocol rules, the renderer sends a `VALIDATION_FAILED` error. This is a critical feedback loop for agentic systems:

```json
{
  "version": "v0.9",
  "error": {
    "code": "VALIDATION_FAILED",
    "surfaceId": "booking-surface",
    "path": "/components/0/children",
    "message": "Expected array of strings, got null."
  }
}
```

The agent can catch this error, apologize (or self-correct internally), and re-send the corrected UI.

## Data Model Sync (v0.9)

A2UI v0.9 introduced a powerful "stateless" synchronization feature. This allows the renderer to automatically include the **entire data model** of a surface in the metadata of every message it sends to the agent.

### Enabling Sync

Synchronization is requested by the agent during surface initialization. By setting `sendDataModel: true` in the `createSurface` message, the agent instructs the renderer to start the sync loop.

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "booking-surface",
    "catalogId": "https://a2ui.org/catalogs/v1/basic.json",
    "sendDataModel": true
  }
}
```

### Sync on the Wire

When sync is enabled, the renderer does not send the data model as a separate message. Instead, it attaches it as **metadata** to the outgoing transport envelope (e.g., an A2A message).

In an A2A (Agent-to-Agent) binding, the data model is placed in an `a2uiClientDataModel` object within the envelope's `metadata` field.

**Example A2A Envelope with Sync:**

```json
{
  "parts": [{"text": "Submit the reservation"}],
  "metadata": {
    "a2uiClientDataModel": {
      "version": "v0.9",
      "surfaces": {
        "booking-surface": {
          "reservationTime": "7:00 PM",
          "partySize": 4,
          "notes": "Window seat preferred"
        }
      }
    }
  }
}
```

### Why use Data Model Sync?

- **Simpler Wiring**: You don't need to manually map every input field into a button's `context` property. The agent can simply inspect the metadata to see the current state of all fields.
- **Stateless Agents**: The agent doesn't need to maintain local state for every user session; it receives the full current context with every single interaction.
- **Verbal Shortcuts**: Allows the user to trigger Events via voice or text (e.g., "okay submit") even without clicking a specific button. Since the agent receives the updated data model with the text message, it can process the request immediately.

## Renderer Metadata & Capabilities

Before an agent can safely send a UI, the renderer must advertise which component catalogs it supports. This is handled via the `a2uiClientCapabilities` object.

### Advertising Capabilities

Renderers include an `a2uiClientCapabilities` object in the **metadata** of their messages to the agent (e.g., in the `metadata` field of an A2A `Message`).

```json
{
  "v0.9": {
    "supportedCatalogIds": [
      "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
      "https://my-company.com/catalogs/v1/custom.json"
    ],
    "inlineCatalogs": []
  }
}
```

- **`supportedCatalogIds`**: An array of catalog URIs the renderer can render.
- **`inlineCatalogs`**: (Optional) For development or specialized environments, allows sending the full catalog schema inline.

Without this handshake, an agent cannot be certain that the renderer can handle the specific components being sent.

## Transport & Encoding

A2UI is transport-agnostic, but it is most commonly used over **A2A (Agent-to-Agent)** or WebSockets. Understanding how the payload is wrapped is crucial for implementation.

### A2A Encoding

In the standard A2A binding, A2UI messages are encoded as an A2A **DataPart**. To identify it as an A2UI payload, the part must be wrapped with specific metadata:

- **mimeType**: `application/a2ui+json`

The `data` field of the `DataPart` contains a **list** of A2UI messages. This allows multiple updates (e.g., `createSurface` followed by `updateComponents`) to be sent in a single network packet.

NOTE: **A2A Versioning**: The use of a **list** in the `data` field was introduced in **A2A v1.0**. Earlier versions of the A2A protocol expect the `data` field to contain a single JSON object.

```json
{
  "kind": "data",
  "metadata": {
    "mimeType": "application/a2ui+json"
  },
  "data": [
    {
      "version": "v0.9",
      "action": { ... }
    }
  ]
}
```

## Security Considerations

A2UI is designed with secure, sandboxed communication as a core principle. Because the protocol relies on passing user state and interaction triggers over the network, it enforces strict boundaries on data visibility and execution.

### Sandboxed Execution

A core selling point of A2UI is security through restriction. By prohibiting arbitrary code execution (like injecting raw JavaScript) from the agent, A2UI ensures that agents can only trigger pre-registered behaviors. The `functionCall` mechanism acts as a safe, sandboxed way for the agent to interact with the renderer's environment without exposing the user to malicious scripts.

### Data Model Isolation and Orchestrator Routing

When `sendDataModel: true` is enabled, the renderer includes the surface's entire data model in outgoing messages. Developers must understand the visibility of this data:

- **Point-to-Point Visibility**: Only the backend receiving the transport envelope (the Agent that created the surface, or an intermediate Orchestrator) can read this payload.
- **The Orchestrator's Responsibility**: In a multi-agent architecture, a central Orchestrator often routes user intents to specialized sub-agents. The Orchestrator must enforce **data isolation**. It is responsible for parsing the `a2uiClientDataModel`, identifying the `surfaceId`, and ensuring that the data model is only passed to the specific sub-agent that owns that surface. Data from one agent's surface must never leak to another agent.

## Orchestration & Routing

In multi-agent systems, a central **Orchestrator** often manages interactions between a user and several specialized sub-agents. A key challenge is ensuring that `action` messages from the renderer are routed back to the specific sub-agent that generated the UI surface.

### The Surface Ownership Pattern

To handle this, an orchestrator must maintain a mapping of `surfaceId` to its owning sub-agent. This is typically stored in the **Session State**.

#### 1. Mapping Ownership

When a sub-agent emits a `createSurface` message, the orchestrator intercepts it and records the ownership.

```python
# Simplified Orchestrator Logic: Record Ownership
def on_surface_created(surface_id, agent_name, session):
    # Store the mapping in the orchestrator's session state
    session.state.update({f"owner_of_{surface_id}": agent_name})
```

#### 2. Routing Events

When the renderer sends an `action` back to the orchestrator, the orchestrator looks up the `surfaceId` and transfers the request to the correct sub-agent.

```python
# Simplified Orchestrator Logic: Route Event
async def handle_incoming_action(payload, session):
    action = payload.get("action")
    surface_id = action.get("surfaceId")

    # Lookup the owning agent
    target_agent = session.state.get(f"owner_of_{surface_id}")

    if target_agent:
        # Programmatically route the request to the sub-agent
        return transfer_to(target_agent)
```

This pattern ensures that even in complex, multi-agent environments, the bidirectional communication loop remains intact and stateful for each feature area.

### Preventing Data Leakage via Metadata Stripping

In multi-agent environments, the `a2uiClientDataModel` may contain state for multiple surfaces owned by different agents. To prevent sensitive data leakage, an orchestrator must **strip** the data model metadata to only include surfaces owned by the specific sub-agent being called.

This is best implemented in an outbound metadata interceptor:

```python
# Simplified Orchestrator Interceptor: Strip Data Model
async def intercept(self, request_payload, target_agent, session):
    message = request_payload["params"]["message"]
    data_model = message.get("metadata", {}).get("a2uiClientDataModel")

    if data_model:
        # Filter surfaces to only those owned by the target_agent
        filtered_surfaces = {
            surface_id: state for surface_id, state in data_model["surfaces"].items()
            if session.state.get(f"owner_of_{surface_id}") == target_agent.name
        }

        # Replace with the stripped data model
        message["metadata"]["a2uiClientDataModel"]["surfaces"] = filtered_surfaces

    return request_payload
```

By stripping the metadata, the orchestrator ensures that sub-agents only receive the portion of the data model they are authorized to see.

CAUTION: **Security Risk: State Scraping**: If an Orchestrator fails to strip the `a2uiClientDataModel`, a malicious or compromised sub-agent could potentially "scrape" the state of other active surfaces. For example, a weather sub-agent could read sensitive data from a banking surface if the orchestrator leaks the entire multi-surface data model. Stripping is a mandatory security requirement in multi-agent systems.

---

## Comprehensive Examples

### 1. Button Submit (Explicit Context)

This example shows a button that explicitly gathers the data it needs to send.

**Component Definition:**

```json
{
  "id": "submit-button",
  "component": "Button",
  "child": "submit-text",
  "action": {
    "event": {
      "name": "submit_booking",
      "context": {
        "partySize": {"path": "/partySize"},
        "reservationTime": {"path": "/reservationTime"}
      }
    }
  }
}
```

**Resulting Action Payload:**
The agent receives an `action` object with the `partySize` and `reservationTime` directly in the `context` field.

### 2. Verbal Submit (Data Model Sync)

In this scenario, the user doesn't click a button. Instead, they say "Okay, submit the form."

**Initialization:**
The agent created the surface with `sendDataModel: true`:

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "booking-surface",
    "catalogId": "...",
    "sendDataModel": true
  }
}
```

**Renderer Transmission:**
The renderer sends an A2A message containing the user's text and the data model in the metadata:

```json
{
  "parts": [{"text": "Okay, submit the form"}],
  "metadata": {
    "a2uiClientDataModel": {
      "version": "v0.9",
      "surfaces": {
        "booking-surface": {
          "partySize": 4,
          "reservationTime": "7:00 PM"
        }
      }
    }
  }
}
```

**Agent Processing:**
The agent sees the user's intent ("submit") and looks at the `metadata` to find the current values of `partySize` and `reservationTime`, allowing it to complete the task without further clarification.

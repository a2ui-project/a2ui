# Core Concepts

This section explains the fundamental architecture of A2UI. Understanding these concepts will help you build effective agent-driven interfaces.

See [Glossary](glossary.md) for short definitions of key terms.

## The Big Picture

A2UI is built around three core ideas:

1. **Streaming Messages**: UI updates flow as a sequence of JSON messages from agent to client
2. **Declarative Components**: UIs are described as data, not programmed as code
3. **Data Binding**: UI structure is separate from application state, enabling reactive updates

## Key Topics

### [Data Flow](data-flow.md)

How messages travel from agents to rendered UI. Includes a complete lifecycle example of a restaurant booking flow, transport options (SSE, WebSockets, A2A), progressive rendering, and error handling.

### [Component Structure](components.md)

A2UI's **adjacency list model** for representing component hierarchies. Learn why flat lists are better than nested trees, how to use static vs. dynamic children, and best practices for incremental updates.

### [Data Binding](data-binding.md)

How components connect to application state using JSON Pointer paths. Covers reactive components, dynamic lists, input bindings, and the separation of structure from state that makes A2UI powerful.

## Message Types

=== "v1.0"

    Version 1.0 uses the following agent-to-renderer message types:

    - **`createSurface`**: Create a new surface, set its default catalog, and optionally send its initial components and data model
    - **`updateComponents`**: Add or update UI components in a surface
    - **`updateDataModel`**: Update application state
    - **`deleteSurface`**: Remove a UI surface
    - **`callRendererFunction`**: Ask the renderer to run a catalog function
    - **`agentFunctionResponse`**: Return the result of a function the renderer called on the agent

    v1.0 adds function calls in both directions: the agent can call renderer functions, and the renderer can call agent functions with `callAgentFunction`.

=== "v0.9.1"

    Version 0.9.1 uses the following message types:

    - **`createSurface`**: Create a new surface and specify its catalog
    - **`updateComponents`**: Add or update UI components in a surface
    - **`updateDataModel`**: Update application state
    - **`deleteSurface`**: Remove a UI surface

    All messages include a `version` field.

For complete technical details, see [Message Reference](../reference/messages.md).

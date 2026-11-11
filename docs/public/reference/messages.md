# Message Types

This reference provides detailed documentation for all A2UI message types.

## Message Format

All A2UI messages are JSON objects sent as JSON Lines (JSONL). Each line contains exactly one message.

=== "v1.0"

    Agent to renderer:

    - `createSurface`: Create a surface, set its default catalog, and optionally send its initial components and data model
    - `updateComponents`: Add or update components
    - `updateDataModel`: Update application state
    - `deleteSurface`: Remove a surface
    - `callRendererFunction`: Ask the renderer to run a catalog function
    - `agentFunctionResponse`: Return the result of a `callAgentFunction` request

    Renderer to agent:

    - `action`: Report a user action
    - `callAgentFunction`: Ask the agent to run a function
    - `rendererFunctionResponse`: Return the result of a `callRendererFunction` request
    - `error`: Report a renderer-side error

    All v1.0 messages include a `"version": "1.0"` field.

=== "v0.9.1"

    - `createSurface`: Create a surface and specify its catalog
    - `updateComponents`: Add or update components
    - `updateDataModel`: Update application state
    - `deleteSurface`: Remove a surface

    All v0.9.1 messages include a `"version"` field set to `"v0.9"` or `"v0.9.1"`.

---

## createSurface

Signals the renderer to create a surface and begin rendering it.

=== "v1.0"

    ### Schema

    ```typescript
    {
      version: "1.0";
      createSurface: {
        surfaceId: string;        // Required: Unique surface identifier
        catalogId?: string;       // Optional: Default catalog for the surface
        sendDataModel?: boolean;  // Optional: Request the renderer to send the data model
        components?: Array<...>;  // Optional: Initial components
        dataModel?: object;       // Optional: Initial data model
        metadata?: object;        // Optional: Surface-level metadata (extensions)
      }
    }
    ```

    ### Properties

    | Property        | Type    | Required | Description                                                                                           |
    | --------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------- |
    | `surfaceId`     | string  | ✅        | Unique identifier for this surface.                                                                   |
    | `catalogId`     | string  | ❌        | Default catalog for components without `@catalogId` and function calls without `catalogId`.           |
    | `sendDataModel` | boolean | ❌        | If true, the renderer sends the surface's data model to the agent with every message.                 |
    | `components`    | array   | ❌        | Initial components for the surface.                                                                   |
    | `dataModel`     | object  | ❌        | Initial data model. When both are present, the renderer applies `dataModel` before `components`.      |
    | `metadata`      | object  | ❌        | Surface-level metadata with optional `extensions`.                                                    |

    ### Example

    ```json
    {
      "version": "1.0",
      "createSurface": {
        "surfaceId": "main",
        "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
        "components": [
          {
            "id": "root",
            "component": "Text",
            "text": {
              "@path": "/greeting"
            }
          }
        ],
        "dataModel": {
          "greeting": "Hello"
        }
      }
    }
    ```

    One component must have `"id": "root"`. It can arrive in `createSurface` or in a later `updateComponents` message.

=== "v0.9.1"

    ### Schema

    ```typescript
    {
      version: "v0.9";
      createSurface: {
        surfaceId: string;      // Required: Unique surface identifier
        catalogId: string;      // Required: URL of component catalog
        theme?: object;         // Optional: Theme configuration
        sendDataModel?: boolean; // Optional: Request client to send data model updates
      }
    }
    ```

    ### Properties

    | Property        | Type    | Required | Description                                                     |
    | --------------- | ------- | -------- | --------------------------------------------------------------- |
    | `surfaceId`     | string  | ✅        | Unique identifier for this surface.                             |
    | `catalogId`     | string  | ✅        | Identifier for the component catalog.                           |
    | `theme`         | object  | ❌        | Theme configuration (e.g., `primaryColor`).                     |
    | `sendDataModel` | boolean | ❌        | If true, client sends data model changes back to the server.    |

    ### Example

    ```json
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "main",
        "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
      }
    }
    ```

    The root component is determined by convention: one component in `updateComponents` must have `"id": "root"`. The `catalogId` is required.

---

## updateComponents

Add or update components within a surface.

=== "v1.0"

    ### Schema

    ```typescript
    {
      version: "1.0";
      updateComponents: {
        surfaceId: string;        // Required: Target surface
        components: Array<{       // Required: List of components
          id: string;             // Required: Component ID
          component: string;      // Required: Component type name
          ...properties           // Component-specific properties (flat)
        }>
      }
    }
    ```

    ### Properties

    | Property     | Type   | Required | Description                    |
    | ------------ | ------ | -------- | ------------------------------ |
    | `surfaceId`  | string | ✅        | ID of the surface to update    |
    | `components` | array  | ✅        | Array of component definitions |

    ### Component Object

    The component structure is flat:

    - `id` (string, required): Unique identifier within the surface
    - `component` (string, required): Component type name (e.g., `"Text"`, `"Button"`)
    - All other properties are top-level on the component object.

    ### Examples

    **Single component:**

    ```json
    {
      "version": "1.0",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": "Text",
            "text": "# Hello, World!"
          }
        ]
      }
    }
    ```

    **Multiple components:**

    ```json
    {
      "version": "1.0",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "root",
            "component": "Column",
            "children": [
              "header",
              "body"
            ]
          },
          {
            "id": "header",
            "component": "Text",
            "text": "Welcome"
          },
          {
            "id": "body",
            "component": "Card",
            "child": "content"
          },
          {
            "id": "content",
            "component": "Text",
            "text": {
              "@path": "/message"
            }
          }
        ]
      }
    }
    ```

    **Updating existing component:**

    ```json
    {
      "version": "1.0",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": "Text",
            "text": "# Hello, Alice!"
          }
        ]
      }
    }
    ```

    ### Usage Notes

    Keep these usage notes in mind:

    - One component must have `"id": "root"` to serve as the tree root (convention, not a separate message field).
    - Properties are flat on the component object.
    - Data binding uses `{"@path": "/pointer"}` (JSON Pointer).
    - Components can be added incrementally (streaming).

=== "v0.9.1"

    ### Schema

    ```typescript
    {
      version: "v0.9";
      updateComponents: {
        surfaceId: string;        // Required: Target surface
        components: Array<{       // Required: List of components
          id: string;             // Required: Component ID
          component: string;      // Required: Component type name
          ...properties           // Component-specific properties (flat)
        }>
      }
    }
    ```

    ### Properties

    | Property     | Type   | Required | Description                    |
    | ------------ | ------ | -------- | ------------------------------ |
    | `surfaceId`  | string | ✅        | ID of the surface to update    |
    | `components` | array  | ✅        | Array of component definitions |

    ### Component Object

    The component structure is flat:

    - `id` (string, required): Unique identifier within the surface
    - `component` (string, required): Component type name (e.g., `"Text"`, `"Button"`)
    - All other properties are top-level on the component object.

    ### Examples

    **Single component:**

    ```json
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": "Text",
            "text": "Hello, World!",
            "variant": "h1"
          }
        ]
      }
    }
    ```

    **Multiple components:**

    ```json
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "root",
            "component": "Column",
            "children": [
              "header",
              "body"
            ]
          },
          {
            "id": "header",
            "component": "Text",
            "text": "Welcome"
          },
          {
            "id": "body",
            "component": "Card",
            "child": "content"
          },
          {
            "id": "content",
            "component": "Text",
            "text": {
              "path": "/message"
            }
          }
        ]
      }
    }
    ```

    **Updating existing component:**

    ```json
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": "Text",
            "text": "Hello, Alice!",
            "variant": "h1"
          }
        ]
      }
    }
    ```

    ### Usage Notes

    Keep these usage notes in mind:

    - One component must have `"id": "root"` to serve as the tree root (convention, not a separate message field).
    - Properties are flat on the component object.
    - Data binding uses `{"path": "/pointer"}` (JSON Pointer).
    - Components can be added incrementally (streaming).

### Errors

| Error                  | Cause                                  | Solution                                                                                                                                                                                      |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface already exists | `surfaceId` is already in use          | Ensure `surfaceId` is globally unique for the renderer's lifetime. If using an orchestrator with subagents, the orchestrator is empowered to manage surface IDs as needed to avoid conflicts. |
| Surface not found      | `surfaceId` does not exist             | Ensure `surfaceId` matches a surface created with `createSurface`.                                                                                                                            |
| Invalid component type | Unknown component type                 | Check component type exists in the negotiated catalog.                                                                                                                                        |
| Invalid property       | Property doesn't exist for this type   | Verify against catalog schema.                                                                                                                                                                |
| Circular reference     | Component references itself as a child | Fix component hierarchy.                                                                                                                                                                      |

---

## updateDataModel

Update the data model that components bind to.

=== "v1.0"

    ### Schema

    ```typescript
    {
      version: "1.0";
      updateDataModel: {
        surfaceId: string;      // Required: Target surface
        path?: string;          // Optional: JSON Pointer path (defaults to "/")
        value: any;             // Required: Value to set (null to delete)
      }
    }
    ```

    ### Properties

    | Property    | Type   | Required | Description                                           |
    | ----------- | ------ | -------- | ----------------------------------------------------- |
    | `surfaceId` | string | ✅        | ID of the surface to update.                          |
    | `path`      | string | ❌        | JSON Pointer path (e.g., `/user/email`). Defaults to `/` (root). |
    | `value`     | any    | ✅        | The value to set. Set it to `null` to delete the key at `path`. |

    ### Examples

    **Initialize entire model:**

    ```json
    {
      "version": "1.0",
      "updateDataModel": {
        "surfaceId": "main",
        "path": "/",
        "value": {
          "user": {
            "name": "Alice",
            "email": "alice@example.com"
          },
          "items": []
        }
      }
    }
    ```

    **Update nested property:**

    ```json
    {
      "version": "1.0",
      "updateDataModel": {
        "surfaceId": "main",
        "path": "/user/email",
        "value": "alice@newdomain.com"
      }
    }
    ```

    ### Usage Notes

    Keep these usage notes in mind:

    - Uses standard JSON Pointer paths and plain JSON values.
    - `path` defaults to `"/"` (root) if omitted.
    - `value` can be any JSON type (string, number, boolean, object, array, null). Set it to `null` to delete.
    - Components referencing `{"@path": "/user/email"}` auto-update when that path changes.

=== "v0.9.1"

    ### Schema

    ```typescript
    {
      version: "v0.9";
      updateDataModel: {
        surfaceId: string;      // Required: Target surface
        path?: string;          // Optional: JSON Pointer path (defaults to "/")
        value?: any;            // Optional: Value to set (omit to delete)
      }
    }
    ```

    ### Properties

    | Property    | Type   | Required | Description                                           |
    | ----------- | ------ | -------- | ----------------------------------------------------- |
    | `surfaceId` | string | ✅        | ID of the surface to update.                          |
    | `path`      | string | ❌        | JSON Pointer path (e.g., `/user/email`). Defaults to `/` (root). |
    | `value`     | any    | ❌        | The value to set. If omitted, the key at `path` is removed. |

    ### Examples

    **Initialize entire model:**

    ```json
    {
      "version": "v0.9",
      "updateDataModel": {
        "surfaceId": "main",
        "path": "/",
        "value": {
          "user": {
            "name": "Alice",
            "email": "alice@example.com"
          },
          "items": []
        }
      }
    }
    ```

    **Update nested property:**

    ```json
    {
      "version": "v0.9",
      "updateDataModel": {
        "surfaceId": "main",
        "path": "/user/email",
        "value": "alice@newdomain.com"
      }
    }
    ```

    ### Usage Notes

    Keep these usage notes in mind:

    - Uses standard JSON Pointer paths and plain JSON values.
    - `path` defaults to `"/"` (root) if omitted.
    - `value` can be any JSON type (string, number, boolean, object, array, null). Omit to delete.
    - Components referencing `{"path": "/user/email"}` auto-update when that path changes.

---

## deleteSurface

Remove a surface and all its components and data.

=== "v1.0"

    ```json
    {
      "version": "1.0",
      "deleteSurface": {
        "surfaceId": "modal"
      }
    }
    ```

=== "v0.9.1"

    ```json
    {
      "version": "v0.9",
      "deleteSurface": {
        "surfaceId": "modal"
      }
    }
    ```

### Properties

| Property    | Type   | Required | Description                 |
| ----------- | ------ | -------- | --------------------------- |
| `surfaceId` | string | ✅       | ID of the surface to delete |

### Usage Notes

Keep these usage notes in mind:

- Removes all components associated with the surface.
- Clears the data model for the surface.
- Client should remove the surface from the UI.
- Safe to delete non-existent surface (no-op).
- Use when closing modals, dialogs, or navigating away.

---

## callRendererFunction

v1.0 and later. The agent asks the renderer to run a function from a catalog. The renderer runs only functions whose catalog definition sets `allowedCallers` to `"agentOnly"` or `"rendererOrAgent"`, and always answers with a `rendererFunctionResponse`.

### Properties

| Property         | Type   | Required | Description                                                                                                      |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `functionCallId` | string | ✅       | Unique ID for this call. The renderer copies it into its `rendererFunctionResponse`.                             |
| `callFunction`   | object | ✅       | The function call: `@call` (function name), `catalogId` (required here), and optional `args`.                    |
| `surfaceId`      | string | ❌       | Surface whose data model `@path` bindings in `args` read from. If omitted, the call runs against an empty model. |

### Example

```json
{
  "version": "1.0",
  "callRendererFunction": {
    "functionCallId": "get_device_resolution_123",
    "callFunction": {
      "@call": "getScreenResolution",
      "catalogId": "https://example.com/catalogs/device/v1/catalog.json",
      "args": {
        "screenIndex": 0
      }
    }
  }
}
```

---

## rendererFunctionResponse

v1.0 and later. The renderer returns the result of a `callRendererFunction` request. The message carries either `value` or `error`.

### Properties

| Property         | Type   | Required | Description                                                  |
| ---------------- | ------ | -------- | ------------------------------------------------------------ |
| `functionCallId` | string | ✅       | The ID from the matching `callRendererFunction`.             |
| `value`          | any    | ❌       | The function's return value. Required unless `error` is set. |
| `error`          | object | ❌       | `code` and `message` describing a failure.                   |

### Examples

**Success:**

```json
{
  "version": "1.0",
  "rendererFunctionResponse": {
    "functionCallId": "get_device_resolution_123",
    "value": [
      1920,
      1080
    ]
  }
}
```

**Failure:**

```json
{
  "version": "1.0",
  "rendererFunctionResponse": {
    "functionCallId": "get_device_resolution_123",
    "error": {
      "code": "INVALID_FUNCTION_CALL",
      "message": "Function 'validateLocalInput' cannot be called by agent (allowedCallers is rendererOnly)."
    }
  }
}
```

---

## callAgentFunction

v1.0 and later. The renderer asks the agent to run a function, for example to verify an ID or check inventory. The renderer sends this when it has no local implementation of a function call it is evaluating. The agent answers with an `agentFunctionResponse`.

### Properties

| Property         | Type   | Required | Description                                                                                             |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `surfaceId`      | string | ✅       | The surface where the call originated.                                                                  |
| `functionCallId` | string | ✅       | Unique ID for this call. The agent copies it into its `agentFunctionResponse`.                          |
| `callFunction`   | object | ✅       | The function call: `@call`, `catalogId` (set to the catalog the call resolved to), and resolved `args`. |

### Example

```json
{
  "version": "1.0",
  "callAgentFunction": {
    "surfaceId": "contact_form_1",
    "functionCallId": "verify_provider_99",
    "callFunction": {
      "@call": "verifyProvider",
      "catalogId": "https://example.com/catalogs/healthcare.json",
      "args": {
        "providerId": "PRV-102"
      }
    }
  }
}
```

---

## agentFunctionResponse

v1.0 and later. The agent returns the result of a `callAgentFunction` request. The message carries either `value` or `error`.

### Properties

| Property         | Type   | Required | Description                                                  |
| ---------------- | ------ | -------- | ------------------------------------------------------------ |
| `functionCallId` | string | ✅       | The ID from the matching `callAgentFunction`.                |
| `value`          | any    | ❌       | The function's return value. Required unless `error` is set. |
| `error`          | object | ❌       | `code` and `message` describing a failure.                   |

### Examples

**Success:**

```json
{
  "version": "1.0",
  "agentFunctionResponse": {
    "functionCallId": "verify_provider_99",
    "value": {
      "valid": true,
      "name": "Acme Provider"
    }
  }
}
```

**Failure:**

```json
{
  "version": "1.0",
  "agentFunctionResponse": {
    "functionCallId": "verify_provider_99",
    "error": {
      "code": "PROVIDER_NOT_FOUND",
      "message": "Provider ID PRV-102 was not found."
    }
  }
}
```

---

## Message Ordering

### Requirements

Message ordering must satisfy the following requirements:

1. `createSurface` must come before any `updateComponents` or `updateDataModel` message for that surface.
2. `updateComponents` can come before or after `updateDataModel`.
3. Messages for different surfaces are independent.
4. Multiple messages can update the same surface incrementally.

### Recommended Order

=== "v1.0"

    ```jsonl
    { "version": "1.0", "createSurface":    { "surfaceId": "main", "catalogId": "...", "components": [...], "dataModel": {...} } }
    { "version": "1.0", "updateDataModel":  { "surfaceId": "main", "path": "/items", "value": [...] } }
    ```

=== "v0.9.1"

    ```jsonl
    { "version": "v0.9", "createSurface":    { "surfaceId": "main", "catalogId": "..." } }
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }
    { "version": "v0.9", "updateDataModel":  { "surfaceId": "main", "path": "/", "value": {...} } }
    ```

### Progressive Building

=== "v1.0"

    ```jsonl
    { "version": "1.0", "createSurface":    { "surfaceId": "main", "catalogId": "..." } }
    { "version": "1.0", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Header
    { "version": "1.0", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Body + Footer
    { "version": "1.0", "updateDataModel":  { "surfaceId": "main", "path": "/", "value": {...} } }
    ```

=== "v0.9.1"

    ```jsonl
    { "version": "v0.9", "createSurface":    { "surfaceId": "main", "catalogId": "..." } }
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Header
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Body + Footer
    { "version": "v0.9", "updateDataModel":  { "surfaceId": "main", "path": "/", "value": {...} } }
    ```

## Validation

=== "v1.0"

    Validate against:

    - **[agent_to_renderer.json](../../../specification/v1_0/json/agent_to_renderer.json)**: Agent-to-renderer message schema.
    - **[renderer_to_agent.json](../../../specification/v1_0/json/renderer_to_agent.json)**: Renderer-to-agent message schema.
    - **[catalogs/basic/v1/catalog.json](../../../catalogs/basic/v1/catalog.json)**: Component schemas.

=== "v0.9.1"

    Validate against:

    - **[server_to_client.json](../../../specification/v0_9_1/json/server_to_client.json)**: Message envelope schema.
    - **[catalogs/basic/catalog.json](../../../specification/v0_9_1/catalogs/basic/catalog.json)**: Component schemas.

## Further Reading

- **[Component Gallery](components.md)**: All available component types
- **[Data Binding Guide](../concepts/data-binding.md)**: How data binding works
- **[Agent Development Guide](../guides/agent-development.md)**: Generate valid messages

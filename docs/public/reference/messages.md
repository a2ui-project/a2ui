# Message Types

This reference provides detailed documentation for all A2UI message types.

## Message Format

All A2UI messages are JSON objects sent as JSON Lines (JSONL). Each line contains exactly one message.

=== "v0.8 Message Types"

    - `beginRendering` — Signal the client to render a surface
    - `surfaceUpdate` — Add or update components
    - `dataModelUpdate` — Update application state
    - `deleteSurface` — Remove a surface

=== "v0.9 Message Types"

    - `createSurface` — Create a surface and specify its catalog
    - `updateComponents` — Add or update components
    - `updateDataModel` — Update application state
    - `deleteSurface` — Remove a surface

    All v0.9 messages include a `"version": "v0.9"` field.

---

## beginRendering (v0.8) / createSurface (v0.9)

Signals the client to initialize and render a surface.

=== "v0.8 — `beginRendering`"

    ### Schema

    ```typescript
    {
      beginRendering: {
        surfaceId: string;      // Required: Unique surface identifier
        root: string;           // Required: The ID of the root component to render
        catalogId?: string;     // Optional: URL of component catalog
        styles?: object;        // Optional: Styling information
      }
    }
    ```

    ### Properties

    | Property    | Type   | Required | Description                                                                             |
    | ----------- | ------ | -------- | --------------------------------------------------------------------------------------- |
    | `surfaceId` | string | ✅        | Unique identifier for this surface.                                                     |
    | `root`      | string | ✅        | The `id` of the component that should be the root of the UI tree for this surface.      |
    | `catalogId` | string | ❌        | Identifier for the component catalog. Defaults to the v0.8 basic catalog if omitted. |
    | `styles`    | object | ❌        | Styling information for the UI, as defined by the catalog.                              |

    ### Example

    ```json
    {
      "beginRendering": {
        "surfaceId": "main",
        "root": "root-component"
      }
    }
    ```

    **With a custom catalog:**

    ```json
    {
      "beginRendering": {
        "surfaceId": "custom-ui",
        "root": "root-custom",
        "catalogId": "https://my-company.com/a2ui/v0.8/my_custom_catalog.json"
      }
    }
    ```

    Must be sent after component definitions. The client buffers `surfaceUpdate` and `dataModelUpdate` messages until `beginRendering` is received.

=== "v0.9 — `createSurface`"

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

    In v0.9, `createSurface` replaces `beginRendering`. The root is determined by convention: one component in `updateComponents` must have `"id": "root"`. The `catalogId` is required.

---

## surfaceUpdate (v0.8) / updateComponents (v0.9)

Add or update components within a surface.

=== "v0.8 — `surfaceUpdate`"

    ### Schema

    ```typescript
    {
      surfaceUpdate: {
        surfaceId: string;        // Required: Target surface
        components: Array<{       // Required: List of components
          id: string;             // Required: Component ID
          component: {            // Required: Wrapper for component data
            [ComponentType]: {    // Required: Exactly one component type
              ...properties       // Component-specific properties
            }
          }
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

    Each object in the `components` array must have:

    - `id` (string, required): Unique identifier within the surface
    - `component` (object, required): A wrapper object that contains exactly one key, which is the component type (e.g., `Text`, `Button`).

    ### Examples

    **Single component:**

    ```json
    {
      "surfaceUpdate": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": {
              "Text": {
                "text": {"literalString": "Hello, World!"},
                "usageHint": "h1"
              }
            }
          }
        ]
      }
    }
    ```

    **Multiple components (adjacency list):**

    ```json
    {
      "surfaceUpdate": {
        "surfaceId": "main",
        "components": [
          {
            "id": "root",
            "component": {
              "Column": {
                "children": {"explicitList": ["header", "body"]}
              }
            }
          },
          {
            "id": "header",
            "component": {
              "Text": {
                "text": {"literalString": "Welcome"}
              }
            }
          },
          {
            "id": "body",
            "component": {
              "Card": {
                "child": "content"
              }
            }
          },
          {
            "id": "content",
            "component": {
              "Text": {
                "text": {"path": "/message"}
              }
            }
          }
        ]
      }
    }
    ```

    **Updating existing component:**

    ```json
    {
      "surfaceUpdate": {
        "surfaceId": "main",
        "components": [
          {
            "id": "greeting",
            "component": {
              "Text": {
                "text": {"literalString": "Hello, Alice!"},
                "usageHint": "h1"
              }
            }
          }
        ]
      }
    }
    ```

    The component with `id: "greeting"` is updated (not duplicated).

    ### Usage Notes

    Keep these usage notes in mind:
    - One component must be designated as the `root` in the `beginRendering` message to serve as the tree root.
    - Components form an adjacency list (flat structure with ID references).
    - Sending a component with an existing ID updates that component.
    - Children are referenced by ID.
    - Components can be added incrementally (streaming).

=== "v0.9 — `updateComponents`"

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

    In v0.9, component structure is flatter:

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
            "children": ["header", "body"]
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
            "text": {"path": "/message"}
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
    - Component type is a string (`"component": "Text"`) instead of a wrapper object.
    - Properties are flat on the component object (no nesting under type key).
    - Data binding uses `{"path": "/pointer"}` (JSON Pointer) — same key name as v0.8 but with standard JSON Pointer paths.
    - Components can be added incrementally (streaming).

### Errors

| Error                  | Cause                                  | Solution                                                                                                                                                                                      |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface already exists | `surfaceId` is already in use          | Ensure `surfaceId` is globally unique for the renderer's lifetime. If using an orchestrator with subagents, the orchestrator is empowered to manage surface IDs as needed to avoid conflicts. |
| Surface not found      | `surfaceId` does not exist             | Ensure `surfaceId` matches the created surface. In v0.8, surfaces are implicit, but v0.9+ requires `createSurface`.                                                                           |
| Invalid component type | Unknown component type                 | Check component type exists in the negotiated catalog.                                                                                                                                        |
| Invalid property       | Property doesn't exist for this type   | Verify against catalog schema.                                                                                                                                                                |
| Circular reference     | Component references itself as a child | Fix component hierarchy.                                                                                                                                                                      |

---

## dataModelUpdate (v0.8) / updateDataModel (v0.9)

Update the data model that components bind to.

=== "v0.8 — `dataModelUpdate`"

    ### Schema

    ```typescript
    {
      dataModelUpdate: {
        surfaceId: string;      // Required: Target surface
        path?: string;          // Optional: Path to a location in the model
        contents: Array<{       // Required: Data entries
          key: string;
          valueString?: string;
          valueNumber?: number;
          valueBoolean?: boolean;
          valueMap?: Array<{...}>;
        }>
      }
    }
    ```

    ### Properties

    | Property    | Type   | Required | Description                                                                                          |
    | ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
    | `surfaceId` | string | ✅        | ID of the surface to update.                                                                         |
    | `path`      | string | ❌        | Path to a location within the data model (e.g., `user`). If omitted, the update applies to the root. |
    | `contents`  | array  | ✅        | An array of data entries as an adjacency list. Each entry has a `key` and a typed `value*` property. |

    ### The `contents` Adjacency List

    The `contents` array is a list of key-value pairs. Each object in the array must have a `key` and exactly one `value*` property (`valueString`, `valueNumber`, `valueBoolean`, or `valueMap`). This structure is LLM-friendly and avoids issues with inferring types from a generic `value` field.

    ### Examples

    **Initialize entire model:**

    ```json
    {
      "dataModelUpdate": {
        "surfaceId": "main",
        "contents": [
          {
            "key": "user",
            "valueMap": [
              { "key": "name", "valueString": "Alice" },
              { "key": "email", "valueString": "alice@example.com" }
            ]
          },
          { "key": "items", "valueMap": [] }
        ]
      }
    }
    ```

    **Update nested property:**

    ```json
    {
      "dataModelUpdate": {
        "surfaceId": "main",
        "path": "user",
        "contents": [
          { "key": "email", "valueString": "alice@newdomain.com" }
        ]
      }
    }
    ```

    This will change `/user/email` without affecting `/user/name`.

    ### Usage Notes

    Keep these usage notes in mind:
    - Data model is per-surface.
    - Components automatically re-render when their bound data changes.
    - Prefer granular updates to specific paths over replacing the entire model.
    - Uses typed value fields (`valueString`, `valueNumber`, `valueBoolean`, `valueMap`) — LLM-friendly, no type inference needed.
    - Any data transformation (e.g., formatting a date) must be done by the server before sending the message.

=== "v0.9 — `updateDataModel`"

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
    - v0.9 uses standard JSON Pointer paths and plain JSON values — no typed wrappers.
    - `path` defaults to `"/"` (root) if omitted.
    - `value` can be any JSON type (string, number, boolean, object, array, null). Omit to delete.
    - Simpler than v0.8's `contents` adjacency list — closer to standard JSON Patch semantics.
    - Components referencing `{"path": "/user/email"}` auto-update when that path changes.

---

## deleteSurface

Remove a surface and all its components and data.

=== "v0.8 — `deleteSurface`"

    ### Schema

    ```typescript
    {
      deleteSurface: {
        surfaceId: string;        // Required: Surface to delete
      }
    }
    ```

    ### Example

    ```json
    {
      "deleteSurface": {
        "surfaceId": "modal"
      }
    }
    ```

=== "v0.9 — `deleteSurface`"

    ### Schema

    ```typescript
    {
      version: "v0.9";
      deleteSurface: {
        surfaceId: string;        // Required: Surface to delete
      }
    }
    ```

    ### Example

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
- Identical structure in both versions (v0.9 just adds the `version` field).

---

## Message Ordering

### Requirements

Message ordering must satisfy the following requirements:

1. `beginRendering` must come after the initial `surfaceUpdate` messages for that surface.
2. `surfaceUpdate` can come before or after `dataModelUpdate`.
3. Messages for different surfaces are independent.
4. Multiple messages can update the same surface incrementally.

### Recommended Order

=== "v0.8"

    ```jsonl
    { "surfaceUpdate":    { "surfaceId": "main", "components": [...] } }
    { "dataModelUpdate":  { "surfaceId": "main", "contents": {...} } }
    { "beginRendering":   { "surfaceId": "main", "root": "root-id" } }
    ```

=== "v0.9"

    ```jsonl
    { "version": "v0.9", "createSurface":    { "surfaceId": "main", "catalogId": "..." } }
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }
    { "version": "v0.9", "updateDataModel":  { "surfaceId": "main", "path": "/", "value": {...} } }
    ```

### Progressive Building

=== "v0.8"

    ```jsonl
    { "surfaceUpdate":   { "surfaceId": "main", "components": [...] } }  // Header
    { "surfaceUpdate":   { "surfaceId": "main", "components": [...] } }  // Body
    { "beginRendering":  { "surfaceId": "main", "root": "root-id" } }   // Render
    { "surfaceUpdate":   { "surfaceId": "main", "components": [...] } }  // Footer
    { "dataModelUpdate": { "surfaceId": "main", "contents": {...} } }    // Data
    ```

=== "v0.9"

    ```jsonl
    { "version": "v0.9", "createSurface":    { "surfaceId": "main", "catalogId": "..." } }
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Header
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [...] } }  // Body + Footer
    { "version": "v0.9", "updateDataModel":  { "surfaceId": "main", "path": "/", "value": {...} } }
    ```

## Validation

=== "v0.8"

    Validate against:

    - **[server_to_client.json](../../../specification/v0_8/json/server_to_client.json)**: Message envelope schema.
    - **[standard_catalog_definition.json](../../../specification/v0_8/json/standard_catalog_definition.json)**: Component schemas.

=== "v0.9"

    Validate against:

    - **[server_to_client.json](../../../specification/v0_9/json/server_to_client.json)**: Message envelope schema.
    - **[catalogs/basic/catalog.json](../../../specification/v0_9/catalogs/basic/catalog.json)**: Component schemas.

## Further Reading

- **[Component Gallery](components.md)**: All available component types
- **[Data Binding Guide](../concepts/data-binding.md)**: How data binding works
- **[Agent Development Guide](../guides/agent-development.md)**: Generate valid messages

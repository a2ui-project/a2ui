# A2UI (Agent-to-Agent UI) Extension spec v1.0

## Overview

This extension implements the A2UI (Agent-to-Agent UI) spec v1.0, a format for agents to send streaming, interactive user interfaces to clients.

## Extension URI

The URI of this extension is:
`https://a2ui.org/a2a-extension/a2ui/v1.0`

This is the only URI accepted for this extension.

## Core concepts

The A2UI extension is built on the following main concepts:

- **Surfaces**: A "Surface" is a distinct, controllable region of the client's UI. The spec uses a `surfaceId` to direct updates to specific surfaces (e.g., a main content area, a side panel, or a new chat bubble). This allows a single agent stream to manage multiple UI areas independently.
- **Catalog Definition Document**: The A2UI extension is catalog-agnostic. All UI components (e.g., Text, Row, Button) and functions (e.g., required, email) are defined in a separate Catalog Definition Schema. This allows clients and servers to negotiate which catalog to use.
- **Schemas**: The A2UI extension is defined by several primary JSON schemas:
  - **Catalog Definition Schema**: A standard format for defining a library of components and functions ([catalog_definition.json](../../../json/catalog_definition.json)).
  - **Server-to-Client Message List Schema**: The core wire format for messages sent from the agent to the client ([server_to_client_list.json](../../../json/server_to_client_list.json)).
  - **Client-to-Server Message List Schema**: The core wire format for messages sent from the client to the agent ([client_to_server_list.json](../../../json/client_to_server_list.json)).
  - **Server Capabilities Schema**: The schema for the `a2uiServerCapabilities` object, used by servers to declare their UI generation capabilities ([server_capabilities.json](../../../json/server_capabilities.json)).
  - **Client Capabilities Schema**: The schema for the `a2uiClientCapabilities` object ([client_capabilities.json](../../../json/client_capabilities.json)).
  - **Client Data Model Schema**: The schema for the `a2uiClientDataModel` object, used for two-way synchronization ([client_data_model.json](../../../json/client_data_model.json)).

---

## Metadata and capabilities exchange

In A2UI v1.0, capabilities and other session metadata are exchanged via **transport metadata** or initialization payloads rather than as first-class A2UI messages.

### Server capabilities in Agent Cards

Agents advertise their A2UI capabilities in their AgentCard within the `AgentCapabilities.extensions` list. The `params` object defines the agent's specific UI support and corresponds directly to the **Server Capabilities Schema** ([server_capabilities.json](../../../json/server_capabilities.json)).

#### Example AgentExtension block

```json
{
  "uri": "https://a2ui.org/a2a-extension/a2ui/v1.0",
  "description": "Ability to render A2UI v1.0",
  "required": false,
  "params": {
    "supportedCatalogIds": [
      "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      "https://my-company.com/a2ui/v0_1/my_custom_catalog.json"
    ],
    "acceptsInlineCatalogs": true
  }
}
```

#### Parameter definitions

The `params` object corresponds to the `v1.0` object in the `server_capabilities.json` schema:

- `params.supportedCatalogIds` (array of strings, optional): An array of strings, where each string is an ID identifying a Catalog Definition Schema that the agent can generate. This is not necessarily a resolvable URI.
- `params.acceptsInlineCatalogs` (boolean, optional): A boolean indicating if the agent can accept an `inlineCatalogs` array in the client's `a2uiClientCapabilities`. If omitted, this defaults to `false`.

### Client capabilities in message metadata

The client sends its capabilities to the server in an `a2uiClientCapabilities` object. This object is included in the `metadata` field of every A2A `Message` sent from the client to the server, following the **Client Capabilities Schema** ([client_capabilities.json](../../../json/client_capabilities.json)).

#### Parameter definitions

The `a2uiClientCapabilities` object contains a `v1.0` object with the following properties:

- `v1.0.supportedCatalogIds` (array of strings, required): The string identifiers of supported component and function catalogs.
- `v1.0.inlineCatalogs` (array, optional): An array of custom catalog definitions provided inline by the client. Functions defined within inline catalogs support declaring execution boundaries (`callableFrom: "clientOnly" | "remoteOnly" | "clientOrRemote"`) to statically specify remote invocation safety.

---

## Client-to-server data model synchronization

When `sendDataModel` is enabled for a surface (via the `createSurface` message), the client automatically appends the **entire data model** of that surface to the metadata of every message (such as an `action` or user query) sent to the server that created the surface.

In A2A transport, the data model is serialized to the `a2uiClientDataModel` format and placed in the `metadata` field of the A2A `Message` envelope, following the **Client Data Model Schema** ([client_data_model.json](../../../json/client_data_model.json)).

### Parameter definitions

The `a2uiClientDataModel` object contains:

- `version` (string, required): Must be the constant `"v1.0"`.
- `surfaces` (object, required): A map of surface IDs to their current local data models.

### Synchronization rules

- **Targeted Delivery**: The data model is sent exclusively to the server that created the surface. Data cannot leak to other agents or servers.
- **Trigger**: Data is sent only when a client-to-server message is triggered (e.g., by a user action like a button click). Passive data changes (like typing in a text field) do not trigger a network request on their own; they simply update the local state, which will be sent with the next action.
- **Convergence**: The server treats the received data model as the current state of the client at the time of the action.

---

## Extension activation

Clients indicate their desire to use the A2UI extension by specifying it via the transport-defined A2A extension activation mechanism.

- For **JSON-RPC and HTTP** transports, this is indicated via the `X-A2A-Extensions` HTTP header.
- For **gRPC**, this is indicated via the `X-A2A-Extensions` metadata value.

Activating this extension implies that the server can send A2UI-specific messages (like `updateComponents`) and the client is expected to send A2UI-specific events (like `action`).

---

## Data encoding

A2UI messages are encoded as an A2A `DataPart`. To identify a `DataPart` as containing A2UI data, it must have the following metadata:

- `mimeType`: `application/a2ui+json`

The `data` field of the `DataPart` contains a **list** of A2UI JSON messages (e.g., `createSurface`, `updateComponents`, `action`). It MUST be an array of messages.

### Processing rules

The `data` field contains a list of messages. This list is **NOT** a transactional unit. Receivers (both Clients and Agents) MUST process messages in the list sequentially.

If a single message in the list fails to validate or apply (e.g., due to a schema violation or invalid reference), the receiver SHOULD report/log the error for that specific message and MUST continue processing the remaining messages in the list.

Atomicity is guaranteed only at the **individual message** level. However, for a better user experience, a renderer SHOULD NOT repaint the UI until all messages in the list have been processed. This prevents intermediate states from flickering to the user.

### Server-to-client messages

When an agent sends a message to a client (or another agent acting as a client/renderer), the `data` payload must validate against the **Server-to-Client Message List Schema** ([server_to_client_list.json](../../../json/server_to_client_list.json)).

#### Example DataPart

```json
{
  "data": [
    {
      "version": "v1.0",
      "createSurface": {
        "surfaceId": "example_surface",
        "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
      }
    },
    {
      "version": "v1.0",
      "updateComponents": {
        "surfaceId": "example_surface",
        "components": [
          {
            "component": "Text",
            "id": "root",
            "text": "Hello!"
          }
        ]
      }
    }
  ],
  "kind": "data",
  "metadata": {
    "mimeType": "application/a2ui+json"
  }
}
```

### Client-to-server events

When a client (or an agent forwarding an event) sends a message to an agent, it also uses a `DataPart` with the same `application/a2ui+json` MIME type. However, the `data` payload must validate against the **Client-to-Server Message List Schema** ([client_to_server_list.json](../../../json/client_to_server_list.json)).

#### Example `action` DataPart

```json
{
  "data": [
    {
      "version": "v1.0",
      "action": {
        "name": "submit_form",
        "surfaceId": "contact_form_1",
        "sourceComponentId": "submit_button",
        "timestamp": "2026-01-15T12:00:00Z",
        "context": {
          "email": "user@example.com"
        }
      }
    }
  ],
  "kind": "data",
  "metadata": {
    "mimeType": "application/a2ui+json"
  }
}
```

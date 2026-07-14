# A2UI (Agent-to-Agent UI) Extension spec v0.9.1

## Overview

This document is intended for developers implementing the A2UI A2A extension. The extension adds A2UI v0.9.1 support to A2A, a format for agents to send streaming, interactive user interfaces to clients.

## Extension URI

The URI of this extension is https://a2ui.org/a2a-extension/a2ui/v0.9.1

This URI is the canonical way to communicate **protocol versioning** between clients and agents. The extension URI explicitly encodes the version (e.g., `v0.9.1`). A client requesting this specific URI indicates it supports the v0.9.1 schema format.

## Core concepts

A2UI relies on the following main concepts:

Surfaces: A "Surface" provides a distinct, isolated, and controllable container for agentic UI. Agents create surfaces. Only the creating agent can modify, delete, or view the contents of its surface. This design allows a single agent stream to manage multiple UI areas independently.

Catalog: A2UI is catalog-agnostic. A separate Catalog Definition Schema defines all UI components (e.g., Text, Row, Button) and functions (e.g., required, email). This separation allows clients and servers to negotiate which catalog to use. For more information, see the [Catalogs Guide](../../../docs/public/concepts/catalogs.md).

## Agent Card

Agents advertise their A2UI capabilities in their AgentCard within the `AgentCapabilities.extensions` list. The `params` object defines the agent's specific UI support and corresponds directly to the [Server Capabilities Schema](../json/server_capabilities.json).

Example AgentCard payload:

```json
{
  "name": "Dashboard Agent",
  "description": "Agent capable of generating dynamic UI dashboards.",
  "capabilities": {
    "extensions": [
      {
        "uri": "https://a2ui.org/a2a-extension/a2ui/v0.9.1",
        "description": "Ability to render A2UI v0.9.1",
        "required": false,
        "params": {
          "supportedCatalogIds": [
            "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
            "https://my-company.com/a2ui/v0.9.1/my_custom_catalog.json"
          ],
          "acceptsInlineCatalogs": true
        }
      }
    ]
  }
}
```

The `params` object corresponds to the `v0.9.1` object in the `server_capabilities.json` schema:

- `params.supportedCatalogIds`: (OPTIONAL) An array of strings, where each string is an ID identifying a Catalog Definition Schema that the agent can generate. This is not necessarily a resolvable URI.
- `params.acceptsInlineCatalogs`: (OPTIONAL) A boolean indicating if the agent can accept an `inlineCatalogs` array in the client's `a2uiClientCapabilities`. If omitted, this defaults to `false`.

## A2A Extension activation

Activating the A2UI extension means the server can send A2UI-specific messages (like updateComponents) and the client can send A2UI-specific events (like action).

Activating the A2UI extension is the **canonical "on/off switch"** for A2UI generation. 
- You should **not** use `accepted_output_modes: ['a2ui']` (which is not an A2UI standard) to trigger A2UI.
- You should **not** rely solely on the presence of `a2uiClientCapabilities` in metadata. 

Clients indicate their desire to use the A2UI extension by specifying it via the transport-defined A2A extension activation mechanism. The [A2A Extensions Guide](https://a2a-protocol.org/latest/topics/extensions/) defines this process.

### JSON-RPC and HTTP transports

To activate the A2UI A2A Extension, the `X-A2A-Extensions` HTTP header includes the extension URI.

**Example HTTP `SendMessageRequest`:**

```http
POST /v1/messages HTTP/1.1
Host: agent.example.com
X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9.1
Content-Type: application/json

{
  "message": {
    "parts": [
      {
        "text": "Hello, show me the dashboard"
      }
    ]
  }
}
```

To see how the agent parses the extension URI, see [`extension.py`](../../../agent_sdks/python/a2ui_agent/src/a2ui/a2a/extension.py).

### GRPC transport

To activate the A2UI A2A Extension, the client adds the extension URI to A2A `sendMessageParams.metadata["X-A2A-Extensions"]`.

**Example gRPC `SendMessageRequest`:**

```json
{
  "metadata": {
    "X-A2A-Extensions": "https://a2ui.org/a2a-extension/a2ui/v0.9.1"
  },
  {
    "message": {
      "parts": [
        {
          "text": "Hello, show me the dashboard"
        }
      ]
    }
  }
}
```

## A2A Client to Server Metadata

Once the extension is activated, the client attaches `a2uiClientCapabilities` and `a2uiClientDataModel` to every A2A message.

### `a2uiClientCapabilities`

The client sends `sendMessageRequest.message["a2uiClientCapabilities"]` = [Client Capabilities Schema](../json/client_capabilities.json) to advertise which catalogs the renderer supports.

**Example `SendMessageRequest` with Capabilities:**

```json
{
  "message": {
    "parts": [
      {
        "text": "Show me the dashboard."
      }
    ],
    "metadata": {
      "a2uiClientCapabilities": {
        "v0.9": {
          "supportedCatalogIds": [
            "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
            "https://my-company.com/a2ui/v0.9.1/my_custom_catalog.json"
          ]
        }
      }
    }
  }
}
```

### `a2uiClientDataModel`

When a surface enables Data Model Sync, the client sends `sendMessageRequest.message["a2uiClientDataModel"]` = [Client Data Model Schema](../json/client_data_model.json) on every message. This model provides the agent with the latest UI state. For more details, see the [Actions Guide](../../../docs/public/concepts/actions.md).

**Example `SendMessageRequest` with Data Model:**

```json
{
  "message": {
    "parts": [
      {
        "text": "Submit the form."
      }
    ],
    "metadata": {
      "a2uiClientDataModel": {
        "version": "v0.9.1",
        "surfaces": {
          "main_surface_id": {
            "user_id": "12345",
            "email": "user@example.com"
          }
        }
      }
    }
  }
}
```

## Data encoding

Agents and clients encode A2UI messages as an A2A `DataPart`.

To identify a `DataPart` as containing A2UI data, it must have the following metadata:

- `mimeType`: `application/a2ui+json`

The `data` field of the `DataPart` contains a **list** of A2UI JSON messages (e.g., `createSurface`, `updateComponents`, `action`). It MUST be an array of messages.

### Processing Rules

The `data` field contains a list of messages. This list is **NOT** a transactional unit. Receivers (both Clients and Agents) MUST process messages in the list sequentially.

If a single message in the list fails to validate or apply (e.g., due to a schema violation or invalid reference), the receiver SHOULD report/log the error for that specific message and MUST continue processing the remaining messages in the list.

Atomicity is guaranteed only at the **individual message** level. However, for a better user experience, a renderer SHOULD NOT repaint the UI until all messages in the list have been processed. This prevents intermediate states from flickering to the user.

### Server-to-client messages

When an agent sends a message to a client (or another agent acting as a client/renderer), the `data` payload must validate against the [Server-to-Client Message List Schema](../json/server_to_client_list.json).

Example DataPart:

```json
{
  "data": [
    {
      "version": "v0.9.1",
      "createSurface": {
        "surfaceId": "example_surface",
        "catalogId": "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
      }
    },
    {
      "version": "v0.9.1",
      "updateComponents": {
        "surfaceId": "example_surface",
        "components": [
          {
            "Text": {
              "id": "root",
              "text": "Hello!"
            }
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

When a client (or an agent forwarding an event) sends a message to an agent, it also uses a `DataPart` with the same `application/a2ui+json` MIME type. However, the `data` payload must validate against the - [Client-to-Server Message List Schema](../json/client_to_server_list.json).

Example `action` DataPart:

```json
{
  "data": [
    {
      "version": "v0.9.1",
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

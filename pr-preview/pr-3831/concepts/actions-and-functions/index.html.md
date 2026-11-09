# Actions, Events and Functions

> How component actions send events to the agent or trigger functions, and how A2UI functions work across actions, property bindings, validation checks, and agent requests.

Canonical URL: https://a2ui.org/concepts/actions-and-functions/

An action defines what happens when a user interacts with a component by triggering either an [event](#events) or a [function](#functions). Events prompt the agent to respond with UI updates, while functions execute specific logic on the renderer or agent. Functions can also run outside user actions, such as property bindings, validation checks, and agent requests.

## Actions

An **action** is an interaction handler property on an interactive UI component, such as `Button.action` on [`Button`](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json/components/Button), that runs when a user interacts with that component (for example, clicking or tapping a button).

An action determines how user interaction is handled:

- An event notifies the agent of user intent by sending an outbound [`action`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/action) message. Use an event when the agent needs to decide what happens next and stream UI or data updates back to the client (such as confirming an order or booking a reservation).
- A function invokes a registered catalog operation directly without starting a new agent conversation turn. The function can execute locally on the renderer (such as opening a link with [`openUrl`](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json/functions/openUrl)) or run remotely on the agent via [`callAgentFunction`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/callAgentFunction) to perform a discrete backend check (such as verifying inventory).

See [`Action`](/specification/v1.0/schemas/#common_types.json/$defs/Action) in the protocol schema for the action structure.

| Aspect          | Event                                             | Function                                                |
| :-------------- | :------------------------------------------------ | :------------------------------------------------------ |
| Action property | `action.event`                                    | `action.functionCall`                                   |
| Purpose         | Prompts the agent to process intent and update UI | Triggers specific logic on the renderer or agent        |
| Triggered by    | A user gesture on a component action              | Actions, property bindings, validation checks, or agent |
| Runs on         | The agent, after an `action` message              | The renderer, or the agent via `callAgentFunction`      |
| Agent turn      | Starts a new agent conversation turn              | Runs without starting an agent turn                     |
| Result          | The agent decides next steps and updates UI       | A typed return value, or a local side effect            |

> **Note**

In v0.9.1 ([`Action`](/specification/v0.9.1/schemas/#common_types.json/$defs/Action)), `action.event` does not support `userMessage`, and `action.functionCall` uses `"call"` instead of `"@call"` and executes only locally on the renderer.

---

## Events

Events inform the agent that a user interacted with a component and prompt the agent to respond. When a user clicks or taps a component configured with an event (such as a "Book flight" button), the client sends an [`action`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/action) message to the agent. The agent processes the interaction, makes any required decisions or backend updates, and streams back updated UI components or data.

When dispatching an event, the client performs the following tasks:

1. Reads any context values attached to the event (such as the flight number or selected seat) and resolves data bindings against the current surface data model.
2. Evaluates an optional human-readable `userMessage` describing what the user did (for example, `"Confirmed flight reservation for Alex Rosario"`, formatted with [`formatString`](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json/functions/formatString)).
3. Sends an [`action`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/action) message to the agent containing the event name, source component, timestamp, resolved context, and optional user message.

If the surface is configured to share its data model, the client also attaches the full surface state to outbound messages so the agent has complete visibility into what the user sees. See [Data Model and Data Binding](/concepts/data-binding/#synchronizing-state-back-to-the-agent) for details.

The following example shows a confirmation `Button` declaration and the outbound `action` message the renderer sends when the user clicks it.

#### v1.0

`Button` component declaration:

```json
{
  "id": "confirm_button",
  "component": "Button",
  "child": "confirm_label",
  "variant": "primary",
  "action": {
    "event": {
      "name": "confirmReservation",
      "userMessage": {
        "@call": "formatString",
        "args": {
          "value": "Confirmed flight reservation for ${/passenger/fullName}"
        }
      },
      "context": {
        "flightNumber": "UA-402",
        "seat": {"@path": "/selection/seatNumber"}
      }
    }
  }
}
```

Outbound [`action`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/action) message sent on click:

```json
{
  "version": "1.0",
  "action": {
    "name": "confirmReservation",
    "surfaceId": "booking_surface",
    "sourceComponentId": "confirm_button",
    "timestamp": "2026-11-02T03:45:00Z",
    "userMessage": "Confirmed flight reservation for Alex Rosario",
    "context": {
      "flightNumber": "UA-402",
      "seat": "14B"
    }
  }
}
```

#### v0.9.1

`Button` component declaration:

```json
{
  "id": "confirm_button",
  "component": "Button",
  "child": "confirm_label",
  "variant": "primary",
  "action": {
    "event": {
      "name": "confirmReservation",
      "context": {
        "flightNumber": "UA-402",
        "seat": {"path": "/selection/seatNumber"}
      }
    }
  }
}
```

Outbound [`action`](/specification/v0.9.1/schemas/#client_to_server.json/properties/action) message sent on click:

```json
{
  "version": "v0.9",
  "action": {
    "name": "confirmReservation",
    "surfaceId": "booking_surface",
    "sourceComponentId": "confirm_button",
    "timestamp": "2026-11-02T03:45:00Z",
    "context": {
      "flightNumber": "UA-402",
      "seat": "14B"
    }
  }
}
```

> **Note**

In v0.9.1, data bindings use `path` instead of `@path`, events do not support `userMessage` (all interaction details must be provided in `context`), and client-to-server action messages are defined in [`client_to_server.json`](/specification/v0.9.1/schemas/#client_to_server.json/properties/action).

---

## Functions

Functions execute specific logic or calculations on either the client or the server. Unlike events, which start an agent turn to generate or update entire UI surfaces, functions are focused operations that compute a value, validate input, access local state, or trigger a local operation. Every available function is declared in a [catalog](/concepts/catalogs/), defining its name and expected parameters.

### Function types

Functions run either locally on the client renderer or remotely on the agent.

When evaluating a function call, the client checks whether the function is registered locally in its catalog. If a local implementation exists, the client runs it immediately without making a network request. If the function is not implemented locally, the client routes the call to the agent via [`callAgentFunction`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/callAgentFunction) and awaits the response.

#### Renderer functions

Renderer functions are implemented locally by the client renderer and registered with its catalog. Some types of renderer functions are:

- Validation functions that check input values or form readiness against constraints, such as required fields or email formatting.
- Data transformation functions that format numbers, dates, currency, or strings, or evaluate boolean logic before displaying values on screen.
- Local data access functions that read client-side state or template context not stored in the surface data model, such as an item's position inside a list template or device screen dimensions.
- Local action functions that perform client-side operations in response to user gestures, such as opening a URL in the browser.

These examples illustrate common functions available in the [Basic Catalog](/specification/v1.0-basic-catalog-implementation-guide/#2-renderer-side-functions). See the [Basic Catalog functions specification](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json/functions) for the full set of standard renderer functions, or define custom functions in your own catalog.

#### Agent functions

Agent functions run on the server rather than in the client application. They let UI components trigger discrete backend operations (such as checking real-time inventory or validating a coupon code) without starting a full conversation turn.

When a component calls an agent function, the following steps occur:

1. The client sends a [`callAgentFunction`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/callAgentFunction) request naming the function, its resolved `catalogId`, and its arguments. While waiting for the server, the client can display a pending or loading state.
2. The server executes the function logic and returns an [`agentFunctionResponse`](/specification/v1.0/schemas/#agent_to_renderer.json/$defs/AgentFunctionResponseMessage) containing either a `value` or an `error` object.
3. The client applies the returned `value` to the component property, validation check, or action. If the call returns an error, property bindings resolve to `null` and report an [`error`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/error) message (`code: "EXPRESSION_ERROR"` with the failed `functionCallId`), validation checks mark the component as invalid, and in-progress component actions stop and report `EXPRESSION_ERROR` with `functionCallId`.

The following example shows an outbound agent function call to verify product stock:

```json
{
  "version": "1.0",
  "callAgentFunction": {
    "surfaceId": "checkout_surface",
    "functionCallId": "call_inv_check_881",
    "callFunction": {
      "@call": "checkInventory",
      "catalogId": "https://example.com/catalogs/store/v1/catalog.json",
      "args": {
        "sku": "SKU-99201",
        "quantity": 2
      }
    }
  }
}
```

> **Note**

Any function not implemented locally by the client renderer is automatically routed to the agent. If a renderer function name is misspelled (such as `"formatCurrncy"` instead of `"formatCurrency"`), the client attempts to call it as an agent function, and the agent responds with an unknown function error.

### Calling functions

Functions can be invoked in four contexts:

- Component actions, when a user clicks or taps a component configured to execute a function directly.
- Property bindings, when a component property computes its display value from a function.
- Validation checks, when an input field or button evaluates rules before allowing user progress.
- Agent requests, when the agent asks the client to execute a local function on the device.

#### Component actions

A component action can execute a function directly instead of sending an event to the agent. For example, clicking this help button opens a support URL in the browser without contacting the agent:

#### v1.0

```json
{
  "id": "help_link",
  "component": "Button",
  "child": "help_text",
  "variant": "borderless",
  "action": {
    "functionCall": {
      "@call": "openUrl",
      "args": {
        "url": "https://support.example.com/billing"
      }
    }
  }
}
```

#### v0.9.1

```json
{
  "id": "help_link",
  "component": "Button",
  "child": "help_text",
  "variant": "borderless",
  "action": {
    "functionCall": {
      "call": "openUrl",
      "args": {
        "url": "https://support.example.com/billing"
      }
    }
  }
}
```

#### Property bindings

Component properties can compute their value from a function call. The client automatically re-evaluates the function whenever the underlying bound data changes. In this example, a text component formats an order subtotal into currency:

#### v1.0

```json
{
  "id": "order_total_text",
  "component": "Text",
  "text": {
    "@call": "formatCurrency",
    "args": {
      "value": {"@path": "/order/subtotal"},
      "currency": "USD"
    }
  }
}
```

#### v0.9.1

```json
{
  "id": "order_total_text",
  "component": "Text",
  "text": {
    "call": "formatCurrency",
    "args": {
      "value": {"path": "/order/subtotal"},
      "currency": "USD"
    }
  }
}
```

#### Validation checks

Interactive components like text fields and buttons can define validation rules. Each rule checks a condition (such as verifying required fields or checking email format) and provides an error message if the check fails. For buttons, failing any validation check automatically disables the button:

#### v1.0

```json
{
  "id": "user_email_input",
  "component": "TextField",
  "label": "Email",
  "value": {"@path": "/formData/email"},
  "checks": [
    {
      "condition": {
        "@call": "required",
        "args": {"value": {"@path": "/formData/email"}}
      },
      "message": "Email address is required."
    },
    {
      "condition": {
        "@call": "email",
        "args": {"value": {"@path": "/formData/email"}}
      },
      "message": "Enter a valid email address."
    }
  ]
}
```

#### v0.9.1

```json
{
  "id": "user_email_input",
  "component": "TextField",
  "label": "Email",
  "value": {"path": "/formData/email"},
  "checks": [
    {
      "condition": {
        "call": "required",
        "args": {"value": {"path": "/formData/email"}}
      },
      "message": "Email address is required."
    },
    {
      "condition": {
        "call": "email",
        "args": {"value": {"path": "/formData/email"}}
      },
      "message": "Enter a valid email address."
    }
  ]
}
```

#### Agent requests

The agent can also request the client to execute a function locally via [`callRendererFunction`](/specification/v1.0/schemas/#agent_to_renderer.json/$defs/CallRendererFunctionMessage), for example to query device screen dimensions. The client runs the local function and always replies with a [`rendererFunctionResponse`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/rendererFunctionResponse) message containing the matching `functionCallId` and either `value` or `error` (even when the function's return type is `void`):

```json
{
  "version": "1.0",
  "callRendererFunction": {
    "functionCallId": "hw_screen_001",
    "callFunction": {
      "catalogId": "https://example.com/catalogs/device.json",
      "@call": "getScreenResolution",
      "args": {
        "screenIndex": 0
      }
    }
  }
}
```

### Who can call a function

Because functions can trigger sensitive side effects (like opening a browser URL) or access device attributes, a catalog [`FunctionDefinition`](/specification/v1.0/schemas/#catalog_definition.json/$defs/FunctionDefinition) can control who is permitted to call it and whether it requires a direct user gesture:

- The `allowedCallers` property restricts callers to `"rendererOnly"` (the default), `"agentOnly"`, or `"rendererOrAgent"`. For example, `"rendererOnly"` functions cannot be invoked remotely by the agent via `callRendererFunction`, while `"agentOnly"` functions can only be called by the agent and cannot be used in component properties or actions.
- The `requiresUserActivation` property (which defaults to `false` and requires `allowedCallers: "rendererOnly"` when `true`) restricts execution to a direct user tap or click on a component action, such as `openUrl`. This prevents passive property bindings, validation checks, or incoming agent messages from triggering browser navigation without user intent.

> **Note**

In v0.9.1, function calls use `call` instead of `@call` and data bindings use `path` instead of `@path`. All functions execute locally on the client renderer; v0.9.1 does not support remote agent functions, agent requests to the renderer, or caller permission settings.

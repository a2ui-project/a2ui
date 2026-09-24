# A2UI Node restaurant agent sample

This is a restaurant-finder agent that serves the A2A protocol over HTTP on port 10002. It calls Gemini through `@google/genai` and generates A2UI payloads through the `@a2ui/agent` SDK.

The sample supports four protocol and format combinations:

- `A2UI_VERSION=v0.9 A2UI_FORMAT=direct_json`: Renders in the Lit, React, and Angular sample clients.
- `A2UI_VERSION=v0.9 A2UI_FORMAT=express`: Express DSL compiled to v0.9 JSON; renders in the same clients.
- `A2UI_VERSION=v1.0 A2UI_FORMAT=direct_json` (default): Headless mode using the candidate v1.0 protocol.
- `A2UI_VERSION=v1.0 A2UI_FORMAT=express`: Headless mode using v1.0 compiled Express DSL.

## Running the sample

Build the package first. The project compiles to `dist/src/`, and `yarn start` executes that output:

```bash
yarn workspace @a2ui/agent-restaurant-node run build
```

### Without an API key (stub mode)

Use `STUB_LLM=true` to serve canned responses from the verified example files:

```bash
# Default (v1.0, direct_json)
STUB_LLM=true yarn workspace @a2ui/agent-restaurant-node run start

# v0.9 direct JSON (works with sample clients)
STUB_LLM=true A2UI_VERSION=v0.9 A2UI_FORMAT=direct_json yarn workspace @a2ui/agent-restaurant-node run start

# v0.9 Express
STUB_LLM=true A2UI_VERSION=v0.9 A2UI_FORMAT=express yarn workspace @a2ui/agent-restaurant-node run start

# v1.0 Express
STUB_LLM=true A2UI_VERSION=v1.0 A2UI_FORMAT=express yarn workspace @a2ui/agent-restaurant-node run start
```

In Direct JSON mode, the stub feeds the example in four mid-token chunks through the streaming parser. In Express mode, the stub decompiles the example to Express syntax, parses it, and emits the resulting UI messages.

### With a real model

Provide a `GEMINI_API_KEY`:

```bash
cp .env.example .env    # add your GEMINI_API_KEY
GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

To run a specific combination with a live model:

```bash
GEMINI_API_KEY=... A2UI_VERSION=v0.9 A2UI_FORMAT=direct_json yarn workspace @a2ui/agent-restaurant-node run start
```

`STUB_LLM=true` takes precedence over a configured key, which is useful for predictable testing without consuming API quota:

```bash
STUB_LLM=true GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

### Configuration and environment variables

The server checks environment variables before binding to the port:

- `A2UI_VERSION`: `'v0.9'` or `'v1.0'` (default: `'v1.0'`).
- `A2UI_FORMAT`: `'direct_json'` or `'express'` (default: `'direct_json'`).
- `MODEL_NAME`: Gemini model identifier (default: `'gemini-2.5-flash'`).
- `PORT`: HTTP port to bind (default: `10002`).
- `GEMINI_API_KEY`: Required when `STUB_LLM` is not `'true'`.
- `STUB_LLM`: Set to `'true'` to use canned example responses.

If `A2UI_VERSION` or `A2UI_FORMAT` contains an invalid value, or if `GEMINI_API_KEY` is missing when `STUB_LLM=true` is not passed, the process prints a clear error message and exits with status 1.

Endpoints provided by the server:

- Agent card: `http://localhost:10002/.well-known/agent-card.json`
- JSON-RPC: `http://localhost:10002/a2a/json-rpc`
- REST: `http://localhost:10002/v1`
- Static images: `http://localhost:10002/static/` (served from `samples/agent/adk/restaurant_finder/images`)

## Client compatibility

### Visual clients (v0.9)

Start the agent with `A2UI_VERSION=v0.9`, in either format, and then start one of the sample clients. Build the shared packages first with `yarn install && yarn build:all` from the repository root, as each client's README describes.

- Lit shell (`samples/client/lit/shell`): run `yarn dev`. The browser calls the agent directly, which is why the agent allows CORS from any `http://localhost:<port>` origin.
- React shell (`samples/client/react/shell`): run `yarn dev`, then open port 5003.
- Angular (`samples/client/angular`): run `yarn start restaurant`, then open port 4200.

All three connect to `http://localhost:10002` and request the `https://a2ui.org/a2a-extension/a2ui/v0.9` extension. Restaurant data only exists for New York, so ask for something like "top 5 chinese restaurants in New York". The images are served from the Python sample's `images` folder.

### Headless operation (v1.0)

No client in this repository renders v1.0 yet, so with `A2UI_VERSION=v1.0` (the default) you read the output from the JSON-RPC stream, for example with the curl commands below.

## Driving a turn with curl

Send a `message/stream` request to the JSON-RPC endpoint. Pass the `X-A2A-Extensions` header corresponding to the configured version:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
  -H 'X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v1.0' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "m1",
        "role": "user",
        "parts": [{"kind": "text", "text": "top 5 chinese restaurants in New York"}]
      }
    }
  }'
```

If the client requests an A2UI extension for a different version than configured, the task fails with an informative error message. If no A2UI extension is requested, the agent logs a warning and answers with the configured version anyway. The Python sample answers with plain text in that case.

A turn emits non-final `status-update` events with `status.state: 'working'` and parts in `status.message.parts`, ending in a final `status-update` event with `status.state: 'input-required'` and `final: true`.

### Multi-step conversation

The agent translates client UI events into queries for subsequent turns.

The first turn is the request above. Reuse the `contextId` it returns in the next requests.

**Step 2: User selects a restaurant.** When the user selects a restaurant in the UI, the client sends a `book_restaurant` action:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
  -H 'X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v1.0' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "m2",
        "role": "user",
        "contextId": "PASTE_CONTEXT_ID_FROM_STEP_1",
        "parts": [{
          "kind": "data",
          "data": {
            "version": "v1.0",
            "action": {
              "name": "book_restaurant",
              "surfaceId": "restaurants",
              "sourceComponentId": "book-btn-1",
              "timestamp": "2026-01-01T19:00:00Z",
              "context": {
                "restaurantName": "Sushi Tetsu",
                "address": "12 Jerusalem Passage"
              }
            }
          }
        }]
      }
    }
  }'
```

**Step 3: User submits the booking.** When the user submits the booking form, the client sends a `submit_booking` action:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
  -H 'X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v1.0' \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "m3",
        "role": "user",
        "contextId": "PASTE_CONTEXT_ID_FROM_STEP_1",
        "parts": [{
          "kind": "data",
          "data": {
            "version": "v1.0",
            "action": {
              "name": "submit_booking",
              "surfaceId": "booking",
              "sourceComponentId": "submit-btn",
              "timestamp": "2026-01-01T19:05:00Z",
              "context": {
                "restaurantName": "Sushi Tetsu",
                "partySize": "2",
                "reservationTime": "19:30",
                "dietary": "None"
              }
            }
          }
        }]
      }
    }
  }'
```

Submitting a booking marks the final task state as `completed`. In stub mode, `book_restaurant` returns the `booking_form` example, `submit_booking` returns the `confirmation` example, and other queries return `single_column_list`.

## Why not the Agent Development Kit?

The Python counterpart of this sample uses ADK. While `@google/adk` exists for JavaScript, this sample uses `@google/genai` directly.

`@google/adk@2.1.0` requires `zod ^4.2.1`. This repository pins `zod` to `^3.25.76` because `@a2ui/web_core` uses Zod 3 APIs. The v1.0 component catalog that `@a2ui/agent` consumes is a tree of Zod 3 `ZodObject` instances that web_core converts to JSON Schema for model prompts.

Under that pin, ADK fails at import time with `z.object(...).loose is not a function`. Using `@google/genai` avoids this conflict because it has no Zod dependency.

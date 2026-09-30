# A2UI Node restaurant agent sample

This is a restaurant-finder agent that serves the A2A protocol over HTTP on port 10002. It calls Gemini through `@google/genai` and generates A2UI payloads through the `@a2ui/agent` SDK.

The agent answers each request in the A2UI version the renderer asks for:

- A request whose metadata carries `a2uiRendererCapabilities` with a `"v1.0"` entry gets v1.0 messages.
- A request whose metadata carries `a2uiClientCapabilities` with a `"v0.9"` entry gets v0.9 messages.
- A request with no capabilities gets v0.9, which every sample client in this repository renders.

The catalogs come from the same entry (`supportedCatalogIds`). A request that names only versions the agent does not serve, or only catalogs it does not have, ends with a `failed` task. Every A2UI data part has the MIME type `application/a2ui+json`.

The model writes A2UI in one of two formats, chosen with `A2UI_FORMAT`: Direct JSON (`direct_json`, the default) or the Express DSL (`express`), which the agent compiles to JSON before sending.

## Running the sample

Build the package first. The project compiles to `dist/src/`, and `yarn start` executes that output:

```bash
yarn workspace @a2ui/agent-restaurant-node run build
```

### Without an API key (stub mode)

Use `STUB_LLM=true` to serve canned responses from the example files:

```bash
# Direct JSON (default)
STUB_LLM=true yarn workspace @a2ui/agent-restaurant-node run start

# Express
STUB_LLM=true A2UI_FORMAT=express yarn workspace @a2ui/agent-restaurant-node run start
```

Each stub response starts with an extra surface, `stub-notice`, holding one `Text` component that says no model was called, followed by the example for the request. The agent card name ends in "(stub)". The notice messages are in `stub_notice/<version>.json`.

The stub writes the notice and example as the model would in the configured format and cuts the text into four chunks, so it goes through the same streaming parser and validation as a live response.

### With a real model

Provide a `GEMINI_API_KEY`:

```bash
cp .env.example .env    # add your GEMINI_API_KEY
GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

`STUB_LLM=true` takes precedence over a configured key, which is useful for predictable testing without consuming API quota:

```bash
STUB_LLM=true GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

### Configuration and environment variables

The server checks environment variables before binding to the port:

- `A2UI_FORMAT`: `'direct_json'` or `'express'` (default: `'direct_json'`).
- `MODEL_NAME`: Gemini model identifier (default: `'gemini-3.6-flash'`).
- `PORT`: HTTP port to bind (default: `10002`).
- `GEMINI_API_KEY`: Required when `STUB_LLM` is not `'true'`.
- `STUB_LLM`: Set to `'true'` to use canned example responses.

If `A2UI_FORMAT` or `STUB_LLM` contains an invalid value, or if `GEMINI_API_KEY` is missing when `STUB_LLM=true` is not passed, the process prints an error message and exits with status 1.

Endpoints provided by the server:

- Agent card: `http://localhost:10002/.well-known/agent-card.json`
- JSON-RPC: `http://localhost:10002/a2a/json-rpc`
- Static images: `http://localhost:10002/static/` (served from `samples/agent/adk/restaurant_finder/images`)

## How it works

`src/index.ts` builds the Express app: CORS, the static images, and the A2A agent card and JSON-RPC routes from `@a2a-js/sdk`. `createApp()` builds everything without listening, which is what the tests use, and `main()` listens. Configuration is read in `src/config.ts`.

`@a2ui/agent` bundles no catalog, so `createApp()` first loads the basic catalog of each served version from this repository (`src/catalogs.ts`): `specification/v0_9/catalogs/basic/catalog.json` for v0.9 and `catalogs/basic/v1/catalog.json` for v1.0.

`RestaurantExecutor` in `src/agent.ts` is the entry point: the A2A SDK calls its `execute` method for each message, and its `run` method answers the turn in these steps:

1. Pick the A2UI version and catalogs from the renderer capabilities in the message metadata (`src/pick_a2ui.ts`). The versions the agent serves are listed in `src/versions.ts`, and nothing else in the sample depends on a version string.
2. Turn the message, or the UI action it carries, into a query for the model (`src/user_query.ts`).
3. Stream the model's text for the turn from the backend (`src/model.ts`): `GeminiBackend` keeps one chat per conversation and answers `get_restaurants` tool calls (`src/tools.ts`); `StubBackend` returns the canned response. In Direct JSON, the text goes through the `@a2ui/agent` stream processor as it arrives.
4. Publish the A2UI messages as `working` status updates. The A2A details, one `application/a2ui+json` data part per A2UI message and the task's status events, live in `src/a2a.ts`.
5. Validate the full text with the `@a2ui/agent` processor for the picked version and catalogs. If it fails, ask the model once more with the error, as the Python sample does.
6. End the turn with a final `input-required` status, or `completed` after a booking is submitted.

The system prompt (`src/prompt.ts`) is the agent's role and UI rules followed by the `@a2ui/agent` prompt snippet, which holds the format's rules, the catalog schemas and the examples (`examples/<version>/`, loaded by `src/examples.ts`). It is the same for both backends.

## Client compatibility

### Visual clients (v0.9)

Start the agent, in either format, and then start one of the sample clients. Build the shared packages first with `yarn install && yarn build:all` from the repository root, as each client's README describes.

- Lit shell (`samples/client/lit/shell`): run `yarn dev`. The browser calls the agent directly, which is why the agent allows CORS from any `http://localhost:<port>` origin.
- React shell (`samples/client/react/shell`): run `yarn dev`, then open port 5003.
- Angular (`samples/client/angular`): run `yarn start restaurant`, then open port 4200.

All three connect to `http://localhost:10002` and send no renderer capabilities, so they get v0.9. Restaurant data only exists for New York, so ask for something like "top 5 chinese restaurants in New York". The images are served from the Python sample's `images` folder.

### Headless operation (v1.0)

No client in this repository renders v1.0 yet. To get v1.0, send `a2uiRendererCapabilities` in the message metadata and read the output from the JSON-RPC stream, as in the curl commands below.

## Driving a turn with curl

Send a `message/stream` request to the JSON-RPC endpoint. This one asks for v1.0; leave out `metadata` to get v0.9:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "m1",
        "role": "user",
        "parts": [{"kind": "text", "text": "top 5 chinese restaurants in New York"}],
        "metadata": {
          "a2uiRendererCapabilities": {
            "v1.0": {
              "supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"]
            }
          }
        }
      }
    }
  }'
```

A turn emits non-final `status-update` events with `status.state: 'working'` and parts in `status.message.parts`, ending in a final `status-update` event with `status.state: 'input-required'` and `final: true`.

To get every part in the final status instead, add a data part `{"kind": "data", "data": {"useStreaming": false}}` to the message. The lit client does this with `message/send`.

### Multi-step conversation

The agent translates client UI events into queries for subsequent turns. Each request carries its own capabilities, so send the same `metadata` in every turn.

The first turn is the request above. Reuse the `contextId` it returns in the next requests.

**Step 2: User selects a restaurant.** When the user selects a restaurant in the UI, the client sends a `book_restaurant` action:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
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
        }],
        "metadata": {
          "a2uiRendererCapabilities": {
            "v1.0": {
              "supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"]
            }
          }
        }
      }
    }
  }'
```

**Step 3: User submits the booking.** When the user submits the booking form, the client sends a `submit_booking` action:

```bash
curl -N -X POST http://localhost:10002/a2a/json-rpc \
  -H 'Content-Type: application/json' \
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
        }],
        "metadata": {
          "a2uiRendererCapabilities": {
            "v1.0": {
              "supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"]
            }
          }
        }
      }
    }
  }'
```

Submitting a booking marks the final task state as `completed`. In stub mode, `book_restaurant` returns the `booking_form` example, `submit_booking` returns the `confirmation` example, and other queries return `single_column_list`.

## Tests

`yarn workspace @a2ui/agent-restaurant-node run test` checks that every example and stub notice validates for each version and format, and drives the stub agent over JSON-RPC in-process. None of the tests call a model. There is no live end-to-end test for the Node sample; the daily Flutter end-to-end test runs against the Python sample only.

## A2A extension activation

A2A lets a client activate the A2UI extension for a request. The A2UI extension specification makes activation optional, and this sample does not advertise or activate it; it reads the renderer capabilities from the message metadata instead. See the [A2UI extension specification](../../../../specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md).

## Why not the Agent Development Kit?

The Python counterpart of this sample uses ADK. While `@google/adk` exists for JavaScript, this sample uses `@google/genai` directly.

`@google/adk@2.1.0` requires `zod ^4.2.1`. This repository pins `zod` to `^3.25.76` because `@a2ui/web_core` uses Zod 3 APIs. The v1.0 component catalog that `@a2ui/agent` consumes is a tree of Zod 3 `ZodObject` instances that web_core converts to JSON Schema for model prompts.

Under that pin, ADK fails at import time with `z.object(...).loose is not a function`. Using `@google/genai` avoids this conflict because it has no Zod dependency.

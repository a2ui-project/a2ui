# A2UI Node Restaurant Agent Sample

This is a minimal restaurant-finder agent that serves the A2A protocol over HTTP on port 10002. It calls Gemini through `@google/genai` and emits A2UI v1.0 payloads through the `@a2ui/agent` SDK.

## Running the sample

Build first. The sample compiles to `dist/src/`, and `yarn start` runs that output:

```bash
yarn workspace @a2ui/agent-restaurant-node run build
```

### Without an API key

With no `GEMINI_API_KEY` set, the agent automatically serves a canned A2UI response instead of
calling the model. No extra flag is needed:

```bash
yarn workspace @a2ui/agent-restaurant-node run start
```

The stub is deliberately delivered in four mid-token chunks, so the streaming healer in
`DirectJsonStreamProcessorImpl` is exercised on the same code path the real model uses. This is
the quickest way to confirm the server, the A2A wiring and the A2UI stream all work.

### With a real model

```bash
cp .env.example .env    # then add your GEMINI_API_KEY
GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

### Forcing the stub while a key is present

`STUB_LLM=true` overrides a configured key, which is useful for deterministic runs without
spending quota:

```bash
STUB_LLM=true GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

The selection logic is `STUB_LLM === 'true' || !GEMINI_API_KEY`, so the flag is redundant when
no key is set and only meaningful as an override.

> [!WARNING]
> The fallback is silent. An unset, empty or misspelled `GEMINI_API_KEY` produces canned output
> rather than an error, so check the server log for `Using stub LLM response...` if you are
> unsure which path ran.

Override the port with `PORT`. Once running:

- Agent card: `http://localhost:10002/.well-known/agent-card.json`
- JSON-RPC: `http://localhost:10002/a2a/json-rpc`
- REST: `http://localhost:10002/v1`

### Driving a turn

Send `message/stream` to the JSON-RPC endpoint and read the SSE response:

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
        "parts": [{"kind": "text", "text": "find me sushi in Soho"}]
      }
    }
  }'
```

A turn produces:

```
task  ->  status-update(working)  ->  message(data)
```

The `message` event carries a `data` part holding an array of A2UI v1.0 messages. Note the
`contextId` on those events — you need it to continue the conversation.

> [!NOTE]
> `@a2a-js/sdk` closes the event stream as soon as the first `message` event is emitted, so the
> terminal `completed`/`failed` status-update this agent publishes is not delivered to the
> client. Post-hoc A2UI validation failures surface in the server log rather than the stream.
> With a real model this also means only the first streamed chunk reaches the client. See
> `KNOWN_GAPS.md`.

### A multi-step conversation

The Python sample walks a user from a restaurant list, through a booking form, to a
confirmation. The same flow works here: the renderer reports a user interaction as an A2UI
action, and the agent translates it into a query for the next turn.

Reuse the `contextId` from step 1 in every later request — history is keyed by it.

**Step 2 — the user picks a restaurant.** A renderer would send this when a `Button` with an
`action.event` named `book_restaurant` is pressed:

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
        }]
      }
    }
  }'
```

**Step 3 — the user submits the booking form.** Same shape, with the form values in `context`:

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
                "partySize": 2,
                "reservationTime": "19:30"
              }
            }
          }
        }]
      }
    }
  }'
```

`name`, `surfaceId`, `sourceComponentId`, `timestamp` and `context` are all required by
`ActionMessageSchema`; `userMessage` and `metadata` are optional. Unlike the Python sample,
which special-cases `book_restaurant` and `submit_booking` by name, this agent translates any
action generically into `User submitted an action: <name> with data: <json>`.

> [!IMPORTANT]
> In stub mode all three steps return the **same** canned payload, because the stub ignores the
> query entirely. The steps still prove the A2A wiring, action parsing and per-turn processor
> recycling, but you need a real `GEMINI_API_KEY` to see the conversation actually progress from
> a list to a booking form to a confirmation.

## No visual client yet

**There is currently no v1.0 renderer in this repository.** The Lit, React and Angular
renderers all stop at v0.9, while this sample emits v1.0, so none of the existing sample
clients can display its output.

The agent is therefore verified headlessly: run it and read the A2A stream directly. Once a
v1.0 renderer lands, this sample should be connectable with no changes on the agent side, as
it already serves the port and protocol the clients expect.

## Why not the Agent Development Kit?

The Python counterpart of this sample is built on ADK, and `@google/adk` does exist for
JavaScript. We deliberately use `@google/genai` directly instead.

`@google/adk@2.1.0` requires **`zod ^4.2.1`**. This monorepo pins `zod` to `^3.25.76` through a
root `resolutions` entry, because `@a2ui/web_core` is built on Zod 3 APIs. That pin is not
incidental: the v1.0 component catalog that `@a2ui/agent` consumes is a tree of Zod 3
`ZodObject`s, and web_core converts them to JSON Schema to build the model prompt. So the Zod
major version is load-bearing for the agent-side code path, not just a transitive detail.

With the pin in place, ADK fails at import time with `z.object(...).loose is not a function`
(`.loose()` being the Zod 4 replacement for Zod 3's `.passthrough()`). Getting ADK working
would mean either relaxing a deliberate monorepo-wide pin or carrying two Zod majors and
keeping them from ever meeting — a lot of fragility to add to a sample.

`@google/genai` has no Zod dependency at all, so it sidesteps the conflict. We lose the
structural parallel with the Python sample, but the A2UI flow is identical.

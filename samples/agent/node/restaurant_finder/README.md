# A2UI Node Restaurant Agent Sample

This is a minimal restaurant-finder agent that serves the A2A protocol over HTTP on port 10002. It calls Gemini through `@google/genai` and emits A2UI v1.0 payloads through the `@a2ui/agent` SDK.

## Running the sample

Build first. The sample compiles to `dist/src/`, and `yarn start` runs that output:

```bash
yarn workspace @a2ui/agent-restaurant-node run build
```

### Without an API key

Set `STUB_LLM=true` to replace the model call with a canned A2UI response. The stub is
deliberately delivered in four mid-token chunks, so the streaming healer in
`DirectJsonStreamProcessorImpl` is exercised on the same code path the real model uses. This is
the quickest way to confirm the server, the A2A wiring and the A2UI stream all work.

```bash
STUB_LLM=true yarn workspace @a2ui/agent-restaurant-node run start
```

### With a real model

```bash
cp .env.example .env    # then add your GEMINI_API_KEY
GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start
```

The agent falls back to the stub if `GEMINI_API_KEY` is unset, so a missing key produces canned
output rather than an error.

Override the port with `PORT`. Once running:

- Agent card: `http://localhost:10002/.well-known/agent-card.json`
- JSON-RPC: `http://localhost:10002/a2a/json-rpc`
- REST: `http://localhost:10002/v1`

### Driving a turn

Send `message/stream` to the JSON-RPC endpoint and read the SSE response. A turn produces:

```
task  ->  status-update(working)  ->  message(data)
```

The `message` event carries a `data` part holding an array of A2UI v1.0 messages. Passing the
same `contextId` on a later request continues the conversation; history is keyed by `contextId`.

> Note: `@a2a-js/sdk` closes the event stream as soon as the first `message` event is emitted,
> so the terminal `completed`/`failed` status-update this agent publishes is not delivered to
> the client. Post-hoc A2UI validation failures surface in the server log rather than the
> stream.

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

# End-to-end test infrastructure

This directory holds what the live-pair end-to-end tests need and nothing an application would copy. A live pair is a real renderer (a web shell driven by Playwright, or the Flutter example) talking over A2A to a test agent that replays a scripted scenario instead of calling a model. The scenarios themselves live in [`conformance/e2e/`](../conformance/e2e/), where the agent-half and renderer-half conformance runners also read them; this directory adds the pieces that put a real transport and a real UI between the two halves.

## Why this is not `samples/`

The samples show developers how to build an agent or a client. The code here exists to exercise the SDKs under test conditions: a model that answers from a YAML file, delays that can be dialed in to observe streaming and pending states, a request log endpoint, and agent functions that are made to fail. Keeping it apart from `samples/` keeps those test hooks out of the code people learn from, and lets the e2e packages depend on test-only tooling (Playwright, YAML fixtures) that samples should not carry.

## Layout

- `agents/python/`: the Python test agent (`a2ui-e2e-agent`), an ADK `LlmAgent` under ADK's `A2aAgentExecutor` with the A2UI converters from `a2ui-adk` and `a2ui-a2a`. Its model is `HubScriptedLlm`.
- `agents/typescript/`: the TypeScript test agent (`@a2ui/e2e-agent-ts`), an `@a2a-js/sdk` executor built on `@a2ui/agent`. Its model is `ScriptedModel`.

Both agents serve the same scenarios, select them by the same rules, and expose the same `GET /e2e/log` endpoint, so a shell test can run against either.

## How a test agent picks a scenario

A test agent keeps nothing between requests. Each reply is derived from what the request holds, the way a real model's would be:

1. **Scenario**: the scenario whose turn 0 `userText` equals the first user text of the conversation. Whitespace runs are collapsed before comparing. A text no scenario opens with gets a short text reply saying so.
2. **Protocol version**: read from the catalog id the agent's instruction names (`.../specification/v1_0/...` or `.../v0_9/...`), which the agent writes there for the catalogs the renderer's capabilities resolved to. A v1.0 renderer gets the scenario file written for `"1.0"`; a v0.9 renderer gets the scenario's `"0.9.1"` copy when one exists, and a text reply naming the versions that do exist when not.
3. **Turn**: the position of the latest user content among the user contents that carry text. A turn with `userText: null` therefore starts only when the renderer's message for the previous turn's `expectOutbound` (an `action` or `error`, formatted for the model by the SDK's inbound parser) has arrived. A request whose latest content carries no text, such as one holding only RPC parts, gets no model reply.
4. **Format**: the server is started with `--format direct_json` or `--format express`, and streams that format's `modelChunks` through the matching parser. When the renderer sent no capabilities for a turn, the instruction holds no A2UI snippet and the agent answers with the turn's text parts only, so a renderer that withdraws capabilities gets text for that turn.

`callAgentFunction` messages never reach the model. The v1.0 catalog the agents serve declares `lookupPrice(sku)` and `failingLookup()` as agent functions; the first answers after `--rpc-delay-ms`, the second always fails.

## Running a pair locally

Start one agent, then point a shell at it. Both agents take the same options: `--port`, `--format`, `--scenario-dir`, `--chunk-delay-ms` and `--rpc-delay-ms`.

Python agent (from the repository root, after `uv sync --all-packages`):

```sh
uv run python -m a2ui_e2e_agent --port 10010 --format direct_json --chunk-delay-ms 50
```

TypeScript agent (after `yarn install` and a build of the TypeScript packages):

```sh
yarn workspace @a2ui/e2e-agent-ts build
yarn workspace @a2ui/e2e-agent-ts start --port 10011 --format express
```

Either agent then answers A2A JSON-RPC at `http://localhost:<port>/`, serves its card at `/.well-known/agent-card.json`, and returns the model requests it has seen, as JSON, at `GET /e2e/log` (`DELETE /e2e/log` clears it). Each record holds the system instruction, the user contents as the model saw them, the scenario and turn it resolved to, and the number of chunks it streamed.

## Testing the agents on their own

Each agent has an in-process test that drives it over JSON-RPC for every scenario and format: turn 0 with capabilities must stream exactly the scenario's `a2ui` wire messages, turn 0 without capabilities must answer with text only, later turns must replay after their outbound message, and agent functions must answer without a model turn.

```sh
uv run pytest e2e/agents/python/tests -q
yarn workspace @a2ui/e2e-agent-ts test
```

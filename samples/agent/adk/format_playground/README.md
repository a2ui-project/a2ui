# A2UI format playground

A chat-style sample agent for exploring A2UI inference formats and tool rendering workflows. You can interact with the agent in chat mode (`decision`, `express`, or `direct`) or try `tool` mode where tool execution data is rendered directly via the decision model.

In chat mode, the agent works in two stages. Stage 1 is a single model call that turns your request into a decision block (`intent`, `payload`, optional `layout`, `title`, `summary`), which is the same structure the `decision` inference format publishes to agents. Stage 2 renders it: `decision` compiles the block with the decision model with zero additional model calls; `express` and `direct` make a second model call using that format's prompt and validate the reply. Running `/compare` renders all three modes from one payload for direct comparison.

In `tool` mode, the language model is provided domain tools (`get_host_health`, `get_resort`, `get_transfer_quote`, `get_playback_settings`, `get_order_details`, `get_deploy_runbook`). The tool output is passed directly to the decision synthesizer without asking the language model to write UI code. You can also run any tool directly with zero LLM calls via the example buttons under the input bar or `/tool <name>`.

Every turn ends with a footer card naming the mode, the decision backend and its model id, the number of model calls, the latency, token counts, and archetype or path details, including why a fallback ran. When opened through the Lit shell (`?app=playground`), a split-screen pipeline inspector replaces the inline footer and `/compare` summary cards with an interactive four-stage waterfall.

## Prerequisites

- Python (see `requires-python` in `pyproject.toml`) and [uv](https://docs.astral.sh/uv/)
- Node and Yarn for the sample client
- A Gemini API key (`GEMINI_API_KEY`), or Vertex AI configured through `GOOGLE_GENAI_USE_VERTEXAI=TRUE`
- Optional: `MODEL_NAME` to pick a model (defaults to `gemini-3.6-flash`)

## Running the agent

Use [`run.sh`](run.sh) with a preset name (`mock`, `jev`, `gemini`, `express`, `direct`, or `tool`):

```bash
cd samples/agent/adk/format_playground
export GEMINI_API_KEY=...

./run.sh mock       # deterministic offline heuristic (default)
./run.sh gemini     # Google Gemini Decisions API (/v1beta/decisions, gemini-decision-1)
JEV_API_KEY=... ./run.sh jev   # remote TypeSafe Jev (/v1/systemone)
./run.sh express    # start in express render mode
./run.sh direct     # start in direct render mode
./run.sh tool       # start in tool mode (ADK tool call with zero UI model calls)
```

Or run the package directly with `uv`:

```bash
A2UI_DECISION_BACKEND=mock uv run . --mode tool
```

The startup log names the initial mode, the model, the decision backend, and the
URL (`http://localhost:10010` by default; `--port` changes it).

### Decision backends

The decision backend is chosen by `A2UI_DECISION_BACKEND` and the other
`A2UI_DECISION_*` variables, as `create_decision_backend()` documents
them. The resolved backend is shown in `/help` and in every footer.

| Backend             | Setup                                                                            | What to expect                                                                                     |
| :------------------ | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `mock`              | Nothing. Runs offline.                                                           | A deterministic keyword heuristic. Layouts are plain; use it to check the wiring, not the quality. |
| `jev` / `systemone` | `A2UI_DECISION_BACKEND=jev A2UI_DECISION_URL=https://... A2UI_DECISION_AUTH=adc` | Remote decision model over HTTP (`/v1/systemone`).                                                 |
| `gemini`            | `A2UI_DECISION_BACKEND=gemini GEMINI_API_KEY=...`                                | Google Gemini Decisions API (`/v1beta/decisions`, model `gemini-decision-1`).                      |
| `step0`             | `A2UI_DECISION_BACKEND=step0 A2UI_DECISION_URL=https://.../v1/completions`       | Step-0 single-token logprob scoring over an OpenAI-compatible completions endpoint.                |

## Running the client

The Lit sample shell talks to any A2A agent and already knows this one:

```bash
cd samples/client/lit/shell
yarn build    # the first build also builds typescript/renderers/lit, so it is slow
yarn dev
```

Open `http://localhost:<port>/?app=playground` with the port Vite prints.

Three things about this client are worth knowing. It renders A2UI surfaces
only, so the agent's text replies (`/help`, the footer, `/trace`) arrive as
small cards. The playground config sets `clearSurfacesOnResponse: false` and
`inspector: true`, keeping surfaces on screen while `<playground-inspector>`
shows the turn trace on the right. The client persists the A2A `contextId`
across turns so `PlanCache` hits on repeated payload shapes (`Reset session`
in the inspector clears `contextId`).

`decision` and `tool` renders
reuse one `main` surface and update it in place from turn to turn (or recreate
it when a block sets `replace`), while `express`, `direct`, and `/compare`
renders get a new surface per turn. The `decision` and `tool` modes need a
client that speaks A2UI v1.0. And if you paste a message that is a bare JSON
object, the shell sends it as data rather than text; the agent uses it verbatim
as the payload, which is the quickest way to try your own data shapes.

### Split-screen pipeline inspector

When the client sends `a2uiPlaygroundInspector: true` in A2A request metadata,
the server omits the inline `turn-N-*-footer` and `turn-N-compare` cards and
attaches an in-band `application/x-a2ui-playground-trace+json` `DataPart` to the
response. The `<playground-inspector>` component renders that trace as a
four-stage collapsible waterfall:

1. `1. Block Input` shows how the `DecisionBlock` was produced (Stage 1 LLM call,
   direct `/tool` command, tool call, or pasted JSON) along with its `intent`,
   `surfaceId`, `operation`, `layout`, `mutablePaths`, `actions`, and `payload`.
2. `2. Decision Input` (collapsed initially) shows the backend, model id,
   `PlanCache` hit status, `shapeSignature`, decision context JSON, and
   planner question batch (with pruned questions and `Raw Wire JSON`).
3. `3. Decision Output & Plan` shows the chosen synthesis stage, confidence, fit
   score, per-question probability bars with threshold ticks, and the resulting
   `LayoutPlan` block tree (or raw backend answers).
4. `4. A2UI JSON` shows the synthesized A2UI v1.0 wire messages with a toggle to
   view the decompiled A2UI Express source. On `/compare` turns, a mode switcher
   in the inspector header lets you inspect `decision`, `express`, and `direct`
   side by side.

## Commands

| Command                                                                      | Effect                                                                                 |
| :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `/mode decision` \| `express` \| `direct` \| `tool`                          | Picks how the next requests render.                                                    |
| `/backend jev` \| `gemini` \| `mock`                                         | Switches the active decision model backend at runtime; a backend name is required.     |
| `/tool host` \| `resort` \| `transfer` \| `settings` \| `order` \| `runbook` | Runs a specific tool directly through the decision model (0 LLM calls).                |
| `/compare`                                                                   | Renders the next request through all three chat modes from the same data.              |
| `/trace`                                                                     | Shows the planner's questions, answers, and thresholds for the last `decision` render. |
| `/rate <mode> [comment]`                                                     | Records a preference vote for the last rendered turn.                                  |
| `/ratings`                                                                   | Summarizes recorded mode preference win counts from the ratings log.                   |
| `/help`                                                                      | Shows the active settings and these commands.                                          |

Anything else is a render request. A message that contains a JSON object or
array uses it verbatim as the payload. Buttons come from the block's `actions`
map, so pressing one sends its action id, its surface, and the values it
bound (form fields, an item's id) back to stage 1, and forms round-trip.

## What the footer tells you

```text
decision · jev (jev-1.14.0) · 1 LLM call · decision 412 ms (total 1.8 s) · 412 in / 96 out tokens · surface update_root · path: decision model · archetype detail (0.82) · 4 blocks
express · llm · 2 LLM calls · 4.1 s · 5,210 in / 318 out tokens
direct · llm · 2 LLM calls · 5.6 s · 12,044 in / 890 out tokens
```

The `decision` row counts only the stage-1 call; the other two add the format's
own call. When stage 2 had to retry an invalid reply the footer says
`fallback: validation_retry`. When the decision model abstained, the path names
the fallback that rendered the surface and the reason, for example
`path: fallback (fallback_facts) · decision model abstained: no_family`.
`surface update_root` or `surface replace` appears when a turn updated an
existing surface instead of creating one.

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent, including its AgentCard, messages, artifacts, and task statuses, should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures, such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling, to protect their systems and users.

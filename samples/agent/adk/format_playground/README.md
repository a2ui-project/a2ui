# A2UI format playground

A chat-style sample agent for trying the three A2UI inference formats on the
same request. Type "give me an address entry form" or "show my stock
portfolio" and the surface is rendered through the mode you picked:
`decision`, `express`, or `direct`.

The agent works in two stages. Stage 1 is one model call that turns your
request into a decision block (`intent`, `payload`, optional `layout`), the
same block the `decision` inference format publishes to agents. Stage 2
renders it: `decision` compiles the block with the local decision model and
makes no further model call; `express` and `direct` make a second model call
with that format's own prompt and the same intent and payload, then validate
the reply. `/compare` renders all three from one payload, so the comparison is
apples to apples.

Every turn ends with a footer card that names the mode, the decision backend,
how many model calls it took, the latency, the token counts, and (for
`decision`) the archetype and its confidence.

## Prerequisites

- Python (see `requires-python` in `pyproject.toml`) and [uv](https://docs.astral.sh/uv/)
- Node and Yarn for the sample client
- A Gemini API key (`GEMINI_API_KEY`), or Vertex AI configured through
  `GOOGLE_GENAI_USE_VERTEXAI=TRUE`
- Optional: `MODEL_NAME` to pick a model (defaults to `gemini-3.6-flash`)

## Running the agent

Use [`run.sh`](run.sh) with a preset name (`local`, `mock`, `jev`, `gev`,
`express`, or `direct`):

```bash
cd samples/agent/adk/format_playground
export GEMINI_API_KEY=...

./run.sh local      # in-process ONNX cross-encoder (auto-installs local deps)
./run.sh mock       # deterministic offline heuristic
./run.sh gev        # starts local Gev server (vertex/decision-gemma) and connects to it
JEV_API_KEY=... ./run.sh jev   # remote TypeSafe Jev (/v1/systemone)
./run.sh express    # start in express render mode
./run.sh direct     # start in direct render mode
```

Or run the package directly with `uv`:

```bash
A2UI_DECISION_BACKEND=mock uv run . --mode decision
```

The startup log names the initial mode, the model, the decision backend, and the
URL (`http://localhost:10010` by default; `--port` changes it).

### Decision backends

The decision backend is chosen by `A2UI_DECISION_BACKEND` and the other
`A2UI_DECISION_*` variables, exactly as `create_decision_backend()` documents
them. The resolved backend is shown in `/help` and in every footer.

| Backend | Setup | What to expect |
| :-- | :-- | :-- |
| `mock` | Nothing. Runs offline. | A deterministic keyword heuristic. Layouts are plain; use it to check the wiring, not the quality. |
| `local` | `uv sync --package a2ui-format-playground --extra local`, then `A2UI_DECISION_BACKEND=local`. The first run downloads the cross-encoder model. | The real in-process experience, no network at render time. |
| `jev` / `systemone` | `A2UI_DECISION_BACKEND=jev A2UI_DECISION_URL=https://... A2UI_DECISION_AUTH=adc` | Remote decision model over HTTP. |

## Running the client

The Lit sample shell talks to any A2A agent and already knows this one:

```bash
cd samples/client/lit/shell
yarn build    # the first build also builds typescript/renderers/lit, so it is slow
yarn dev
```

Open `http://localhost:<port>/?app=playground` with the port Vite prints.

Two things about this client are worth knowing. It renders A2UI surfaces only
and clears them before each reply, so the agent's text replies (`/help`, the
footer, `/trace`) arrive as small cards, and earlier turns do not stay on
screen. And if you paste a message that is a bare JSON object, the shell sends
it as data rather than text; the agent uses it verbatim as the payload, which is
the quickest way to try your own data shapes.

## Commands

| Command | Effect |
| :-- | :-- |
| `/mode decision` \| `express` \| `direct` | Picks how the next requests render. |
| `/compare` | Renders the next request through all three modes from the same data. |
| `/trace` | Shows the planner's questions, answers, and thresholds for the last `decision` render. |
| `/help` | Shows the active settings and these commands. |

Anything else is a render request. A message that contains a JSON object or
array uses it verbatim as the payload. Pressing a button on a rendered surface
sends the action back to stage 1 as text, so forms round-trip.

## What the footer tells you

```text
decision · mock · 1 LLM call · 1.8 s · 412 in / 96 out tokens · archetype detail (0.82) · 4 blocks
express · llm · 2 LLM calls · 4.1 s · 5,210 in / 318 out tokens
direct · llm · 2 LLM calls · 5.6 s · 12,044 in / 890 out tokens
```

The `decision` row counts only the stage-1 call; the other two add the format's
own call. When stage 2 had to retry an invalid reply the footer says
`fallback: validation_retry`; when the decision planner abstained and rendered
the fallback card it says `fallback: fallback_card`.

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent, including its AgentCard, messages, artifacts, and task statuses, should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures, such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling, to protect their systems and users.

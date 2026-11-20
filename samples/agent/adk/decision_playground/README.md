# A2UI decision playground

A chat-style sample agent for trying out the standalone A2UI decision-model capabilities interactively:

- `cascade`: routes each request through `DecisionCascadeRouter` across `TEXT_ONLY`, `TEMPLATE`, and `PRUNED_EXPRESS` tiers with an optional latency budget (`/budget <ms>`).
- `binder`: binds structured tool outputs (`get_host_health`, `get_resort`, `get_transfer_quote`, `get_order_details`) to templates via `ToolPointerBinder` with zero UI LLM calls and automatic redaction of secret fields such as `apiKey`.
- `rpc`: renders interactive forms whose submit buttons invoke `callAgentFunction` against `build_predicate_agent_functions` (guarded by `SessionRateLimiter`) and return `agentFunctionResponse` verdicts inline without clearing the form surface.
- `express` and `direct`: LLM baselines using `ExpressFormat` and `DirectJsonFormat`, plus `/compare` to run `cascade`, `express`, and `direct` side by side on the same prompt.

When opened in the Lit shell (`?app=playground`), clickable `Mode` and `Backend` pills appear in the header, and the split-screen `<playground-inspector>` renders a four-stage waterfall of the decision batch, per-question probabilities, and synthesized A2UI v1.0 wire messages.

## Prerequisites

- Python (see `requires-python` in `pyproject.toml`) and [uv](https://docs.astral.sh/uv/)
- Node and Yarn for the Lit sample client
- Optional: `GEMINI_API_KEY` (or `GOOGLE_GENAI_USE_VERTEXAI=TRUE`) for live `gemini` decisions and `express`/`direct` baselines. The `mock` preset runs completely offline with zero API keys.

## Running the agent

Use [`run.sh`](run.sh) with a preset name (`mock`, `gemini`, `jev`, `step0`, `cascade`, `binder`, `rpc`, `express`, or `direct`):

```bash
cd samples/agent/adk/decision_playground

./run.sh mock       # offline heuristic backend in cascade mode (no API key needed)
./run.sh gemini     # Google Gemini Decisions API (/v1beta/decisions, gemini-decision-1)
JEV_API_KEY=... ./run.sh jev
A2UI_DECISION_URL=http://localhost:8000/v1/completions ./run.sh step0
./run.sh binder     # start directly in tool pointer binder mode
./run.sh rpc        # start directly in RPC predicate form mode
```

The server listens on `http://localhost:10010` by default (`--port` overrides it).

## Running the Lit shell client

```bash
cd samples/client/lit/shell
yarn build
yarn dev
```

Open `http://localhost:<port>/?app=playground` using the port Vite prints.

Use the header `Mode` and `Backend` pills, the quick-action buttons below the input box, or slash commands to switch between features live.

## Commands

| Command | Effect |
| :--- | :--- |
| `/mode cascade` \| `binder` \| `rpc` \| `express` \| `direct` | Switches the active render mode. |
| `/backend mock` \| `gemini` \| `jev` \| `step0` | Switches the active decision backend at runtime (rolls back on configuration error). |
| `/budget <ms>` \| `off` | Sets or clears the `DecisionCascadeRouter` latency budget in milliseconds. |
| `/tool host` \| `resort` \| `transfer` \| `order` | Runs a deterministic sample tool through `ToolPointerBinder` (0 LLM calls). |
| `/form bug` \| `feedback` \| `refund` | Renders an interactive form wired to a `callAgentFunction` decision predicate. |
| `/compare` | Runs the next prompt through `cascade`, `express`, and `direct` side by side. |
| `/trace` | Prints the most recent inspector trace JSON as a card. |
| `/help` | Shows active settings and available commands. |

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent, including its AgentCard, messages, artifacts, and task statuses, should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures, such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling, to protect their systems and users.

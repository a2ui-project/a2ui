# ReactApp demo: Margin

Margin is a chat demo of the ReactApp prototype. You ask for an interface, and `gemini-3.5-flash` answers in A2UI Express with native components plus a small React app (`ReactApp`) for the part native components can't express. The app runs in the sandbox next to the native components and shares their data model. Under each answer, a collapsed "How this was built" panel shows the raw model output, the A2UI messages, the app's source, the live bridge traffic, the data model and the latency of the turn.

| Folder                   | Contents                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agent/`](agent/)       | Python agent: FastAPI and SSE, Gemini streaming, Express, `ReactAppTransformer` with one retry, mock agent functions. See its [README](agent/README.md). |
| [`client/`](client/)     | Vite and React chat client on `@a2ui/react` and `@a2ui-labs/react-app`.                                                                                  |
| [`e2e/`](e2e/)           | Playwright tests for the three use cases, against recorded or live model responses.                                                                      |
| [`start.mjs`](start.mjs) | Starts the agent and the client together.                                                                                                                |

## Run it

Prerequisites: Node 22 with Yarn, [uv](https://docs.astral.sh/uv/), and the monorepo packages built once (see [the prototype README](../README.md#running-it)). Then, in `samples/community/react_app`:

```bash
yarn install
GEMINI_API_KEY=... node demo/start.mjs   # live model
node demo/start.mjs --replay             # recorded answers, no key needed
```

Open http://127.0.0.1:5317/. `start.mjs` builds the ReactApp packages first if their output is missing. The agent listens on port 8787; set `DEMO_AGENT_PORT` and `DEMO_CLIENT_PORT` to change the ports.

To open the demo from another machine, for example a laptop reaching a cloud workstation, listen on all interfaces:

```bash
node demo/start.mjs --host 0.0.0.0   # prints http://<machine name>:5317/
```

The client then accepts any `Host` header; set `DEMO_ALLOWED_HOSTS` (comma-separated) to restrict it. The agent stays on 127.0.0.1, because the browser reaches it only through the client's `/api` proxy. The sandbox proxy and the ReactApp runtime are served from the page's own origin, so they work under any host name.

Try the three suggested prompts:

1. **Loan explorer.** Native sliders drive a Vega bar chart in the app. Clicking a bar writes the selected year to the data model, and a native text shows what's left. "Email me this plan" sends an action, and the agent answers in a new turn.
2. **Itinerary planner.** The app lists the stops as draggable items. Each new order goes to the `estimateTravelTime` agent function through `callAgentFunction`, and the total updates.
3. **Sales explorer.** A chart with a brush selection. The app calls the `querySales` agent function and writes the selection and its results to the data model, which native components show.

The header's "Show internals" switch opens every turn's panel and is remembered in `localStorage`. "About this demo" shows the architecture.

## Test it

In `samples/community/react_app/demo/e2e`:

```bash
yarn test        # recorded responses from e2e/recordings/: deterministic, no API key
yarn test:live   # gemini-3.5-flash; needs GEMINI_API_KEY
```

Each run starts its own agent and client (ports 8797 and 5397). For each use case the tests check that:

- the native components render, and the app frame holds real UI: SVG chart marks, or draggable items;
- interactions work in both directions: a native slider redraws the chart, a click or brush in the app changes native text or the data model, and a drag calls `estimateTravelTime` and shows the new total;
- the explanation panels start collapsed, and each tab shows the turn's data once opened.

The tests read the page through `window.demo` and don't depend on the paths or ids the model chose, so the same tests run in both modes. Results go to `e2e/results/`:

- `latency.json` (and `latency-<mode>.json`): the checkpoints T1 to T8 of [docs/use_cases.md](../docs/use_cases.md#latency-checkpoints) per use case, in milliseconds after the request;
- `screens/<use case>-desktop.png` (1280×900) and `-narrow.png` (390×844);
- `agent-<mode>.log`: the agent's JSON logs, one line per turn;
- `live-recordings.json` after a live run. Copy entries from it into `recordings/` to update the recorded mode.

Playwright keeps a video of every test under `e2e/test-results/`.

## How it's wired

- The client registers three catalogs with one `MessageProcessor`: the basic catalog, the ReactApp catalog, and a demo catalog that declares the agent functions without implementing them. Calls to those functions leave the browser as `callAgentFunction` through the processor's `outboundListener`, which posts them to `/api/renderer-message`.
- The Vite server serves the sandbox proxy pages at `/a2ui-sandbox/` and the ReactApp runtime at `/a2ui-sandbox/react-app/v1/`, and proxies `/api` to the agent.
- [`client/src/styles/tokens.css`](client/src/styles/tokens.css) defines the palette, type and spacing once and maps them onto the basic catalog's `--a2ui-*` custom properties. The ReactApp element sends the same properties into the app frame, so native components and apps share the theme.
- The latency checkpoints come from the agent's `timing` events (converted from its wall clock) and from the ReactApp element's bridge events (`ready`, the `reactApp/initialize` response, `ui/rendered`).

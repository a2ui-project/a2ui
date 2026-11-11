# ReactApp demo agent

The agent behind the ReactApp demo. It's a FastAPI app that streams each chat turn as server-sent events (SSE).

For each turn it:

1. Builds the system prompt: the demo's role, the Express prompt for three catalogs (basic v1.0, the demo catalog, the ReactApp catalog) and `react_app_prompt(...)` from `a2ui-react-app`.
2. Streams `gemini-3.5-flash` through the Express response stream, which compiles each statement to A2UI as soon as it closes.
3. Checks every compiled message with `ReactAppTransformer(on_error="raise")`. If the stream or the checks reject the response, it removes the surfaces the failed attempt created, sends the model its response and the error list, and streams the new answer. It retries once.
4. Sends each A2UI message as an `a2ui` event, plus side events for the client's explanation panels.

## Endpoints

| Endpoint                     | Purpose                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat`             | One turn. Body: `{conversationId, text}` for a prompt, or `{conversationId, action}` for a button press (the renderer's `ActionPayload`). Answers with SSE. |
| `POST /api/renderer-message` | A renderer-to-agent message, such as `callAgentFunction`. Answers `{handled, replies}`; the client passes `replies` to its `MessageProcessor`.              |
| `GET /api/health`            | `{ok, model, mode}`.                                                                                                                                        |

SSE events of a turn, in order:

| Event         | Data                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `turn`        | `turnId`, `model`, `mode` (`live` or `replay`), `promptChars`, `receivedAt`                              |
| `timing`      | `checkpoint` (`firstToken`, `firstA2ui`, `reactAppSource`, `streamDone`) and `at`, in epoch milliseconds |
| `text`        | Conversational text outside the `<a2ui>` block                                                           |
| `a2ui`        | One A2UI v1.0 message and the attempt that produced it                                                   |
| `app_pending` | The model started writing a `ReactApp`; the client shows a placeholder                                   |
| `retry`       | The first attempt failed; `errors` lists why                                                             |
| `error`       | Both attempts failed, or the turn crashed                                                                |
| `debug`       | Raw Express per attempt, the A2UI messages, the ReactApp sources, timings and token counts               |
| `done`        | `ok`                                                                                                     |

## Agent functions

The demo catalog (`https://a2ui.org/labs/react_app/demo/v1/catalog.json`) declares two agent functions with mock data:

- `estimateTravelTime({stops})`: travel minutes between stops in order, from approximate Paris coordinates.
- `querySales({region, from, to})`: deterministic 2025 orders for four regions, at most 500.

Both answer after about 120 ms, so loading states are visible.

## Logs

Every turn writes one JSON line with the prompt size, the raw model text of each attempt, the check results, the retry count, token counts and the checkpoint durations. Each agent function call gets a line too. Logs go to stderr, and also to `--log-file` when it's set.

## Running

From this directory:

```sh
uv sync
uv run react-app-demo-agent                         # live, needs GEMINI_API_KEY
uv run react-app-demo-agent --replay ../e2e/recordings
uv run react-app-demo-agent --record /tmp/rec.json  # live, and saves responses for --replay
uv run pytest
uv run pyink --check .
uv run mypy
```

The options also read environment variables: `DEMO_AGENT_PORT` (default 8787), `DEMO_MODEL` (default `gemini-3.5-flash`), `DEMO_THINKING_LEVEL` (default `low`), `DEMO_REPLAY_DIR`, `DEMO_REPLAY_SPEED`, `DEMO_RECORD_FILE` and `DEMO_LOG_FILE`.

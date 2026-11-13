# A2UI Go restaurant agent sample

This sample runs an A2A restaurant-finder agent over HTTP JSON-RPC and Server-Sent Events (SSE) on port `10002`. It invokes Gemini through [ADK for Go](https://google.github.io/adk-docs/) v2 (`google.golang.org/adk/v2`) with [`github.com/a2ui-project/a2ui/go/adk`](../../../../go/adk/README.md) and compiles and validates A2UI responses with [`github.com/a2ui-project/a2ui/go/agent`](../../../../go/agent/README.md) and [`github.com/a2ui-project/a2ui/go/a2aext`](../../../../go/a2aext/README.md).

## Protocol negotiation and inference formats

The server answers each request in the A2UI version requested by the client:

1. A request carrying `a2uiRendererCapabilities` with a `"1.0"` entry receives v1.0 messages.
2. A request carrying `a2uiClientCapabilities` with a `"v0.9"` entry receives v0.9 messages.
3. A request without renderer capabilities defaults to v0.9 so the Lit, Angular, and React sample clients work without configuration changes.

`A2UI_FORMAT` selects the inference format written by the model: `express` (the default, wrapped in `<a2ui>...</a2ui>`) or `direct_json` (wrapped in `<a2ui-json>...</a2ui-json>`).

## Running the sample

### Stub mode (offline, no API key)

Set `STUB_LLM=true` to stream deterministic 4-chunk responses built from the shared example surfaces:

```bash
# Express DSL (default)
STUB_LLM=true go run .

# Direct JSON
STUB_LLM=true A2UI_FORMAT=direct_json go run .
```

### Live Gemini or Vertex AI mode

Run with a Gemini API key or Vertex AI Application Default Credentials:

```bash
# Gemini Developer API
GEMINI_API_KEY=... go run .

# Vertex AI (gemini-3.8-flash uses location=global)
GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT=your-project GOOGLE_CLOUD_LOCATION=global go run .
```

## Configuration variables

1. `A2UI_FORMAT` selects `express` (default) or `direct_json`.
2. `MODEL_NAME` sets the Gemini model identifier (default: `gemini-3.8-flash`).
3. `PORT` sets the TCP port to listen on (default: `10002`).
4. `STUB_LLM` enables canned offline responses when set to `true`.
5. `GEMINI_API_KEY` configures the Gemini API backend when `STUB_LLM` is not `true`.
6. `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION` (default: `global`) configure the Vertex AI backend.

## HTTP endpoints

1. `GET /.well-known/agent-card.json` serves the A2A `AgentCard`.
2. `POST /a2a/json-rpc` and `POST /` accept A2A `message/send` and `message/stream` JSON-RPC requests.
3. `GET /static/` serves restaurant images from `samples/agent/adk/restaurant_finder/images`.

CORS requests from any `http://localhost:<port>` origin are permitted for browser-based sample clients.

## Running tests

Run the deterministic offline unit and HTTP/SSE test suite:

```bash
go test ./...
```

Run the live Vertex AI end-to-end tests against `gemini-3.8-flash`:

```bash
VERTEX_E2E=1 GOOGLE_CLOUD_PROJECT=PROJECT_ID GOOGLE_CLOUD_LOCATION=global go test -v -run TestVertexE2E ./...
```

Replace `PROJECT_ID` with the ID of a Google Cloud project that has the Vertex AI API enabled.

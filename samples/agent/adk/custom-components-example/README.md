# A2UI Contact Multiple Surfaces Agent Sample

This sample uses the Agent Development Kit (ADK) along with the A2A protocol to create a simple "Contact Lookup" agent that is hosted as an A2A server.

## Prerequisites

- Python — see `requires-python` in [pyproject.toml](pyproject.toml)
- [UV](https://docs.astral.sh/uv/)
- Access to an LLM and API Key

## Running the Sample

1. Navigate to the samples directory:

   ```bash
   cd samples/agent/adk/custom-components-example
   ```

2. Create an environment file with your API key:

   ```bash
   echo "GEMINI_API_KEY=your_api_key_here" > .env
   ```

3. Run the server:

   ```bash
   uv run .
   ```

   The server listens on `http://localhost:10004` by default (override with `uv run . --port <port>`). It uses the Gemini `gemini-3.6-flash` model by default; override it via the `LITELLM_MODEL` environment variable (e.g. `LITELLM_MODEL=gemini/gemini-2.5-flash`).

4. Verify the server is running by fetching its agent card:

   ```bash
   curl http://localhost:10004/.well-known/agent-card.json
   ```

5. (Optional) Run the server with standard `WebFrame` instead of the custom `McpAppsCustomComponent`:

   ```bash
   USE_MCP_SANDBOX=false uv run .
   ```

6. (Optional) Ask for UI with A2UI v1.0. The `X-A2A-Extensions` header
   activates the v1.0 extension, and the message metadata carries the
   renderer's catalogs under `a2uiRendererCapabilities`, keyed by version. The
   renderer names the basic catalog in `supportedCatalogIds` and sends
   [`inline_catalog_1.0.json`](inline_catalog_1.0.json), which defines only the
   `OrgChart` and `WebFrame` components, in `inlineCatalogs`:

   ```bash
   jq -n --slurpfile inline inline_catalog_1.0.json '{
     jsonrpc: "2.0", id: 1, method: "message/send",
     params: {message: {
       role: "user", messageId: "1",
       parts: [{text: "Who is Casey Smith?"}],
       metadata: {a2uiRendererCapabilities: {"v1.0": {
         supportedCatalogIds: ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"],
         inlineCatalogs: $inline
       }}}
     }}
   }' | curl http://localhost:10004 \
     -H 'Content-Type: application/json' \
     -H 'X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v1.0' \
     -d @-
   ```

   Button clicks come back as data parts of the form
   `{"version": "v1.0", "action": {...}}`.

## How it works

- The agent holds one `A2uiGenerator` for each protocol version it speaks
  (v0.8, v0.9 and v1.0), with the basic catalog, and accepts inline catalogs.
  The agent card lists the generators' catalogs.
- Each request gets its own `A2uiRequestProcessor`, negotiated from the
  renderer capabilities that the client sent, keyed by protocol version:
  `a2uiClientCapabilities` for v0.8 and v0.9, `a2uiRendererCapabilities` for
  v1.0. A client that sends none gets a text answer. The system prompt is built
  from that processor, so it describes the client's inline catalog too, such as
  the `OrgChart` and `WebFrame` components.
- In v0.9, a surface uses one catalog, so the inline catalog
  [`inline_catalog_0.9.json`](inline_catalog_0.9.json) repeats the basic
  components next to `OrgChart` and `WebFrame`, and the surfaces in
  `examples/0.9/` that show them use `inline_catalog`.
- v1.0 mixes catalogs on one surface. The inline catalog
  [`inline_catalog_1.0.json`](inline_catalog_1.0.json) defines only `OrgChart`
  and `WebFrame`. The surfaces in `examples/1.0/` use the basic catalog as
  their default catalog, and each `OrgChart` or `WebFrame` names the inline
  catalog in its `catalogId`. The floor plan
  ([`examples/1.0/floor_plan.json`](examples/1.0/floor_plan.json)) shows it: a
  basic `Card`, `Column`, `Text` and `Button` around a custom `WebFrame`.
- Later turns update the surfaces that earlier turns created, for example the
  contact card after a click on the org chart. The agent keeps a
  `RendererState` for each conversation, and checks every response against it
  with `processor.open_stream(state=...)`. Invalid messages are never sent:
  the stream raises, and the agent asks the model to try again.
- The UI that simulated actions show, like the floor plan, is checked against
  the same state.

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All data received from an external agent—including but not limited to its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide an AgentCard containing crafted data in its fields (e.g., description, name, skills.description). If this data is used without sanitization to construct prompts for a Large Language Model (LLM), it could expose your application to prompt injection attacks. Failure to properly validate and sanitize this data before use can introduce security vulnerabilities into your application.

Developers are responsible for implementing appropriate security measures, such as input validation and secure handling of credentials to protect their systems and users.

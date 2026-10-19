# File upload summarizer agent

A reference A2UI Agent demonstrating host-delegated inversion of control (IoC) file uploads and out-of-band pointer resolution without context bloat.

## Overview

This agent pairs with the Angular host application in `samples/community/client/angular/projects/file_upload`. It provides:

- **Mock Drive v3 REST API**: Embedded HTTP endpoints (`POST /api/mock-drive/v3/files` and `GET /api/mock-drive/v3/files/{id}`) for testing uploads and pointer resolution locally without Google Cloud OAuth credentials.
- **Out-of-Band FileResolver**: Downloads files via `mockdrive://` pointer IDs rather than transmitting Base64 binary strings over the WebSocket.
- **Multimodal Summarization**: Uses `gemini-3.6-flash` (with zero thinking budget for low latency) to generate concise executive summaries of uploaded documents.

## Running

1. Navigate to the agent directory:

   ```bash
   cd samples/community/agent/adk/file_upload_summarizer
   ```

2. Set up your environment variables (requires `GEMINI_API_KEY` or Vertex AI configuration):

   ```bash
   export GEMINI_API_KEY="your-api-key"
   ```

3. Start the server on port 10008:

   ```bash
   uv run . --port 10008
   ```

## How the agent negotiates A2UI

The agent holds one `A2uiGenerator` for each protocol version (v0.9 and v1.0), each with the file upload catalog of that version in [`catalogs/`](catalogs/). The agent card lists the generators' catalogs.

For each request, the executor ([`agent_executor.py`](agent_executor.py)) creates an `A2uiRequestProcessor` from the client's capabilities: the `a2uiClientCapabilities` message metadata for v0.9, and `a2uiRendererCapabilities` for v1.0. It writes the negotiated version, the format rules of the processor and the negotiated catalog into the session state. The instruction and the A2UI event converter read them from there, and the tools write their A2UI messages in the negotiated version.

The capabilities are keyed by protocol version, for example `{"v1.0": {"supportedCatalogIds": [...]}}`, and the agent passes them to `A2uiGenerator.create_processor` unchanged. A client that sends none, or names none of the agent's catalogs, gets text answers. The Angular host application names the file upload catalog in its capabilities.

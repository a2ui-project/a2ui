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

The agent holds one `A2uiGenerator` for each protocol version: v0.9 with the file upload catalog in [`catalogs/0.9`](catalogs/0.9/), and v1.0 with the basic catalog and the file upload catalog in [`catalogs/1.0`](catalogs/1.0/). The agent card lists the generators' catalogs.

v1.0 mixes catalogs on one surface, so the v1.0 file upload catalog holds only the `FileUpload` component. The v1.0 surface uses the basic catalog as its default (`createSurface.catalogId`) for the layout, the button and its `required` check, and the `FileUpload` component names the file upload catalog in its own `catalogId`. A v0.9 surface uses one catalog, so the v0.9 file upload catalog also holds the layout components and the `required` function.

For each request, the executor ([`agent_executor.py`](agent_executor.py)) creates an `A2uiRequestProcessor` from the client's capabilities: the `a2uiClientCapabilities` message metadata for v0.9, and `a2uiRendererCapabilities` for v1.0. It writes the negotiated version, the format rules of the processor and the negotiated catalog into the session state. The instruction and the A2UI event converter read them from there, and the tools write their A2UI messages in the negotiated version. The event converter sends tool responses on unchecked, so the tools validate their messages against the negotiated catalogs and return an error to the model instead of an invalid surface. A request that negotiates as the previous request in the session did reuses the session state and adds no event to the session.

The capabilities are keyed by protocol version, for example `{"v1.0": {"supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", "https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/1.0/file_upload_catalog.json"]}}` for v1.0, which names both catalogs, and the agent passes them to `A2uiGenerator.create_processor` unchanged. A client that sends none, or names none of the agent's catalogs, gets text answers. So does a v1.0 client that names only one of the two catalogs, since the uploader surface uses both. The Angular host application names the file upload catalog in its capabilities.

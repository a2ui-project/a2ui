# File upload summarizer agent

A reference A2UI Agent demonstrating host-delegated inversion of control (IoC) file uploads and out-of-band pointer resolution without context bloat.

## Overview

This agent pairs with the Angular host application in `samples/community/client/angular/projects/file_upload`. It provides:

- **Mock Drive v3 REST API**: Embedded HTTP endpoints (`POST /api/mock-drive/v3/files` and `GET /api/mock-drive/v3/files/{id}`) for testing uploads and pointer resolution locally without Google Cloud OAuth credentials.
- **Out-of-Band FileResolver**: Downloads files via `mockdrive://` pointer IDs rather than transmitting Base64 binary strings over the WebSocket.
- **Multimodal Summarization**: Uses `gemini-3.5-flash-lite` to generate concise executive summaries of uploaded documents.

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

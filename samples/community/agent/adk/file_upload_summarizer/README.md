# File upload summarizer agent

A reference A2UI Agent demonstrating host-delegated inversion of control (IoC) file uploads and out-of-band pointer resolution without context bloat.

## Overview

This agent pairs with the Angular host application in `samples/community/client/angular/projects/file_upload`. It provides:

- **`FileUpload` surface**: `show_file_uploader_tool` renders the `FileUpload` component of the [A2UI File Upload catalog](../../../../../catalogs/file_upload/README.md) with its `value` bound to `/uploaded_files`, and a `Summarize` button whose `required` check and action context read that same path. The renderer writes a `FileReference` (`fileId`, `fileName`, `fileSize`, `mimeType`) per uploaded file there, so the agent is only involved when the user asks for a summary. Protocol v0.9 resolves all components of a surface from one catalog, so [catalogs/0.9/file_upload_catalog.json](catalogs/0.9/file_upload_catalog.json) bundles `FileUpload` with the basic components the tool uses.
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

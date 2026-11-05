# Mock Drive file upload demo (Angular host)

This sample Angular application demonstrates host-delegated inversion of control (IoC) file uploads and out-of-band pointer resolution in A2UI.

## Features

- **`FileUpload` component**: Implements the component of the [A2UI File Upload catalog](../../../../../../catalogs/file_upload/README.md) for protocol v0.9: a drag-and-drop zone with progress states that writes a `FileReference` (`fileId`, `fileName`, `fileSize`, `mimeType`) per uploaded file to the data model path bound to `value`, and dispatches the component's `action` when the agent declares one. The agent's `Summarize` button reads the same path from its action context, so no handshake with the agent is needed after an upload.
- **IoC upload callback**: Intercepts selected files and uploads them to the backend mock Drive service (`http://localhost:10008/api/mock-drive/v3/files`), returning an abstract pointer URI (`mockdrive://...`). Without the callback, the component falls back to an `inline://` pointer and the A2A service moves the inline content into an A2A `FilePart`.
- **Fixed right-hand Protocol Inspector**: A split-screen telemetry drawer that logs the IoC upload event, displays raw outgoing JSON-RPC messages (verifying 0 bytes of Base64 inline bloat), and displays agent resolution traces.

Protocol v0.9 resolves every component of a surface from one catalog, so the renderer registers `FileUpload` together with the basic catalog components under the sample's composite catalog ID ([src/a2ui-catalog/catalog.ts](src/a2ui-catalog/catalog.ts)), matching the agent's [file_upload_catalog.json](../../../../agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json).

## Prerequisites

1. Ensure the Python agent is running on port 10008:
   ```bash
   cd samples/community/agent/adk/file_upload_summarizer
   uv run . --port 10008
   ```

## Running the application

1. Build shared dependencies from `typescript/core/web_core`:
   ```bash
   yarn workspace @a2ui/web_core build
   ```
2. Start the Angular dev server:
   ```bash
   yarn workspace angular-a2ui ng serve file_upload --port 4200
   ```
3. Open `http://localhost:4200/` in your browser.

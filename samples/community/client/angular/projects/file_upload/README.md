# Mock Drive file upload demo (Angular host)

This sample Angular application demonstrates host-delegated inversion of control (IoC) file uploads and out-of-band pointer resolution in A2UI.

## Features

- **Self-contained FileUpload web component**: Implements drag-and-drop document upload with visual progress states.
- **IoC upload callback**: Intercepts selected files and uploads them to the backend mock Drive service (`http://localhost:10008/api/mock-drive/v3/files`), returning an abstract pointer URI (`mockdrive://...`).
- **Fixed right-hand Protocol Inspector**: A split-screen telemetry drawer that logs the IoC upload event, displays raw outgoing JSON-RPC messages (verifying 0 bytes of Base64 inline bloat), and displays agent resolution traces.

## Prerequisites

1. Ensure the Python agent is running on port 10008:
   ```bash
   cd samples/community/agent/adk/file_upload_summarizer
   uv run . --port 10008
   ```

## Running the application

1. Build shared dependencies from `renderers/web_core`:
   ```bash
   yarn workspace @a2ui/web_core build
   ```
2. Start the Angular dev server:
   ```bash
   yarn workspace angular-a2ui ng serve file_upload --port 4200
   ```
3. Open `http://localhost:4200/` in your browser.

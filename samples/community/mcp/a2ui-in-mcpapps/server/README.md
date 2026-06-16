# A2UI-in-MCP Apps Server

This directory contains a Python-based Model Context Protocol (MCP) server designed to serve a **standalone application** as an [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) resource. This hosted application artifact is fully equipped to translate raw A2UI JSON payloads directly into rich, interactive UI renderings, demonstrating the integration of **A2UI** within the MCP ecosystem.

It provides a reference implementation for serving rich, interactive UIs to an agent host via MCP resources and tools.

## Key Components

- **`server.py`**: The core MCP server implementation. Defines the tools, resources, and transports.
- **`simple_counter_a2ui.json`**: A mock data file containing sample A2UI payloads returned by the `fetch_counter_a2ui` tool.
- **`apps/`**: Contains the source code and build artifacts for the application hosted by this server.
  - _Note: The server specifically expects to serve a bundled artifact at `apps/public/app.html`._

---

## Exposed Interface

### Resources

- **`ui://basic/app`**: Serves the self-contained `apps/public/app.html` application. (MIME type: `text/html;profile=mcp-app`)

### Tools

- **`get_basic_app`**: Returns a reference to the `ui://basic/app` resource.
- **`fetch_counter_a2ui`**: Fetches the initial counter A2UI payload (loaded from `simple_counter_a2ui.json`) to test rendering.
- **`increase_counter`**: Increments an in-memory counter and returns a standard `dataModelUpdate` to update UI components.

---

## Getting Started

### Prerequisites

- **Python 3.10+**
- [**`uv`**](https://github.com/astral-sh/uv) (Recommended Python package manager)

### Running the Server

Use `uv` to manage dependencies and run the server.

#### Option A: Run with SSE (Default)

Starts the server on `127.0.0.1:8000` waiting for SSE connections.

```bash
uv run python server.py --transport sse --port 8000
```

_(or simply `uv run python server.py` as it defaults to sse/8000)_

#### Option B: Run with Stdio

Uses standard input/output for communication.

```bash
uv run python server.py --transport stdio
```

---

## Hosted Application Build Requirement

The server serves a bundled application located at `apps/public/app.html`.

If this file is missing, or if you modify the hosted application source (in `apps/src/`), you must rebuild it.

See the [**`apps/README.md`**](apps/README.md) for detailed instructions on building the hosted application artifact.

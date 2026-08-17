# MCP Apps Seating Demo

This project is a demonstration of how to build and expose an interactive frontend application (MCP App) with multiple venue layouts from a single Python MCP server. It supports 5 different mock seating layout views built with Vanilla JS and CSS:

- **Stadium**
- **Concert**
- **Theater**
- **Arena**
- **Cinema**

The frontend application uses the `@modelcontextprotocol/ext-apps` SDK to connect back to the FastMCP Python server to fetch state and execute tool calls (like booking a seat).

## Prerequisites

- Node.js and `npm`
- Python 3.10+
- `uv` (for Python package management)

## Setup

First, install the Python dependencies:
```bash
uv pip install -e .
```

Next, install the Node dependencies and build the frontend HTML bundle using Vite:
```bash
npm install
npm run build
```
*This will generate a self-contained HTML bundle (`dist/index.html`).*

## Running Locally

To test this example locally, you will need to run the Python server and a Host application (like `basic-host`) to render the UIs.

### 1. Start the Server

Run the FastMCP server with SSE transport enabled. (It includes CORS middleware so the host browser app can connect to it).
```bash
.venv/bin/python server.py --transport sse
```
*The server will start listening on `http://127.0.0.1:8000`.*

### 2. Start the Basic Host

Open a new terminal and navigate to the root of the `ext-apps` repository to start the `basic-host` reference implementation. We will pass the SSE server URL via an environment variable.

```bash
# From the root of the ext-apps repo:
cd ../../../ext-apps

# Point the basic-host to our seating server:
SERVERS='["http://localhost:8000/sse"]' npm run start --workspace examples/basic-host
```

### 3. Test the Integration

1. Open **http://localhost:8080** in your web browser.
2. Under the **Call Tool** section in the right panel, select the `open_venue` tool.
3. In the arguments payload, enter `{"venue_id": "stadium"}` (or one of the other 4 venues) and click "Call Tool".
4. The host will receive the UI resource payload from the server and spawn the interactive seating app! Click on any green seat to book it, and watch the state update.

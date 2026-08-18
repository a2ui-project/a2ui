# Pong Web Server

This directory contains a simple Python HTTP server designed to serve the Pong web application. It acts as a static file server and dynamically injects necessary bridge and engine scripts to assemble the web frame HTML.

## What is this package used for?

The `pong_server.py` is used to host a Pong game that is intended to be embedded as an iframe (or web frame component) within A2UI clients.

Unlike the MCP app version of Pong that operates via the A2UI agent protocol, this version serves a standard web application over HTTP, which connects back to the web frame environment using the `pong_web_frame_bridge.js` bridge script.

When a request is made for `/pong_app_web_frame.html`, the server dynamically reads the shared `pong_base.html` and `pong_engine.js` files (located in the `samples/agent/adk/mcp_app_proxy/` directory), injects the local web frame bridge (`pong_web_frame_bridge.js`), and serves the assembled page with appropriate CORS headers enabled.

## How to spin up the server

You can start the server using `uv run`. It will host the web application locally on port `8081`.

Run the following command from this directory:

```bash
uv run .
```

Alternatively, you can run it from the root of the repository:

```bash
uv run samples/community/web/pong
```

Once started, the server will output:

```text
Serving at port 8081
```

You can then use the Pong web frame application in your web client at:

- `http://localhost:8081/pong_app_web_frame.html` (for `WebAppFrameUrl`)
- `http://localhost:8081/pong_app_web_frame_srcdoc.html` (for `WebAppFrameSrcdoc`, fetched remotely by the agent)

The server runs indefinitely until stopped. You can stop it by pressing `Ctrl+C` in your terminal.

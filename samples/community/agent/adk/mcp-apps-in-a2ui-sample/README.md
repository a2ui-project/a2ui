# MCP App Standalone Sample

This sample demonstrates how to integrate an **MCP (Model Context Protocol) App** within the A2UI environment using a secure, double-sandboxed iframe architecture.

## Overview

This directory contains `agent.py`, a standalone Python FastAPI server emitting legacy A2UI v0.8 payloads containing a custom `McpApp` component and handling forwarded tool calls.

> **Note**: The companion Lit v0.8 client sample (`samples/community/client/lit/mcp-apps-in-a2ui-sample`) was removed along with the `@a2ui/lit` v0.8 adapter. For an end-to-end Lit + MCP App sample on protocol v1.0 using `@a2ui/catalog-mcp`, see [`samples/community/mcp/a2ui-kanban/`](../../../mcp/a2ui-kanban/README.md).

## Architecture

To ensure security when running untrusted third-party widget code, A2UI MCP App hosts use a **double-iframe isolation** model:

- **Host Page**: The main A2UI application.
- **Sandbox Proxy**: An iframe hosted on a separate origin (`127.0.0.1`) to enforce origin isolation.
- **Untrusted App**: The actual MCP app content, injected dynamically into an inner iframe with restricted permissions.

Communication between the host and the app is handled via the `@modelcontextprotocol/ext-apps` package using standard `postMessage` channels.

## Prerequisites

- Python 3.10+ with `uv` package manager

## How to Run the Agent

Navigate to this directory and start the FastAPI server:

```bash
cd samples/community/agent/adk/mcp-apps-in-a2ui-sample
uv run agent.py
```

The agent listens on `http://localhost:8000`.

## Development Notes

- **Module Resolution**: Because this is a development environment, the iframe dynamically loads the `app-with-deps.js` bundle from the workspace's `node_modules` via Vite's `/@fs/` prefix. An `importmap` is used to resolve the bare imports inside that bundle.
- **CORS**: The iframe must be loaded from `127.0.0.1` to match the origin expected by the sandbox proxy and avoid CORS blocks.
- **Content Security Policy (CSP)**: This sample uses a static CSP in `sandbox.html` that allows `'unsafe-inline'` and `'unsafe-eval'` for compatibility with development tools. For production deployments, it is recommended to remove these relaxed settings and implement a dynamic CSP derived from app metadata as recommended by the MCP Apps spec.

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

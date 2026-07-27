# Shared MCP Apps Inner iframe (Sandbox iframe)

This directory contains the unified and reusable **Sandbox iframe** implementation for **A2UI applications** (Angular, Lit) to run **untrusted third-party Model Context Protocol (MCP) applications**.

## Use Case

A2UI utilizes a **double-iframe isolation pattern** to run untrusted third-party code securely. This pattern uses a same-origin (un-sandboxed) outer proxy to eliminate `SecurityError` crashes from Angular DevTools and Chrome Extensions while maintaining strict isolation for untrusted content via a restricted inner iframe.

## Files

- `sandbox.ts`: Logic for origin validation and message relaying between the Host and the inner iframe.
- `sandbox.html`: The container for the outer proxy iframe.

## Testing guidelines

Testing for any changes in this directory requires bringing up the relevant clients and servers.

### 1. Contact Multi-Surface Sample (Lit & ADK Agent)

This test verifies the sandbox with a Lit-based client and an ADK-based A2A agent.

- **A2A Agent Server**:
  - Path: `../../../agent/adk/contact_multiple_surfaces/`
  - Command: `uv run .` (requires `GEMINI_API_KEY` in `.env`)
- **Lit Client App**:
  - Path: `../../lit/contact/`
  - Command: `yarn dev` (requires building the Lit renderer first)
  - URL: `http://localhost:5173/`

### 2. MCP Apps (Calculator) (Angular)

This test verifies the sandbox with an Angular-based client, an MCP Proxy Agent, and a remote MCP Server.

- **MCP Server (Calculator)**:
  - Path: `../../../mcp/mcp-apps-calculator/`
  - Command: `uv run .` (runs on port 8000)
- **MCP Apps Proxy Agent**:
  - Path: `../../../agent/adk/mcp_app_proxy/`
  - Command: `uv run .` (requires `GEMINI_API_KEY` in `.env`)
- **Angular Client App**:
  - Path: `../../angular/`
  - Command: `yarn start -- mcp_calculator` (requires `yarn build:sandbox` and `yarn install`)
  - URL: [`http://localhost:4200/?disable_security_self_test=true`](http://localhost:4200/?disable_security_self_test=true)

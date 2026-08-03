# Pong game sample

This sample demonstrates an Angular client displaying an interactive Pong game using the A2UI protocol. The client supports three distinct methods for loading and displaying the embedded game interface.

## Prerequisites

1. Node.js (version 18 or higher) and Yarn.
2. Python 3.9 or higher with `uv` installed.
3. The Pong web server hosting the game endpoints. ([Review the instructions for running the Pong web server](../../../../web/pong/README.md).)
4. The MCP Apps proxy agent backend. ([Review the instructions for running the MCP Apps proxy agent](../../../../agent/adk/mcp_app_proxy/README.md).)

## Running the application

1. Build shared workspace dependencies at the repository root directory:

   ```bash
   yarn build:all
   ```

2. Install local dependencies in the `samples/community` directory:

   ```bash
   cd samples/community
   yarn install
   ```

3. Start the Pong web server:

   ```bash
   cd samples/community/web/pong
   uv run .
   ```

4. Start the agent backend in a separate terminal:

   ```bash
   cd samples/community/agent/adk/mcp_app_proxy
   uv run .
   ```

5. Start the Angular application in `samples/community/client/angular`:

   ```bash
   cd samples/community/client/angular
   yarn start mcp_calculator
   ```

6. Open `http://localhost:4200/?disable_security_self_test=true` in your browser.

## Summoning methods

The application demonstrates three separate ways to summon and embed the Pong game interface:

### MCP Apps

The agent embeds the HTML and JavaScript logic directly within an `McpApp` component payload. The client renders the application inside a sandboxed iframe. Communication between the host client and the embedded game uses JSON-RPC over window messaging protocols.

### Iframe by URL

The agent returns a `WebAppFrameUrl` component containing a URL pointing to the remote Pong web server (`http://localhost:8081/pong_app_web_frame.html`). The browser loads the game frame directly from the HTTP endpoint.

### Iframe by Srcdoc

The agent fetches the game HTML from the remote web server on the backend and transmits the content inline inside a `WebAppFrameSrcdoc` component payload. The client renders the HTML string directly using the `srcdoc` attribute of the iframe.

## Usage

When the application loads, the main screen displays suggestion buttons for each summoning method:

- Open Pong as MCP App
- Open Pong from remote web server
- Open Pong with WebApp Srcdoc

Clicking any suggestion sends a message to the backend agent, which returns the corresponding A2UI layout payload. The interface updates to display the game surface alongside score tracking and commentary components.

# Restaurant finder - Lit UI with Python agent

This is the Lit client for the restaurant finder demo featured in [Quickstart: Run A2UI in 5 Minutes](https://a2ui.org/quickstart). Refer to the guide for end-to-end setup and run instructions.

See the [video](https://github.com/user-attachments/assets/2a406115-3a17-4bea-8000-ac12e0b7b9bd) on how it works.

## Prerequisites

- [Node.js](https://nodejs.org/en)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Python — see `requires-python` in the agent's [pyproject.toml](../../../agent/adk/restaurant_finder/pyproject.toml)
- A [Gemini API key](https://aistudio.google.com/apikey) (`GEMINI_API_KEY`)

## Running

1. **Install dependencies:**
   From the repository root, install dependencies:

   ```bash
   yarn install
   ```

2. **Set your Gemini API key:**
   Either export `GEMINI_API_KEY` in your shell or create a `.env` file in the [Restaurant Finder Agent](../../../agent/adk/restaurant_finder/) directory:

   ```bash
   export GEMINI_API_KEY="your_gemini_api_key_here"
   ```

   Or via `.env`:

   ```bash
   cp samples/agent/adk/restaurant_finder/.env.example samples/agent/adk/restaurant_finder/.env
   # Edit samples/agent/adk/restaurant_finder/.env and set GEMINI_API_KEY (do not commit .env)
   ```

3. **Start the agent and dev server:**

   **Option A — Single command (from `samples/client/lit`):**
   Builds the Lit renderer and runs both the Lit shell dev server and the Restaurant Finder agent concurrently:

   ```bash
   cd samples/client/lit
   yarn demo:restaurant
   ```

   **Option B — Separate terminals (from `samples/client/lit/shell`):**
   Build all packages first (`yarn build:all` from the repository root), then run the agent and dev server in two separate terminals from `samples/client/lit/shell`:

   - **Terminal 1 — Run the [Restaurant Finder Agent](../../../agent/adk/restaurant_finder/) (port `10002`):**

     ```bash
     cd samples/client/lit/shell
     yarn demo:restaurant
     ```

   - **Terminal 2 — Run the Vite dev server (port `5173`):**

     ```bash
     cd samples/client/lit/shell
     yarn dev
     ```

### Open UI

Open http://localhost:5173 in your browser (or follow the URL printed in the console output).

## Security Notice

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

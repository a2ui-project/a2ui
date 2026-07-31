# Restaurant finder - React UI with Python agent

A React shell that renders A2UI surfaces streamed from the
[Restaurant Finder Agent](../../../agent/adk/restaurant_finder/) over the
Agent-to-Agent (A2A) protocol.

## Prerequisites

- [Node.js](https://nodejs.org/en)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Python — see `requires-python` in the agent's
  [pyproject.toml](../../../agent/adk/restaurant_finder/pyproject.toml)

## Running

### 1. Install and build dependencies

From the repository root, install dependencies and build all packages:

```bash
yarn install
yarn build:all
```

### 2. Run the agent

In one terminal, start the
[Restaurant Finder Agent](../../../agent/adk/restaurant_finder/) on its default
port (`10002`):

```bash
cd samples/agent/adk/restaurant_finder
cp .env.example .env   # then edit .env and set GEMINI_API_KEY (do not commit .env)
uv run .
```

### 3. Run the dev server

In another terminal, start the React dev server:

```bash
cd samples/client/react/shell
yarn dev
```

Vite serves the app on http://localhost:5003 and proxies `/a2a` requests to the
agent running on `localhost:10002`.

### 4. Open the UI

Open http://localhost:5003 in your browser (or follow the link printed in the
console).

## Security Notice

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

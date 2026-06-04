# Restaurant finder - Lit UI with Python agent

See the [video](https://github.com/user-attachments/assets/2a406115-3a17-4bea-8000-ac12e0b7b9bd) on how it works.

## Prerequisites

- [nodejs](https://nodejs.org/en)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)

## Running

### Run agent

Follow the steps in [agent's README.md](../../../agent/adk/restaurant_finder/README.md) to run agent.

### Build dependencies and run client application

Run from the root of the repository:

```bash
(cd adapters/web_core/ && npm i && npm run build) && \
(cd adapters/markdown/markdown-it/ && npm i && npm run build) && \
(cd adapters/lit/ && npm i && npm run build) && \
(cd samples/client/lit/shell/ && npm i && npm run dev)
```

If you hit errors around `npm i` remove the directory `node_modules` and the file `package-lock.json`.

### Open UI

Follow the link in console output of the last command above.

## Security Notice

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

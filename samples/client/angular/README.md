# Angular A2UI

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. [uv](https://docs.astral.sh/uv/getting-started/installation/)

## Running

Here is the quickstart for the restaurant app:

```bash
# Set up your Gemini API key
cp ../../agent/adk/restaurant_finder/.env.example ../../agent/adk/restaurant_finder/.env
# Edit the .env file with your actual API key (do not commit .env)

# Start the restaurant app frontend
yarn install
yarn demo:restaurant
```

## Streaming

By default, the Angular client uses the streaming API to communicate with the agent. To disable streaming, set the `ENABLE_STREAMING` environment variable to `false`.

```bash
export ENABLE_STREAMING=false
yarn start restaurant
```

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

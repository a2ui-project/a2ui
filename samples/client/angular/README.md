# Angular A2UI

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. [uv](https://docs.astral.sh/uv/getting-started/installation/)

NOTE: [For the rizzcharts app](../../agent/adk/rizzcharts/python/), you will need GoogleMap API ([How to get the API key](https://developers.google.com/maps/documentation/javascript/get-api-key)) to display Google Map custome components. Please refer to [Rizzcharts README](./projects/rizzcharts/README.md)

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

Here are the instructions if you want to do each step manually.

1. **Install dependencies:** `yarn install`
2. **Run the relevant client app (also requires running the relevant backend A2A service):**
   - **Restaurant app:**
     - Run backend server in [restaurant_finder](../../agent/adk/restaurant_finder/README.md)
     - Run client: `yarn start restaurant`
   - **Rizzcharts app:**
     - Run backend server in [rizzcharts](../../agent/adk/rizzcharts/python/README.md)
     - Run client: `yarn start rizzcharts`
   - **Orchestrator app:**
     - Run backend server in [orchestrator](../../agent/adk/orchestrator/README.md)
     - Run client: `yarn start orchestrator`
   - **MCP Calculator app:**
     - Run client: `yarn build:sandbox && yarn start mcp_calculator`
   - **Gallery app:** (Client-only, no server required)
     - Run client: `yarn start gallery`
3. **Open** http://localhost:4200/

## Streaming

By default, the Angular client uses the non-streaming API to communicate with the agent. To enable streaming, set the `ENABLE_STREAMING` environment variable to `true`:

```bash
export ENABLE_STREAMING=true
yarn start restaurant
```

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

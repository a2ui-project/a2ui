# A2UI Orchestrator Agent Sample

This sample uses the Agent Development Kit (ADK) along with the A2A protocol to create an orchestrator agent that routes requests to different expert subagents.

The orchestrator agent needs the A2UI extension enabled by adding the header X-A2A-Extensions=https://a2ui.org/a2a-extension/a2ui/v0.8 to requests, however it is hardcoded to true for this sample to simplify inspection.

The orchestrator does an inference call on every request to decide which agent to route to, and then uses transfer_to_agent in ADK to pass the original message to the subagent. This routing is done on subsequent calls including on A2UI userAction, and a future version could optimize this by programmatically routing userAction to the agent that created the surface using before_model_callback to shortcut the orchestrator LLM.

Subagents are configured using RemoteA2aAgent which translates ADK events to A2A messages that are sent to the subagent's A2A server. The HTTP header X-A2A-Extensions=https://a2ui.org/a2a-extension/a2ui/v0.8 is added to requests from the RemoteA2aAgent to enable the A2UI extension.

## Prerequisites

- Python 3.9 or higher
- [UV](https://docs.astral.sh/uv/)
- Access to an LLM and API Key

## Running the Sample

1. Create an environment file with your API key:

   ```bash
   cp .env.example .env
   # Edit .env with your actual API key (do not commit .env)
   ```

2. Run subagents

   Open a new terminal for each command

   ```bash
   cd samples/agent/adk/restaurant_finder
   uv run . --port=10003
   ```

   ```bash
   cd samples/agent/adk/rizzcharts/python
   uv run . --port=10005
   ```

3. Run the orchestrator agent:

   ```bash
   cd samples/agent/adk/orchestrator
   uv run . --port=10002 --subagent_urls=http://localhost:10003 --subagent_urls=http://localhost:10005
   ```

4. Try commands that work with any agent:
   a. "Show me chinese food restaurants in NYC" (routed to restaurant finder agent)
   b. "Show my sales data for Q4" (routed to rizzcharts)

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

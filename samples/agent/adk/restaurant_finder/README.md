# A2UI Restaurant finder and table reservation agent sample.

This sample uses the Agent Development Kit (ADK) along with the A2A protocol to create a simple "Restaurant finder and table reservation" agent that is hosted as an A2A server.

## Prerequisites

- Python — see `requires-python` in `pyproject.toml`
- [UV](https://docs.astral.sh/uv/)
- Access to an LLM and API Key

## Running the Sample

1. Navigate to the samples directory:

   ```bash
   cd samples/agent/adk/restaurant_finder
   ```

2. Create an environment file with your API key:

   ```bash
   cp .env.example .env
   # Edit .env with your actual API key (do not commit .env)
   ```

3. Run the agent server:

   ```bash
   uv run .
   ```

4. In another terminal window:
   - verify that the agent is available via A2A:

     ```bash
     curl http://localhost:10002/.well-known/agent-card.json
     ```

   - send a message to the agent:

     ```bash
     curl http://localhost:10002 \
       -H 'Content-Type: application/json' \
       -d '{
         "jsonrpc": "2.0",
         "id": 1,
         "method": "message/send",
         "params": {
           "message": {
             "role": "user",
             "parts": [{"text": "Find me an Italian restaurant"}],
             "messageId": "1"
           }
         }
       }'
     ```

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

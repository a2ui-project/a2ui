# A2UI MCP Apps Proxy Agent sample

This sample uses the Agent Development Kit (ADK) along with the A2A protocol to
create a simple "MCP Apps Proxy" agent that is hosted as an A2A server.

## Prerequisites

- Python 3.9 or higher
- [UV](https://docs.astral.sh/uv/)
- Access to an LLM and API Key

## Running the sample

1. Run the MCP Server that serves the MCP Apps. ([Link to
   instructions](../../../mcp/mcp-apps-calculator/README.md))

2. Navigate to the samples directory:

   ```bash
   cd samples/community/agent/adk/mcp_app_proxy
   ```

3. Create an environment file with your API key:

   ```bash
   cp .env.example .env
   # Edit .env with your actual API key (do not commit .env)
   ```

4. Run the server:

   ```bash
   uv run .
   ```

## How the agent negotiates A2UI

The agent holds one `A2uiGenerator` for each protocol version (v0.8 and v0.9),
each with the MCP App catalog in [`catalogs/`](catalogs/). The agent card lists
the generator's catalogs.

For each request, the executor ([`agent_executor.py`](agent_executor.py))
creates an `A2uiRequestProcessor` from the client's `a2uiClientCapabilities`,
and writes the format rules of the processor and the negotiated catalog into the
session state. The instruction and the A2UI event converter read them from
there.

The capabilities are keyed by protocol version, for example
`{"v0.9": {"supportedCatalogIds": [...]}}`, and the agent passes them to
`A2uiGenerator.create_processor` unchanged. A client that sends none, or names
none of the agent's catalogs, gets text answers. The [MCP calculator
client](../../../client/angular/projects/mcp_calculator) names the MCP App
catalog in its capabilities.

## Disclaimer

Important: The sample code provided is for demonstration purposes and
illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When
building production applications, it is critical to treat any agent operating
outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard,
messages, artifacts, and task statuses—should be handled as untrusted input. For
example, a malicious agent could provide crafted data in its fields (e.g., name,
skills.description) that, if used without sanitization to construct prompts for
a Large Language Model (LLM), could expose your application to prompt injection
attacks.

Similarly, any UI definition or data stream received must be treated as
untrusted. Malicious agents could attempt to spoof legitimate interfaces to
deceive users (phishing), inject malicious scripts via property values (XSS), or
generate excessive layout complexity to degrade client performance (DoS). If
your application supports optional embedded content (such as iframes or web
views), additional care must be taken to prevent exposure to malicious external
sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox
rendered content can introduce severe vulnerabilities. Developers are
responsible for implementing appropriate security measures—such as input
sanitization, Content Security Policies (CSP), strict isolation for optional
embedded content, and secure credential handling—to protect their systems and
users.

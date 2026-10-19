# A2UI Rizzcharts Agent Sample

This sample uses the Agent Development Kit (ADK) along with the A2A protocol to create an ecommerce dashboard using a custom catalog that is hosted as an A2A server.

## Prerequisites

- Python 3.9 or higher
- [UV](https://docs.astral.sh/uv/)
- Access to an LLM and API Key

## Running the Sample

1. Navigate to the samples directory:

   ```bash
   cd samples/community/agent/adk/rizzcharts/python
   ```

2. Create an environment file with your API key:

   ```bash
   cp .env.example .env
   # Edit .env with your actual API key (do not commit .env)
   ```

3. Run an agent:

   ```bash
   uv run .
   ```

## How the agent negotiates A2UI

The agent holds one `A2uiGenerator` for each protocol version (v0.8, v0.9 and v1.0), with the rizzcharts catalog of that version (in [`../catalog_schemas`](../catalog_schemas/)) and the basic catalog. The agent card lists the generators' catalogs, one A2UI extension per version.

For each request, the executor ([`agent_executor.py`](agent_executor.py)) creates an `A2uiRequestProcessor` from the client's capabilities: the `a2uiClientCapabilities` message metadata for v0.8 and v0.9, and `a2uiRendererCapabilities` for v1.0. It writes what the request needs into the session state: the format rules of the processor, the catalogs, and the examples for the client's preferred catalog. The instruction ([`prompt_builder.py`](prompt_builder.py)) and `SendA2uiToClientToolset` read these values, so the prompt, the schema and the validation of the `send_a2ui_json_to_client` tool all follow the catalogs of the request.

The capabilities are keyed by protocol version, and the agent passes them to `A2uiGenerator.create_processor` unchanged. A v1.0 request names both catalogs:

```json
{
  "v1.0": {
    "supportedCatalogIds": [
      "https://a2ui.org/samples/community/agent/adk/rizzcharts/catalog_schemas/1.0/rizzcharts_catalog_definition.json",
      "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    ]
  }
}
```

v1.0 mixes catalogs on one surface, so the v1.0 rizzcharts catalog holds only the Canvas, Chart and GoogleMap components. A v1.0 dashboard uses the basic catalog as the surface's default (`createSurface.catalogId`), and each rizzcharts component names the rizzcharts catalog in its own `catalogId`; the prompt and validation get both catalogs. A v0.8 or v0.9 surface uses one catalog, so the rizzcharts catalog of those versions also contains every basic component, and only that catalog is passed on. The examples of each version are in `../examples/<catalog>/<version>`. A client that names only the basic catalog gets dashboards built from it and the examples in `../examples/standard_catalog`. A client that sends no capabilities, or names none of the agent's catalogs, gets text answers.

To print the prompt of a version and validate its examples, run `uv run prompt_builder.py 1.0` (or `0.9`).

## Disclaimer

Important: The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

Developer Responsibility: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.

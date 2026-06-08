# A2UI Agent implementation

The `agent_sdks/python/src/a2ui` directory contains the Python implementation of
the A2UI agent SDK.

## Core Components

The following directories contain the base protocol logic, parsing, and schema operations directly under `src/a2ui/`:

### Schema Management (`src/a2ui/schema`)

- **`manager.py`**: The `A2uiSchemaManager` handles loading specification
  schemas, managing catalogs, and generating system prompts for LLMs.
- **`validator.py`**: Implements `A2uiValidator` for validating A2UI messages
  against JSON schemas and protocol rules.
- **`catalog.py`**: Defines `A2uiCatalog` and `CatalogConfig` for handling
  component libraries.

### Parser (`src/a2ui/parser`)

- **`parser.py`**: Implementation of `parse_response` for synchronous parsing.
- **`streaming.py`**: Incremental streaming parsers with automatic JSON healing and validation.
- **`payload_fixer.py`**: Utilities to automatically correct common LLM output
  issues in A2UI payloads.

## Basic Catalog (`src/a2ui/basic_catalog`)

- **`provider.py`**: Implementation of `BasicCatalog` for handling the basic
  A2UI components.

## A2A (`src/a2ui/a2a`)

- **`extension.py`**: Utilities for managing the A2UI extension URI and activation logic.
- **`parts.py`**: Utilities for creating A2A Parts with A2UI data and helpers for response parsing.

## ADK Extensions (`src/a2ui/adk`)

Support for
the [Agent Development Kit (ADK)](https://github.com/google/adk-python) and A2A
protocol.

- **`send_a2ui_to_client_toolset.py`**: Implementation of
  `SendA2uiToClientToolset` to enable agents to send UI to clients via tool
  calls.

## Running tests

1. Navigate to the directory:

   ```bash
   cd agent_sdks/python
   ```

2. Run the tests

   ```bash
   uv run pytest
   ```

## Building the SDK

To build the SDK, run the following command from the `agent_sdks/python`
directory:

```bash
uv build .
```

## Formatting code

To format the code, run the following command from the `agent_sdks/python`
directory:

```bash
uv run pyink .
```

## Releasing the SDK

See internal guidance at go/a2ui-release-pipy.

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

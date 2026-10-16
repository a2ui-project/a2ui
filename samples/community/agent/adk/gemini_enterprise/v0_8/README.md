# A2UI on Gemini Enterprise

This folder contains examples and scripts to develop and use A2UI agents on
**Google Cloud Gemini Enterprise**.

## Folder Structure

This directory is organized into two sub-folders depending the deployment
methods:

- `cloud_run`: Contains scripts and configuration to deploy an agent to
  **Cloud Run**. This is suitable for building and deploying AI agents
  quickly, leveraging its speed and simplicity.
  - Starts with `cloud_run/README.md`.

- `agent_engine`: Contains code to deploy to **Vertex AI Agent Engine**. Agent
  Engine provides additional features like agent context management, agent
  evaluation, agent lifecycle management, model-based conversation quality
  monitoring, and model tuning with context data.
  - Starts with `agent_engine/README.md`.

## Shared Resources

- `agent.py`: The contact agent. It holds an `A2uiGenerator` with the basic
  catalog for A2UI v0.8, and the agent card lists the generator's catalog ids.
  Each request negotiates its own `A2uiRequestProcessor` from the client's
  `a2uiClientCapabilities`. Gemini Enterprise sends none, so a request without
  them gets `GEMINI_ENTERPRISE_CAPABILITIES`, which name the basic catalog. The processor builds the request's system prompt and
  validates the response with `processor.parse_response`, and the agent retries
  when the response isn't valid A2UI.
- `prompt_builder.py`: Provides prompts including Role, Workflow, and UI
  descriptions, and `get_ui_prompt`, which builds the prompt of a request from
  its processor.
- `agent_executor.py`: A base implementation of an A2A (Agent-to-Agent)
  executor that reads the request and sends the agent's response.
- `contact_data.json`: Fake contact data for demo.
- `tools.py`: A simple tools to find contact data.
- `examples`: Examples for A2UI messages.

## Registration in Gemini Enterprise

Regardless of the deployment method, agents must be registered with Gemini
Enterprise. This involves: 1. **Defining an A2A Agent Card**: Describing the
agent's skills, name, and capabilities (including the **A2UI extension**). 2.
**Configuring Authorization**: Setting up OAuth2 or other authentication
mechanisms to allow the agent to talk to secure services. This is optional for
Cloud Run deployment but **mandatory for Agent Engine deployment**.

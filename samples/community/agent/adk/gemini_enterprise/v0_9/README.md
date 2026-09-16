# A2UI v0.9 Demo agent sample

This sample uses the Agent Development Kit (ADK) and A2UI SDK to
create an "A2UI v0.9 Demo" agent that can be deployed to GCP Cloud Run. The agent
showcases what can be built with Gemini Enterprise A2UI v0.9, rendering rich,
interactive UIs from the Material component catalog and the Gemini Enterprise
custom components (`Canvas`, `IFrameSrcdoc`, `IFrameUrl`).

Ask the agent **"what can you do?"** and it renders an A2UI `Canvas` listing the available demos. It can demo:

- **Material components**: cards, text, buttons, icons, images, badges.
- **Forms & inputs**: `MaterialInput`, `MaterialSelect`, `MaterialCheckbox`,
  `MaterialRadioButton`, `MaterialSlideToggle`, `MaterialSlider`,
  `MaterialChips`, `MaterialButtonToggle`, `MaterialDatepicker`,
  `MaterialTimepicker`.
- **Tabs & layout**: `MaterialTabs`, `MaterialExpansionPanel`,
  `MaterialGridList`, `MaterialRow`, `MaterialColumn`.
- **Data display**: `MaterialTable`, `MaterialProgressBar`,
  `MaterialProgressSpinner`.
- **Dialogs & menus**: `MaterialDialog`, `MaterialMenu`.
- **Canvas**: render content in a resizable side panel (`Canvas` root).
- **Iframe**: `IFrameSrcdoc` (sandboxed agent-supplied HTML) and `IFrameUrl`
  (allowlisted embedded URL).
- **Restaurant finder**: find restaurants and book a table.

This started as a port of the upstream
[A2UI restaurant_finder sample](https://github.com/a2ui-project/a2ui/tree/main/samples/agent/adk/restaurant_finder)
with these notable differences:

1.  **A2UI v0.9 only.** Support for A2UI v0.8 has been removed. The agent only
    advertises and serves the A2UI v0.9 extension.
2.  **Gemini Enterprise composite catalog.** Instead of the bundled
    `BasicCatalog`, the agent uses the A2UI v0.9 Gemini Enterprise composite
    catalog (`gemini_enterprise_composite_catalog.json`), which unions the
    standard Material catalog, the basic catalog, and the Gemini Enterprise
    custom components (`Canvas`, `IFrameSrcdoc`, `IFrameUrl`). Example UI
    templates under `examples/0.9/` use `Material*`, `Canvas`, and `IFrame*`
    components.
3.  **Generic demo.** The agent is no longer restaurant-specific; it generates
    whichever UI best demonstrates the components requested.

## Prerequisites

- Python 3.14 or higher
- [uv](https://docs.astral.sh/uv/)
- Access to an LLM and API key

## Running the Sample

1.  Create an environment file with your API key:

    `cp .env.example .env`

    Edit `.env` with your actual API key (do not commit .env)

2.  Run the agent server:

    `uv run .`

3.  In another terminal window:

    - verify that the agent is available via A2A:

      ```
      curl http://localhost:10002/.well-known/agent-card.json
      ```

    - send a message to the agent:

      ```
      curl http://localhost:10002 \
        -H 'Content-Type: application/json' \
        -d '{
          "jsonrpc": "2.0",
          "id": 1,
          "method": "message/send",
          "params": {
            "message": {
              "role": "user",
              "parts": [{"text": "What can you do?"}],
              "messageId": "1"
            }
          }
        }'
      ```

## Deploying to Cloud Run

`deploy.sh` deploys the agent to Cloud Run from source:

```
./deploy.sh <PROJECT_ID> <SERVICE_NAME> [MODEL_NAME]
```

## Updating the component catalog

`gemini_enterprise_composite_catalog.json` is a copy of the public A2UI v0.9
Gemini Enterprise composite catalog:

```
https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json
```

If the catalog adds or removes components, also update the example templates in
`examples/0.9/` so they continue to validate (the agent loads examples with
`validate_examples=True`).

## Disclaimer

Important: The sample code provided is for demonstration purposes and
illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When
building production applications, it is critical to treat any agent operating
outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard,
messages, artifacts, and task statuses—should be handled as untrusted input. Any
UI definition or data stream received must be treated as untrusted. Developers
are responsible for implementing appropriate security measures—such as input
sanitization, Content Security Policies (CSP), strict isolation for optional
embedded content, and secure credential handling—to protect their systems and
users.

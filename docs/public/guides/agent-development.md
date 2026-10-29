# Agent Development Guide

Build AI agents that generate A2UI interfaces. This guide covers generating and streaming UI messages from LLMs.

## Quick Overview

Building an A2UI agent:

1. **Understand user intent** → Decide what UI to show
2. **Generate A2UI JSON** → Use LLM structured output or prompts
3. **Validate & stream** → Check schema, send to client
4. **Handle actions** → Respond to user interactions

## Start with a simple agent

This guide uses the ADK to build a simple agent, starting with text and upgrading it to A2UI.

See step-by-step instructions at the [ADK quickstart](https://google.github.io/adk-docs/get-started/python/).

```bash
pip install google-adk
adk create my_agent
```

> **TIP**: If you are using `uv` and working within the sample directories (or a project that already depends on `google-adk`), you can use `uv run adk` instead of installing it globally:
>
> ```bash
> uv run adk create my_agent
> ```

Then edit the `my_agent/agent.py` file with a very simple agent for restaurant recommendations.

```python
import json
from google.adk.agents.llm_agent import Agent
from google.adk.tools.tool_context import ToolContext

def get_restaurants(tool_context: ToolContext) -> str:
    """Call this tool to get a list of restaurants."""
    return json.dumps([
        {
            "name": "Xi'an Famous Foods",
            "detail": "Spicy and savory hand-pulled noodles.",
            "imageUrl": "http://localhost:10002/static/shrimpchowmein.jpeg",
            "rating": "★★★★☆",
            "infoLink": "[More Info](https://www.xianfoods.com/)",
            "address": "81 St Marks Pl, New York, NY 10003"
        },
        {
            "name": "Han Dynasty",
            "detail": "Authentic Szechuan cuisine.",
            "imageUrl": "http://localhost:10002/static/mapotofu.jpeg",
            "rating": "★★★★☆",
            "infoLink": "[More Info](https://www.handynasty.net/)",
            "address": "90 3rd Ave, New York, NY 10003"
        },
        {
            "name": "RedFarm",
            "detail": "Modern Chinese with a farm-to-table approach.",
            "imageUrl": "http://localhost:10002/static/beefbroccoli.jpeg",
            "rating": "★★★★☆",
            "infoLink": "[More Info](https://www.redfarmnyc.com/)",
            "address": "529 Hudson St, New York, NY 10014"
        },
    ])

AGENT_INSTRUCTION="""
You are a helpful restaurant finding assistant. Your goal is to help users find and book restaurants using a rich UI.

To achieve this, you MUST follow this logic:

1.  **For finding restaurants:**
    a. You MUST call the `get_restaurants` tool. Extract the cuisine, location, and a specific number (`count`) of restaurants from the user's query (e.g., for "top 5 chinese places", count is 5).
    b. After receiving the data, you MUST follow the instructions precisely to generate the final a2ui UI JSON, using the appropriate UI example from the `prompt_builder.py` based on the number of restaurants."""

root_agent = Agent(
    model='gemini-2.5-flash',
    name="restaurant_agent",
    description="An agent that finds restaurants and helps book tables.",
    instruction=AGENT_INSTRUCTION,
    tools=[get_restaurants],
)
```

Don't forget to set the `GOOGLE_API_KEY` environment variable to run this example.

```bash
echo 'GOOGLE_API_KEY="YOUR_API_KEY"' > .env
```

You can test out this agent with the ADK web interface:

```bash
adk web
```

Select `my_agent` from the list, and ask questions about restaurants in New York. You should see a list of restaurants in the UI as plain text.

## Generating A2UI Messages

Getting the LLM to generate A2UI messages requires some prompt engineering. The SDK's `A2uiRequestProcessor` builds a system prompt snippet for an inference format (Express by default) that includes the rules of the format, the component catalog, and your few-shot examples.

First, make sure you have `a2ui-agent-sdk` and `a2ui-adk` installed (both are included in the samples). The agent SDK does not depend on an agent framework. The A2A and ADK integrations are separate packages: install `a2ui-a2a` to serve A2UI over A2A, `a2ui-adk` to add the A2UI prompt to an ADK agent, and `a2ui-adk[a2a]` to also use the ADK-to-A2A converters.

In your agent file (e.g., `agent.py`), import the necessary classes:

```python
from a2ui.adk import A2uiInstruction
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
```

Then, build an `A2uiRequestProcessor` for the catalogs your agent supports, and pass an `A2uiInstruction` as the agent's instruction. It appends the processor's prompt snippet to your own instruction, so the schema and examples are correctly formatted and up to date. The processor defaults to the Express inference format; this guide passes `DirectJsonFormatFactory()` so the model writes A2UI JSON messages, which the rest of the guide reads.

```python
# Define your agent's role
ROLE_DESCRIPTION = (
    "You are a helpful restaurant finding assistant. Your final output MUST be an"
    " A2UI UI definition."
)

# Define rules for when to use which UI template
UI_DESCRIPTION = """
-   If the query is for a list of restaurants, use the restaurant data you have already received from the `get_restaurants` tool to populate the `updateDataModel.value` object (e.g., for the "items" key).
-   If the number of restaurants is 5 or fewer, you MUST use the `SINGLE_COLUMN_LIST_EXAMPLE` template.
-   If the number of restaurants is more than 5, you MUST use the `TWO_COLUMN_LIST_EXAMPLE` template.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), you MUST use the `BOOKING_FORM_EXAMPLE` template.
-   If the query is a booking submission (e.g., "User submitted a booking..."), you MUST use the `CONFIRMATION_EXAMPLE` template.
"""

# Initialize the processor with the Basic Catalog. Pass `examples=` to add
# few-shot example turns to the prompt.
processor = A2uiRequestProcessor(
    [BasicCatalog(ProtocolVersion.V0_9)],
    format_factory=DirectJsonFormatFactory(),
)

root_agent = Agent(
    model='gemini-2.5-flash',
    name="restaurant_agent",
    description="An agent that finds restaurants and helps book tables.",
    instruction=A2uiInstruction(
        f"{ROLE_DESCRIPTION}\n\n## UI Description:\n{UI_DESCRIPTION}",
        a2ui_processor=processor,
    ),
    tools=[get_restaurants],
)
```

> **WARNING**: Do not pass `processor.prompt_snippet` to `Agent(instruction=...)` as a string. ADK reads `{name}` templates in a string instruction and replaces them with session state, and the A2UI prompt holds braces that are not state keys, such as the `${expression}` in the basic catalog's `formatString` and the data bindings in the examples. Under `adk run` or `adk web` the agent then fails with `KeyError: "Context variable not found: 'expression'."`. `A2uiInstruction` avoids this: it is a callable instruction provider, which ADK uses as it is, and it still reads `{name}` templates out of your own instruction string. If you only have `a2ui-agent-sdk` and `google-adk` installed, a plain callable has the same effect on the templates: `instruction=lambda _ctx: A2UI_AND_AGENT_INSTRUCTION`.

## Understanding the Output

Your agent will no longer strictly output text. Instead, it will output text and, between `<a2ui-json>` tags, a **JSON list** of A2UI messages such as `createSurface`, `updateComponents`, and `updateDataModel`.

Do not parse that JSON yourself: models put Markdown fences around it and make other small mistakes. The processor's `parse_response` method reads the response in the processor's inference format, repairs what it can, and validates every message against the catalogs, so your client never receives malformed UI instructions.

```python
from a2ui.parser import A2uiPart

# `response_text` is the text of the model's final response.
for part in processor.parse_response(response_text):
    if isinstance(part, A2uiPart):
        # A list of validated A2UI messages, ready to send to the client.
        send_to_client(part.a2ui)
    else:
        # Plain text between the A2UI blocks.
        send_to_client(part.text)
```

`parse_response` raises `A2uiParseError` when a block cannot be read and `A2uiValidationError` when a message does not match the catalog; the `restaurant_finder` sample catches these and asks the model to try again.

TODO: Continue this guide with examples of how to send the output to the client renderer without the A2A extension.

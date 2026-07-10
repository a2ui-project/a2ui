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

Getting the LLM to generate A2UI messages requires some prompt engineering. The SDK provides the `A2uiSchemaManager` to help you generate a system prompt that includes the A2UI schema and examples from your component catalog.

First, make sure you have `a2ui-agent-sdk` installed (it is included in the samples).

In your agent file (e.g., `agent.py`), import the necessary classes:

```python
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.basic_catalog.provider import BasicCatalog
```

Then, you can use `A2uiSchemaManager` to generate the system prompt. This ensures that the schema and examples are correctly formatted and up to date.

```python
# Define your agent's role
ROLE_DESCRIPTION = (
    "You are a helpful restaurant finding assistant. Your final output MUST be a a2ui"
    " UI JSON response."
)

# Define rules for when to use which UI template
UI_DESCRIPTION = """
-   If the query is for a list of restaurants, use the restaurant data you have already received from the `get_restaurants` tool to populate the `dataModelUpdate.contents` (v0.8) or `updateDataModel.value` (v0.9+) object (e.g., for the "items" key).
-   If the number of restaurants is 5 or fewer, you MUST use the `SINGLE_COLUMN_LIST_EXAMPLE` template.
-   If the number of restaurants is more than 5, you MUST use the `TWO_COLUMN_LIST_EXAMPLE` template.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), you MUST use the `BOOKING_FORM_EXAMPLE` template.
-   If the query is a booking submission (e.g., "User submitted a booking..."), you MUST use the `CONFIRMATION_EXAMPLE` template.
"""

# Initialize the schema manager with the Basic Catalog
schema_manager = A2uiSchemaManager(
    version=VERSION_0_8, # Use VERSION_0_9 for newer protocol
    catalogs=[
        BasicCatalog.get_config(
            version=VERSION_0_8, examples_path="examples/0.8"
        )
    ],
)

# Generate the full system prompt
A2UI_AND_AGENT_INSTRUCTION = schema_manager.generate_system_prompt(
    role_description=ROLE_DESCRIPTION,
    ui_description=UI_DESCRIPTION,
    include_schema=True,
    include_examples=True,
    validate_examples=True,
)

root_agent = Agent(
    model='gemini-2.5-flash',
    name="restaurant_agent",
    description="An agent that finds restaurants and helps book tables.",
    instruction=A2UI_AND_AGENT_INSTRUCTION,
    tools=[get_restaurants],
)
```

## Understanding the Output

Your agent will no longer strictly output text. Instead, it will output text and a **JSON list** of A2UI messages.

The `A2UI_SCHEMA` that we imported is a standard JSON schema that defines valid operations like:

- `render` (displaying a UI)
- `update` (changing data in an existing UI)

Because the output is structured JSON, you may parse and validate it before sending it to the client.

```python
# 1. Parse the JSON
# Warning: Parsing the output as JSON is a fragile implementation useful for documentation.
# LLMs often put Markdown fences around JSON output, and can make other mistakes.
# Rely on frameworks to parse the JSON for you.
parsed_json_data = json.loads(json_string_cleaned)

# 2. Validate against A2UI_SCHEMA
# This ensures the LLM generated valid A2UI commands
jsonschema.validate(
    instance=parsed_json_data, schema=self.a2ui_schema_object
)
```

By validating the output against `A2UI_SCHEMA`, you ensure that your client never receives malformed UI instructions.

TODO: Continue this guide with examples of how to parse, validate, and send the output to the client renderer without the A2A extension.

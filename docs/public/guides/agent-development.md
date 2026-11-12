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
from a2ui.inference_formats import DirectJsonFormatFactory
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
    [BasicCatalog(ProtocolVersion.V1_0)],
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

> **WARNING**: Do not pass `processor.prompt_snippet` to `Agent(instruction=...)` as a string. ADK reads `{name}` templates in a string instruction and replaces them with session state, and the A2UI prompt holds braces that are not state keys, such as the `${expression}` in the basic catalog's `formatString` and the data bindings in the examples. Under `adk run` or `adk web` the agent then fails with `KeyError: "Context variable not found: 'expression'."`. `A2uiInstruction` avoids this: it is a callable instruction provider, which ADK uses as it is, and it still reads `{name}` templates out of your own instruction string. If you only have `a2ui-agent-sdk` and `google-adk` installed, a plain callable has the same effect on the templates: `instruction=lambda _ctx: f"{ROLE_DESCRIPTION}\n\n## UI Description:\n{UI_DESCRIPTION}\n\n{processor.prompt_snippet}"`.

## Understanding the Output

Your agent will no longer strictly output text. Instead, it will output text and, between `<a2ui-json>` tags, a **JSON list** of A2UI messages. In v1.0, each message has `"version": "1.0"` and exactly one of these keys, as defined in [`agent_to_renderer.json`](https://a2ui.org/specification/v1_0/agent_to_renderer.json):

- `createSurface` creates a surface and names the catalog it uses.
- `updateComponents` adds or replaces components on a surface.
- `updateDataModel` sets a value in a surface's data model.
- `deleteSurface` removes a surface.
- `callRendererFunction` asks the renderer to run a function from its catalog.
- `agentFunctionResponse` returns the result of a function the renderer asked the agent to run.

A model writing a UI usually emits `createSurface`, then `updateComponents` and `updateDataModel`:

```json
[
  {
    "version": "1.0",
    "createSurface": {
      "surfaceId": "restaurants",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "1.0",
    "updateComponents": {
      "surfaceId": "restaurants",
      "components": [{"id": "root", "component": "Text", "text": "Top restaurants"}]
    }
  }
]
```

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

## Sending messages to the client

A2UI does not require a particular transport. Without the A2A extension, you can send each message as JSON over Server-Sent Events (SSE), WebSockets, or any other channel your client reads. `A2uiPart.a2ui` holds message models, so convert each one to a dictionary before you serialize it:

```python
import json

from a2ui.parser import A2uiPart


def to_json_lines(parts):
    """Yields one JSON line per A2UI message, skipping plain text parts."""
    for part in parts:
        if isinstance(part, A2uiPart):
            for message in part.a2ui:
                payload = message.model_dump(by_alias=True, exclude_unset=True)
                yield json.dumps(payload) + "\n"
```

### Stream the response

`parse_response` needs the whole response. To show the UI while the model is still writing, open a stream with `processor.open_stream()`, pass each chunk of model text to `feed`, and call `close` after the last chunk. Both return the parts that are ready: text as it arrives, and A2UI messages once each message is complete and valid.

```python
async def stream_a2ui(model_chunks):
    """Reads the model's text chunks and yields validated A2UI messages."""
    stream = processor.open_stream()
    async for chunk in model_chunks:
        for part in stream.feed(chunk):
            if isinstance(part, A2uiPart):
                for message in part.a2ui:
                    yield message.model_dump(by_alias=True, exclude_unset=True)
    for part in stream.close():
        if isinstance(part, A2uiPart):
            for message in part.a2ui:
                yield message.model_dump(by_alias=True, exclude_unset=True)
```

If a block fails, `feed` or `close` raises `A2uiParseError` or `A2uiValidationError` (both from `a2ui.core`) and the stream ends. The error's `partial_results` holds the parts that were ready before the failure. The client already shows the messages from earlier chunks, so send these parts too before you ask the model to try again.

A minimal SSE endpoint with FastAPI looks like this, where `call_model` is any function that yields the model's text chunks:

```python
import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


@app.post("/api/agent")
async def handle_agent(request: Request):
    body = await request.json()

    async def event_stream():
        async for payload in stream_a2ui(call_model(body["prompt"])):
            yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

### Structured JSON output

If you ask the model for JSON only (for example, with `response_mime_type="application/json"` in Gemini), the response has no `<a2ui-json>` tags: the whole response is one JSON list of messages. Pass `wrapped=False` to read it:

```python
parts = processor.parse_response(response_text, wrapped=False)
```

`open_stream(wrapped=False)` does the same for a streamed response.

For a complete walkthrough with capability negotiation, renderer actions, and TypeScript and Dart examples, see the [Agent integration guide](https://a2ui.org/guides/agent-integration/).

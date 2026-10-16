# Agent Development

Use the A2UI agent SDK to add A2UI to an agent in any framework, or in no
framework at all. The SDK doesn't call a model or depend on an agent
framework. It does three things around your own model call:

1. **Negotiate catalogs** with the client, from the catalogs the client says
   it can render.
2. **Write the prompt snippet** that teaches the model the A2UI format, your
   catalog's components, and your examples.
3. **Parse and validate** the model's response into text and A2UI messages,
   in one piece or as it streams.

If your agent runs on ADK, Genkit, or an AG-UI framework, start with the
[ADK](adk.md), [Genkit](genkit.md), or [CopilotKit](copilotkit.md)
integration instead. They wrap these steps for you.

## Install

```bash
pip install a2ui-agent-sdk
```

!!! note "Package availability"

    The API on this page is in the next release of `a2ui-agent-sdk`. Version
    0.8.0 on PyPI has an older API, without `a2ui.processor`. Until the next
    release, install the SDK from a clone of this repository:

    ```bash
    git clone https://github.com/a2ui-project/a2ui.git
    cd a2ui
    uv sync --all-packages
    ```

The SDK also exists for TypeScript ([`@a2ui/agent`](../../../typescript/agents/a2ui_agent))
and Dart ([`a2ui_agent`](../../../dart/a2ui_agent)), with the same
`A2uiGenerator` and request processor design. Both are pre-release.

## 1. Create a generator

Create one `A2uiGenerator` when your agent starts. Give it the catalogs your
agent can use and, optionally, few-shot examples. Each example is one turn:
a list of A2UI messages.

```python
import json
import pathlib

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, CatalogConfig

EXAMPLES_DIR = pathlib.Path(__file__).parent / "examples"

examples = [
    json.loads(path.read_text()) for path in sorted(EXAMPLES_DIR.glob("*.json"))
]
generator = A2uiGenerator(
    [CatalogConfig(BasicCatalog(ProtocolVersion.V0_9_1))],
    examples=examples,
)
```

The [restaurant finder sample](../../../samples/agent/adk/restaurant_finder/examples/0.9)
has examples you can copy. To use your own components, load a catalog with
`CatalogConfig.from_path` instead of `BasicCatalog`. See
[Defining Your Own Catalog](../guides/defining-your-own-catalog.md).

## 2. Create a processor for each request

Clients send their capabilities with each request: the protocol versions and
catalog IDs they can render. Pass them to `create_processor`. The processor
keeps the catalogs that you and the client have in common.

```python
catalog_id = generator.catalogs[0].transformed_catalog.catalog_id

# Usually from the request. Capabilities for v0.9 and v0.9.1 use the "v0.9" key.
capabilities = {"v0.9": {"supportedCatalogIds": [catalog_id]}}
processor = generator.create_processor(capabilities)
```

How capabilities arrive depends on the transport. Over A2A, they are in the
message metadata. See the
[A2A extension specification](../specification/v0.9.1-a2ui-extension-specification.md).

## 3. Build the prompt

Add `processor.prompt_snippet` to your system prompt. It contains the rules
for writing A2UI, the schema of the active catalogs, and your examples. Add
your own instructions about when to show which UI.

```python
system_prompt = "\n\n".join([
    "You are a helpful restaurant finding assistant.",
    "## UI Description:\nShow lists of restaurants as a Column of Cards.",
    processor.prompt_snippet,
])

llm_output = call_your_model(system_prompt, user_message)
```

`call_your_model` stands for any model SDK. The model answers with text and
A2UI messages in `<a2ui-json>` blocks:

```text
Here are two great spots.
<a2ui-json>
[
  {"version": "v0.9.1", "createSurface": {"surfaceId": "results",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}},
  {"version": "v0.9.1", "updateComponents": {"surfaceId": "results", "components": [
    {"id": "root", "component": "Column", "children": ["title"]},
    {"id": "title", "component": "Text", "variant": "h2", "text": {"path": "/title"}}
  ]}},
  {"version": "v0.9.1", "updateDataModel": {"surfaceId": "results", "path": "/",
    "value": {"title": "Top Szechuan in NYC"}}}
]
</a2ui-json>
```

These are the v0.9 message types: `createSurface`, `updateComponents`,
`updateDataModel`, and `deleteSurface`. See the
[Message Reference](../reference/messages.md).

## 4. Parse and validate the response

`parse_response` splits the response into text parts and A2UI parts, and
validates each A2UI part against the active catalogs. If the model wrote
invalid JSON or used a component that isn't in the catalog, it raises an
`A2uiError`. Send the error back to the model and ask it to try again.

```python
from a2ui.core import A2uiError
from a2ui.parser import A2uiPart, TextPart, to_message_dicts

try:
    parts = processor.parse_response(llm_output)
except A2uiError as error:
    ...  # Ask the model to fix the output, including str(error).

for part in parts:
    if isinstance(part, TextPart):
        send_text(part.text)
    elif isinstance(part, A2uiPart):
        send_a2ui(to_message_dicts(part.a2ui))
```

`to_message_dicts` returns plain dictionaries that you can serialize to JSON
for any [transport](../concepts/transports.md). `send_text` and `send_a2ui`
stand for your transport.

To check a payload that you built yourself, or got some other way, call
`validate_payload` from `a2ui.utils`:

```python
from a2ui.utils import validate_payload

validate_payload(processor.active_catalogs, messages)
```

## 5. Stream the response

To render the UI while the model is still writing, create a parser for each
response and pass it chunks as they arrive. `parse_chunk` returns the parts
that are complete so far, so the client can render components as soon as
they exist.

```python
parser = processor.create_parser()

async for chunk in model_stream:
    for part in parser.parse_chunk(chunk):
        if isinstance(part, TextPart):
            send_text(part.text)
        elif isinstance(part, A2uiPart):
            send_a2ui(to_message_dicts(part.a2ui))
```

## 6. Handle user actions

When the user presses a button on a surface, the client sends an `action`
message to the agent. Its `context` holds the values that the button's
`action.event.context` names, with data bindings resolved:

```json
{
  "version": "v0.9.1",
  "action": {
    "name": "book_table",
    "surfaceId": "booking",
    "sourceComponentId": "submit",
    "timestamp": "2026-09-16T19:30:00Z",
    "context": {"restaurant": "Han Dynasty", "partySize": 4}
  }
}
```

Treat the action as the next turn: describe it to the model, for example as
a user message, and parse the model's answer as above. The model can update
the same surface by sending messages with the same `surfaceId`. See
[Actions](../concepts/actions.md).

## Next steps

- **[ADK](adk.md)**: Use the SDK's ADK toolset and serve the agent over A2A.
- **[Defining Your Own Catalog](../guides/defining-your-own-catalog.md)**:
  Describe your design system's components to the agent.
- **[Python agent SDK reference](../../../python/a2ui_agent)**: Catalog
  transformers, inference formats, and utilities.

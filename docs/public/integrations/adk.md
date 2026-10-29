# ADK

Use this guide to add A2UI to an agent built with Google's
[Agent Development Kit (ADK)](https://google.github.io/adk-docs/). The
[`a2ui-adk`](../../../python/a2ui_adk) package gives your agent a tool that
sends A2UI to the client. The tool describes your catalog to the model and
validates every payload before it leaves the agent.

There are two ways to connect an ADK agent to a client:

- **A2A** (this guide): serve the agent over the
  [A2A protocol](https://a2a-protocol.org/) with the A2UI extension. Any A2UI
  renderer that speaks A2A can show its surfaces, including the
  [sample clients](../../../samples/client).
- **AG-UI**: wrap the agent with the AG-UI ADK middleware and render it with
  CopilotKit. See [CopilotKit](copilotkit.md).

## Install

```bash
pip install google-adk "a2ui-adk[a2a]"
```

The `a2a` extra adds what you need to serve the agent over A2A. Leave it out
if you only need the tool.

!!! note "Package availability"

    `a2ui-adk` and `a2ui-a2a` are being split out of `a2ui-agent-sdk` and are
    not on PyPI yet. Until they are, install them from a clone of this
    repository:

    ```bash
    git clone https://github.com/a2ui-project/a2ui.git
    cd a2ui
    uv sync --all-packages
    ```

    `a2ui-agent-sdk` 0.8.0 on PyPI still contains `a2ui.adk` and `a2ui.a2a`,
    with a few older names: `SendA2uiToClientToolset` takes
    `a2ui_catalog=CATALOG` instead of `a2ui_catalogs=[CATALOG]`,
    `load_examples` is in `a2ui.schema`, and the session-state key for
    catalogs is `system:a2ui_catalog`. Don't install 0.8.0 next to the new
    packages, because both contain the same modules.

## 1. Create an agent

Create an ADK agent with the ADK CLI, or start from an agent you already
have. See the [ADK quickstart](https://google.github.io/adk-docs/get-started/python/).

```bash
adk create my_agent
```

Set your Gemini API key:

```bash
echo 'GOOGLE_API_KEY="YOUR_API_KEY"' > my_agent/.env
```

## 2. Give the agent the A2UI tool

Add `SendA2uiToClientToolset` to the agent's tools. It adds a tool named
`send_a2ui_json_to_client`, and before each model call it adds the A2UI
schema of your catalogs and your examples to the system instruction.

```python title="my_agent/agent.py"
import json
import pathlib

from google.adk.agents import LlmAgent

from a2ui.adk import SendA2uiToClientToolset
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import load_examples

EXAMPLES_DIR = pathlib.Path(__file__).parent / "examples"

CATALOG = BasicCatalog(ProtocolVersion.V0_9_1)
EXAMPLES = load_examples([CATALOG], str(EXAMPLES_DIR), validate=True)


def get_restaurants(cuisine: str, location: str) -> str:
    """Returns restaurants that match a cuisine and a location."""
    return json.dumps([
        {
            "name": "Han Dynasty",
            "detail": "Authentic Szechuan cuisine.",
            "address": "90 3rd Ave, New York, NY 10003",
        },
    ])


root_agent = LlmAgent(
    model="gemini-2.5-flash",
    name="restaurant_agent",
    description="Finds restaurants and shows them as rich UI.",
    instruction=(
        "You help users find restaurants. Call get_restaurants, then call"
        " send_a2ui_json_to_client with an A2UI payload that shows the"
        " results. Base the payload on the examples."
    ),
    tools=[
        get_restaurants,
        SendA2uiToClientToolset(
            a2ui_enabled=True,
            a2ui_catalogs=[CATALOG],
            a2ui_examples=EXAMPLES,
        ),
    ],
)
```

The examples are few-shot A2UI payloads, one JSON file per example. To start,
copy the examples of the
[restaurant finder sample](../../../samples/agent/adk/restaurant_finder/examples/0.9)
into `my_agent/examples`. `load_examples` checks them against the catalog
when the agent starts.

Each of the three arguments takes a value or a function of the ADK
`ReadonlyContext`, sync or async. For example, return `False` from
`a2ui_enabled` when the client can't render A2UI, and the tool isn't offered
to the model.

### What the tool does with a payload

When the model calls `send_a2ui_json_to_client`, the tool fixes common
formatting mistakes in the JSON and then validates it against the catalogs:

- **Valid payload:** the tool returns it under `validated_a2ui_json` and ends
  the turn without a model summary.
- **Invalid payload:** the tool returns an `error` that says what is wrong,
  such as an unknown component type or a child that doesn't exist. The model
  sees the error and can try again.

!!! tip "Use your own catalog"

    Replace `BasicCatalog` with a catalog that describes your design system's
    components. See [Defining Your Own Catalog](../guides/defining-your-own-catalog.md).
    To limit the components the model may use, wrap the catalog in
    `CatalogConfig` with a `ComponentPruningTransformer` from the
    [agent SDK](agent-development.md).

## 3. Serve the agent over A2A

To reach a client, serve the agent with ADK's `A2aAgentExecutor` and the
A2UI event converter. The agent card advertises the A2UI extension. When a
client asks for the extension, the executor turns A2UI on for that session,
and `A2uiEventConverter` sends each validated payload to the client as an
A2UI data part.

```python title="server.py"
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from google.adk.a2a.executor.a2a_agent_executor import (
    A2aAgentExecutor,
    A2aAgentExecutorConfig,
)
from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.events import Event, EventActions
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
import uvicorn

from a2ui.a2a import get_a2ui_agent_extension, try_activate_a2ui_extension
from a2ui.adk import A2uiEventConverter, SendA2uiToClientToolset
from a2ui.core.schema import ProtocolVersion

from my_agent.agent import CATALOG, EXAMPLES, get_restaurants

A2UI_ENABLED_KEY = "system:a2ui_enabled"
A2UI_CATALOGS_KEY = "system:a2ui_catalogs"

agent = LlmAgent(
    model="gemini-2.5-flash",
    name="restaurant_agent",
    instruction=(
        "Find restaurants with get_restaurants. When UI is available, show"
        " them with send_a2ui_json_to_client."
    ),
    tools=[
        get_restaurants,
        # Offer the UI tool only when the client asked for A2UI.
        SendA2uiToClientToolset(
            a2ui_enabled=lambda ctx: ctx.state.get(A2UI_ENABLED_KEY, False),
            a2ui_catalogs=[CATALOG],
            a2ui_examples=EXAMPLES,
        ),
    ],
)

agent_card = AgentCard(
    name="Restaurant Agent",
    description="Finds restaurants.",
    url="http://localhost:10002",
    version="1.0.0",
    default_input_modes=["text/plain"],
    default_output_modes=["text/plain"],
    capabilities=AgentCapabilities(
        streaming=True,
        extensions=[
            get_a2ui_agent_extension(
                ProtocolVersion.V0_9,
                supported_catalog_ids=[CATALOG.catalog_id],
            ),
        ],
    ),
    skills=[
        AgentSkill(
            id="find_restaurants",
            name="Find restaurants",
            description="Finds restaurants by cuisine and location.",
            tags=["restaurants"],
        ),
    ],
)


class RestaurantAgentExecutor(A2aAgentExecutor):
    """Turns A2UI on for a session when the client asks for it."""

    def __init__(self, runner: Runner):
        super().__init__(
            runner=runner,
            config=A2aAgentExecutorConfig(event_converter=A2uiEventConverter()),
        )

    async def _prepare_session(self, context, run_request, runner):
        session = await super()._prepare_session(context, run_request, runner)
        if try_activate_a2ui_extension(context, agent_card):
            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={
                            A2UI_ENABLED_KEY: True,
                            A2UI_CATALOGS_KEY: [CATALOG],
                        },
                    ),
                ),
            )
        return session


runner = Runner(
    app_name="restaurant_agent",
    agent=agent,
    session_service=InMemorySessionService(),
)
handler = DefaultRequestHandler(
    agent_executor=RestaurantAgentExecutor(runner),
    task_store=InMemoryTaskStore(),
)
app = A2AStarletteApplication(agent_card=agent_card, http_handler=handler)

if __name__ == "__main__":
    uvicorn.run(app.build(), host="localhost", port=10002)
```

Run the server and check the agent card:

```bash
python server.py
curl http://localhost:10002/.well-known/agent-card.json
```

The card lists the A2UI extension. A client that sends the
`X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9` header gets
A2UI surfaces back. A client that doesn't send it gets text only, because the
tool is never offered to the model.

!!! note "Extension version"

    Advertise the extension as v0.9, as above. Messages use protocol v0.9.1,
    but clients ask for the extension by its exact URI, and the sample
    clients ask for `.../a2ui/v0.9`.

## 4. Connect a client

Point any A2UI client that speaks A2A at `http://localhost:10002`. The
[Quickstart](../quickstart.md) runs the restaurant finder agent with the Lit
client, and [Client Setup](../guides/client-setup.md) shows how to add a
renderer to your own app.

!!! info "Testing with `adk web`"

    The ADK dev UI renders A2UI v0.8 only. Use `adk web` to test your agent's
    logic and the tool's validation errors, and use an A2UI client to see
    v0.9 surfaces.

## Samples

| Sample                                                                    | What it shows                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Restaurant finder](../../../samples/agent/adk/restaurant_finder)         | An ADK agent that writes A2UI in its response with the [agent SDK](agent-development.md), over A2A. |
| [Rizzcharts](../../../samples/community/agent/adk/rizzcharts/python)      | `SendA2uiToClientToolset` and `A2uiEventConverter` with a custom catalog of charts, over A2A.       |
| [Custom components](../../../samples/agent/adk/custom-components-example) | An ADK agent with an inline custom catalog.                                                         |
| [Orchestrator](../../../samples/community/agent/adk/orchestrator)         | An orchestrator that routes surfaces from several A2A subagents with `A2uiSubagentMap`.             |

## Next steps

- **[Agent Development](agent-development.md)**: Prompt for, parse, and stream
  A2UI with the framework-agnostic agent SDK.
- **[CopilotKit](copilotkit.md)**: Serve the same ADK agent over AG-UI.
- **[A2A extension specification](../specification/v0.9.1-a2ui-extension-specification.md)**:
  How A2UI travels over A2A.

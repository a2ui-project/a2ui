# A2A Agent Development Guide

This guide explains how to build AI agents that generate A2UI interfaces using
`agent_sdk`. The SDK simplifies schema management, prompt engineering, and
message validation for A2A (Agent-to-Agent/Agent-to-Client) communication.

## Core Concepts

The `agent_sdk` revolves around three main classes:

- **`CatalogConfig`**: Defines the metadata for a component catalog (name,
  schema path, examples path).
- **`A2uiCatalog`**: Represents a processed catalog, providing methods for
  validation and LLM instruction rendering.
- **`A2uiSchemaManager`**: The central coordinator that loads catalogs, manages
  versioning, and generates system prompts.

## Prerequisites

- Install the SDK: `pip install a2ui-agent-sdk`

## Generating A2UI Messages

### Step 1: Set up the Schema Manager

The first step in any A2UI-enabled agent is initializing the
`A2uiSchemaManager`.

```python
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.basic_catalog.provider import BasicCatalog

# Define your catalogs (basic or bring your own) with optional examples
basic_catalog_config = BasicCatalog.get_config(
    version=VERSION_0_9,
    examples_path="examples"
)
my_catalog_config = CatalogConfig.from_path(
    name="my_custom_catalog",
    catalog_path="path/to/catalog.json",
    examples_path="path/to/examples"
)

# Initialize the schema manager with your catalogs
schema_manager = A2uiSchemaManager(
    version=VERSION_0_9,
    catalogs=[basic_catalog_config, my_catalog_config],
)
```

Notes:

- The `catalogs` parameter is optional. If not provided, the schema manager will
  use the basic catalog maintained by the A2UI team.
- The provided catalogs must be freestanding, i.e. they should not reference any
  external schemas or components, except for the common types.
- If you have a modular catalog that references other catalogs, refer
  to [Freestanding Catalogs](../../../docs/catalogs.md#freestanding-catalogs)
  for more information.
- You can define multiple `A2uiSchemaManager` instances (one for each protocol version)
  and select the active one at runtime based on the client request.
  See [Multiple Version Support](#3-multiple-version-support) for more details.

### Step 2: Generate System Prompt

Use the `generate_system_prompt` method to assemble the LLM's system
instructions. This method takes your high-level descriptions (role, workflow, UI
goals) and automatically injects the relevant A2UI JSON Schema and few-shot
examples from your catalog configuration.

```python
instruction = schema_manager.generate_system_prompt(
    role_description="You are a helpful assistant...",
    workflow_description="Analyze the request and return UI...",
    ui_description="Use the following components...",
    include_schema=True,  # Injects the raw JSON schema
    include_examples=True,  # Injects few-shot examples
    # Optional: prune schema to save tokens
    allowed_components=["Heading", "Text", "Button"],
    allowed_messages=["CreateSurfaceMessage", "UpdateSurfaceMessage"],
)
```

### Step 3: Build an LLM Agent with the System Prompt

Configure your `LlmAgent` using the generated system instructions. This agent
serves as the core logic for interpreting user queries and deciding when to
generate rich UI responses.

```python
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.lite_llm import LiteLlm

agent = LlmAgent(
    model=LiteLlm(model=LITELLM_MODEL),
    name="Your agent name",
    description="Your agent description.",
    instruction=instruction,
    tools=[Your tools],
)
```

### Step 4: Process Request and Stream UI

The final step is to build an executor (or a custom streaming handler) that
manages the runtime lifecycle of a request: running the LLM, validating the
generated JSON, and streaming parts to the client.

#### 4a. Build an Agent Executor

Build an agent executor that uses the agent to process requests.

```python
from a2a.server.agent_execution import AgentExecutor


class MyAgentExecutor(AgentExecutor):
  def __init__(self, agent: LlmAgent, ...):
    self.agent = agent
    ...


agent_executor = MyAgentExecutor(
    agent=agent,
    ...
)
```

#### 4b. A2UI Extension Version Negotiation

Before processing a request, negotiate which version of the A2UI extension to activate based on the client request and your agent's advertised capabilities.

```python
from a2ui.a2a.extension import try_activate_a2ui_extension

# In your request handler:
activated_version = try_activate_a2ui_extension(context, agent_card)

if activated_version:
    # Use the activated version to route requests to the schema manager
    schema_manager = schema_managers[activated_version]
    selected_catalog = schema_manager.get_selected_catalog(context)
```

#### 4c. Select a Parsing Strategy

Depending on your latency requirements, choose between waiting for the full response or parsing text chunks incrementally.

##### Option A: Full-Response Parsing

Use this approach if you wait for the LLM to finish its entire response before processing and sending UI to the client. It is simpler to implement.

**1. Parse, Validate, and Fix**

Validate the LLM's JSON output before returning it. The SDK's `A2uiCatalog` validates the payload and attempts to fix simple errors (e.g., trailing commas).

```python
from a2ui.parser.parser import parse_response

# Parse the full response into parts
response_parts = parse_response(full_text)

for part in response_parts:
  if part.a2ui_json:
    # Validate against schema
    selected_catalog.validator.validate(part.a2ui_json)
```

**2. Stream the A2UI Payload**

Wrap the validated payloads in an A2A `DataPart` with the correct MIME type (`application/a2ui+json`) and stream it.

**Recommendation:** Use the `create_a2ui_part` helper.

**3. Complete Agent Output Structure (Helper)**

The `parse_response_to_parts` helper is the most efficient way to split text, extract JSON, validate, and wrap into A2A `Part` objects in one go.

```python
from a2ui.a2a.parts import parse_response_to_parts

yield {
    "is_task_complete": True,
    "parts": parse_response_to_parts(full_text),
}
```

##### Option B: Incremental Streaming Parsing (Advanced)

Use this approach for sub-second UI updates. The `A2uiStreamParser` **automatically parses, validates, and fixes (heals)** the JSON payload chunks _incrementally_ as they arrive from the LLM stream. It yields valid UI messages _before_ the entire JSON block is complete by automatically closing open quotes and braces.

> [!IMPORTANT]
> **Prerequisite**: To use incremental streaming, your agent executor must support streaming mode. In ADK, enable this using `RunConfig`:
>
> ```python
> run_config=run_config.RunConfig(
>     streaming_mode=run_config.StreamingMode.SSE
> )
> ```

```python
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.a2a.parts import create_a2ui_part

parser = A2uiStreamParser(catalog=selected_catalog)

# Inside your LLM stream loop:
for chunk in llm_response_stream:
    # Process text chunks as they arrive
    response_parts = parser.process_chunk(chunk.text)

    for part in response_parts:
        if part.a2ui_json:
            # Yield partial UI updates immediately
            yield {
                "is_task_complete": False,
                "parts": [create_a2ui_part(p) for p in part.a2ui_json]
            }
        if part.text:
            # Yield conversational text
            yield {
                "is_task_complete": False,
                "parts": [DataPart(text=part.text, mime_type="text/plain")]
            }
```

> [!TIP]
> `A2uiStreamParser` performs content-based change detection to ensure components are only re-yielded if their content changes, minimizing bandwidth usage.

## Use Cases

### 1. Simple Agents with Static Schemas

For agents with a fixed set of UI capabilities, simply use the `schema_manager`
to generate the system instruction.

**Example Samples:**
[restaurant_finder](../../../samples/agent/adk/restaurant_finder)

```python
# Generate system prompt
instruction = schema_manager.generate_system_prompt(
    role_description="You are a helpful assistant...",
    workflow_description="Analyze the request and return UI...",
    ui_description="Use the following components...",
    include_schema=True,
    include_examples=True,
)

# Use with your LLM framework (e.g., ADK)
agent = LlmAgent(instruction=instruction, ...)
```

### 2. Dynamic Schemas (Context-Aware)

Some agents may need to attach different catalogs or examples depending on the
user's request, client capabilities, or conversational context. This is common
for dashboard-style agents that support multiple distinct visualization types (
e.g., Charts vs. Maps).

**Example Sample:** [rizzcharts](../../../samples/agent/adk/rizzcharts/python)

#### 2a. Injecting Catalogs into Session State

In a dynamic scenario, you don't provide a static catalog to the agent. Instead,
you resolve the selected catalog at runtime (e.g., during session preparation)
and store it in the session state.

```python
# In your AgentExecutor subclass
async def _prepare_session(self, context, run_request, runner):
  session = await super()._prepare_session(context, run_request, runner)

  # 1. Determine client capabilities from metadata
  capabilities = context.message.metadata.get("a2ui_client_capabilities")

  # 2. Get selected catalog and load examples
  a2ui_catalog = self.schema_manager.get_selected_catalog(
      client_ui_capabilities=capabilities
  )
  examples = self.schema_manager.load_examples(a2ui_catalog, validate=True)

  # 3. Store in session state for tool access
  await runner.session_service.append_event(
      session,
      Event(
          actions=EventActions(
              state_delta={
                  "system:a2ui_enabled": True,
                  "system:a2ui_catalog": a2ui_catalog,
                  "system:a2ui_examples": examples,
              }
          ),
      ),
  )
  return session
```

#### 2b. Accessing Catalogs via Providers

The `SendA2uiToClientToolset` can use **Providers**—callables that retrieve the
catalog and examples from the current context state at runtime.

```python
# Providers that read from context state
def get_a2ui_catalog(ctx: ReadonlyContext):
  return ctx.state.get("system:a2ui_catalog")


def get_a2ui_examples(ctx: ReadonlyContext):
  return ctx.state.get("system:a2ui_examples")


# Initialize the toolset with providers
ui_toolset = SendA2uiToClientToolset(
    a2ui_enabled=True,
    a2ui_catalog=get_a2ui_catalog,
    a2ui_examples=get_a2ui_examples,
)
```

#### 2c. Runtime Validation

When the LLM calls the UI tool, the toolset uses the dynamic catalog to:

1. **Generate Instructions**: Inject the specific schema and examples into the
   LLM's system prompt for that turn.
2. **Parse and Fix Payloads**: Parse and fix the LLM's generated JSON using the
   parser and payload-fixer.
3. **Validate Payloads**: Validate the LLM's generated JSON against the specific
   `A2uiCatalog` object's validator.

### 3. Multiple Version Support

To support multiple protocol versions (e.g., v0.8 and v0.9), pre-configure `A2uiSchemaManager` and `LlmAgent` instances for each version during your agent's initialization. At runtime, use `try_activate_a2ui_extension` to negotiate the version and select the pre-configured schema manager or runner.

```python
# During Initialization (Setup mapping for each supported version)
schema_managers = {
    VERSION_0_8: A2uiSchemaManager(
        version=VERSION_0_8,
        catalogs=[...],
    ),
    VERSION_0_9: A2uiSchemaManager(
        version=VERSION_0_9,
        catalogs=[...],
    ),
}
ui_runners = {
    VERSION_0_8: build_runner(build_agent(schema_managers[VERSION_0_8])),
    VERSION_0_9: build_runner(build_agent(schema_managers[VERSION_0_9])),
}

# Runtime Stream Handling (Select based on negotiation)
version = try_activate_a2ui_extension(context, self.agent_card)

if version:
    # Select the pre-configured agent runner and schema manager
    runner = ui_runners[version]
    schema_manager = schema_managers[version]
else:
    # Fallback to standard text agent runner
    runner = text_runner
    schema_manager = None
```

### 4. Orchestration and Delegation

Orchestrator agents delegate work to sub-agents. They often need to propagate UI
capabilities and handle cross-agent UI state.

**Example Sample:** [orchestrator](../../../samples/agent/adk/orchestrator)

The orchestrator inspects sub-agent capabilities and aggregates their supported
catalog IDs into its own `AgentCard`.

```python
# Aggregating capabilities from sub-agents
supported_catalog_ids = set()
for subagent in subagents:
  # ... fetch subagent_card ...
  for extension in subagent_card.capabilities.extensions:
    if extension.uri == A2UI_EXTENSION_URI:
      supported_catalog_ids.update(
        extension.params.get("supportedCatalogIds") or [])

# Creating the orchestrator's AgentCard
agent_card = AgentCard(
    capabilities=AgentCapabilities(
        extensions=[
            get_a2ui_agent_extension(
                version=VERSION_0_9,  # Specify the version to advertise
                supported_catalog_ids=list(supported_catalog_ids),
            )
        ]
    )
)
```

#### Setting or Propagating Client Capabilities on Remote A2A Agents

When calling remote A2A agents (such as delegating to a sub-agent or proxying to a backend A2A stubby agent) via ADK `RemoteA2aAgent`, you must ensure that the remote agent receives the client's UI capabilities in its request metadata under `a2uiClientCapabilities`.

You can configure an `A2aRemoteAgentConfig` with a `before_request` interceptor (`RequestInterceptor`) to inject this metadata. There are two common scenarios:

##### Scenario 1: Propagating Capabilities from Session State (Orchestrator)

When an orchestrator receives an A2A request from a client, it captures the client capabilities into session state. When calling a sub-agent via `RemoteA2aAgent`, the interceptor propagates those capabilities from `ctx.session.state`:

```python
from a2a.types import Message as A2AMessage
from a2ui.schema.constants import A2UI_CLIENT_CAPABILITIES_KEY
from google.adk.a2a.agent.config import A2aRemoteAgentConfig, ParametersConfig, RequestInterceptor
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent

async def propagate_capabilities_interceptor(
    ctx: InvocationContext,
    message: A2AMessage,
    params: ParametersConfig,
) -> tuple[A2AMessage, ParametersConfig]:
  # Retrieve capabilities saved earlier in session context state
  if ctx.session and ctx.session.state:
    client_capabilities = ctx.session.state.get("client_capabilities")
    if client_capabilities:
      if message.metadata is None:
        message.metadata = {}
      message.metadata[A2UI_CLIENT_CAPABILITIES_KEY] = client_capabilities
  return message, params

remote_agent_config = A2aRemoteAgentConfig(
    request_interceptors=[
        RequestInterceptor(before_request=propagate_capabilities_interceptor)
    ]
)

remote_a2a_agent = RemoteA2aAgent(
    name="subagent_name",
    agent_card=subagent_card,
    config=remote_agent_config,
    # ...
)
```

##### Scenario 2: Explicitly Setting Capabilities for Proxy Agents

When acting as a proxy connecting a non-A2A frontend (such as Orcas UI) to a remote A2A backend stubby agent, the incoming frontend request does not have A2A metadata. The proxy agent configures a `before_request` interceptor to explicitly construct and inject the supported client capabilities on outgoing requests:

```python
from a2a.types import Message as A2AMessage
from a2ui.schema.constants import A2UI_CLIENT_CAPABILITIES_KEY
from google.adk.a2a.agent.config import A2aRemoteAgentConfig, ParametersConfig, RequestInterceptor
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent

async def set_proxy_capabilities_interceptor(
    ctx: InvocationContext,
    message: A2AMessage,
    params: ParametersConfig,
) -> tuple[A2AMessage, ParametersConfig]:
  if message.metadata is None:
    message.metadata = {}

  # Explicitly define what the proxy or UI client supports
  message.metadata[A2UI_CLIENT_CAPABILITIES_KEY] = {
      "supportedCatalogIds": [
          "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
      ],
      "inlineCatalogs": True,
  }
  return message, params

proxy_agent_config = A2aRemoteAgentConfig(
    request_interceptors=[
        RequestInterceptor(before_request=set_proxy_capabilities_interceptor)
    ]
)

remote_stubby_agent = RemoteA2aAgent(
    name="stubby_backend",
    agent_card=agent_card,
    config=proxy_agent_config,
    # ...
)
```

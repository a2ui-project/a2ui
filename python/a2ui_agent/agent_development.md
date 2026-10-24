# A2A Agent Development Guide

This guide explains how to build AI agents that generate A2UI interfaces using
`agent_sdk`. The SDK simplifies schema management, prompt engineering, and
message validation for A2A (Agent-to-Agent/Agent-to-Client) communication.

## Core Concepts

The `agent_sdk` revolves around four main classes:

- **`Catalog`**: Represents a component catalog from `a2ui.core`, providing
  component and function schemas for validation and LLM instruction rendering.
- **`CatalogConfig`**: Wraps a `Catalog` with optional `CatalogTransformer`
  instances into `transformed_catalog`.
- **`A2uiGenerator`**: Holds the agent's supported `CatalogConfig` instances,
  optional few-shot example turns, and format factory, and negotiates an
  `A2uiRequestProcessor` for a client's renderer capabilities.
- **`A2uiRequestProcessor`**: Request-scoped facade that binds the catalogs
  negotiated for one request to an `InferenceFormat` (defaulting to
  `ExpressFormat`). It exposes `prompt_snippet` for the system prompt, and
  `parse_response()` and `open_stream()`, which parse and validate the model's
  response.

The agent creates its generators once. Each request gets its own processor,
negotiated from the capabilities that the client sent with the request, so the
prompt and validation use the catalogs that this client renders.

## Prerequisites

- Install the SDK: `pip install a2ui-agent-sdk`
- To serve A2UI over A2A, also install the A2A extension: `pip install a2ui-a2a`
- To use the ADK toolset and converters, also install the ADK extension: `pip install "a2ui-adk[a2a]"`

## Generating A2UI Messages

### Step 1: Set up the Generator and Request Processor

Load your catalogs into an `A2uiGenerator` when the agent starts. When a
request arrives, negotiate an `A2uiRequestProcessor` for the client's renderer
capabilities.

```python
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, CatalogConfig

# At startup: the catalogs that the agent supports (basic or bring your own)
catalogs = [
    CatalogConfig(BasicCatalog(ProtocolVersion.V0_9)),
    CatalogConfig.from_path("path/to/catalog.json"),
]
# ExpressFormatFactory is used by default; pass DirectJsonFormatFactory for
# multi-catalog v0.9 or incremental streaming
generator = A2uiGenerator(catalogs)

# Per request: the capabilities that the client sent, keyed by protocol version
processor = generator.create_processor({
    "v0.9": {"supportedCatalogIds": [BasicCatalog(ProtocolVersion.V0_9).catalog_id]}
})
```

The client sends its capabilities in the metadata of the A2A message, under
`a2uiClientCapabilities` (`A2UI_CLIENT_CAPABILITIES_KEY` in `a2ui.constants`),
keyed by protocol version as above, so the agent passes them to
`create_processor` unchanged. v0.8 capabilities may also be the entry itself,
`{"supportedCatalogIds": [...]}`, as the v0.8 specification defines them. A web client built on `@a2ui/web_core` can get
them from its renderer with `processor.getRendererCapabilities({versions:
['v0.9']})`. `create_processor` raises an `A2uiError` if the client sent no
capabilities, or if they are malformed or name none of the agent's catalogs.

Notes:

- A processor needs at least one active catalog, and all of its catalogs must
  target compatible protocol versions. `processor.prompt_snippet` describes all
  of them.
- To shape a catalog, such as pruning components or functions, pass
  `transformers` to `CatalogConfig`. `transformed_catalog` applies them in order.
- When `examples` (a sequence of message turns) are passed to `A2uiGenerator`,
  each example turn is validated against `processor.active_catalogs` when a
  processor is created (raising `A2uiValidationError` if invalid) and rendered
  into `processor.prompt_snippet`.
- `A2uiRequestProcessor(catalogs)` can also be created directly from catalogs,
  for example in a script that prints the prompt for a set of catalogs.
- A catalog may reference the protocol's common types and its peer catalogs,
  for example to reuse a component or a property of another catalog with a
  `$ref`. The SDK resolves these references against the other catalogs it
  holds: for `A2uiGenerator`, every registered catalog, including ones the
  renderer doesn't support; for `A2uiRequestProcessor(catalogs)`, the catalogs
  it is given. A reference that matches no catalog can't be resolved, and a
  response that uses it fails validation. See
  [Catalog Linking](../../docs/public/concepts/catalogs.md#catalog-linking).
- You can define one `A2uiGenerator` for each protocol version and select the
  one for the version that the request activates.
  See [Multiple Version Support](#3-multiple-version-support) for more details.

#### Choose an Inference Format

The inference format is the notation the model writes A2UI in. The generator's
format factory decides it, and every processor the generator creates uses it
for both the prompt snippet and the parser.

- **Direct JSON** (`DirectJsonFormatFactory`, the default): the model writes
  A2UI messages as JSON inside `<a2ui-json>` tags. It is the only format that
  streams: `processor.open_stream()` emits an `updateComponents` or
  `updateDataModel` as soon as part of it reads, and again each time it grows,
  and any other message once its object closes (see
  [Option B](#option-b-incremental-streaming-parsing-advanced)).
- **Express** (`ExpressFormatFactory`): the model writes a compact notation
  inside `<a2ui>` tags, which the SDK compiles into A2UI messages. It needs far
  fewer output tokens than JSON, so a whole response arrives sooner. An Express
  block resolves references across its whole body, so it doesn't stream:
  parse the response with `processor.parse_response()`.

```python
from a2ui.inference_formats import DirectJsonFormatFactory, ExpressFormatFactory

# The default, written out.
generator = A2uiGenerator(catalogs, inference_format_factory=DirectJsonFormatFactory())

# Express, for lower latency on whole responses.
generator = A2uiGenerator(catalogs, inference_format_factory=ExpressFormatFactory())
```

`create_processor` also takes an `inference_format_factory` that overrides the
generator's for one request.

### Step 2: Generate System Prompt

Use the request's `processor.prompt_snippet` to produce the A2UI part of the
system prompt, and combine it with your agent's role and workflow
instructions. The snippet describes the format, the catalogs negotiated for
the request (including inline catalogs that the client sent, when the
generator was created with `accepts_inline_catalogs=True`), and the
generator's examples, so build the prompt per request.

```python
instruction = "\n\n".join([
    "You are a helpful assistant...",
    "# Workflow\nAnalyze the request and return UI...",
    processor.prompt_snippet,
])
```

Give few-shot examples to the generator, as message turns, rather than adding
them to the prompt yourself. Creating a processor checks each example against
the request's catalogs, and the snippet writes them in the format's notation,
so the same examples serve Direct JSON and Express.

```python
import json

from a2ui.inference_formats import to_message_models

with open("path/to/examples/contact_card.json", encoding="utf-8") as f:
    contact_card = to_message_models(json.load(f))

generator = A2uiGenerator(catalogs, examples=[contact_card])
```

To save tokens, shape what the snippet describes when you set up the
generator:

```python
from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.inference_formats import DirectJsonFormatFactory
from a2ui.processor import A2uiGenerator, CatalogConfig

generator = A2uiGenerator(
    [
        # Keep only some components of the catalog.
        CatalogConfig(
            BasicCatalog(ProtocolVersion.V0_9),
            transformers=[ComponentPruningTransformer(["Text", "Button", "Column"])],
        )
    ],
    # Keep only some messages of the agent-to-renderer schema.
    inference_format_factory=DirectJsonFormatFactory(
        allowed_messages=["createSurface", "updateComponents"],
    ),
)
```

`ExpressFormatFactory` takes `allowed_messages` too.

### Step 3: Build an LLM Agent with the System Prompt

Configure your `LlmAgent` using the generated system instructions. This agent
serves as the core logic for interpreting user queries and deciding when to
generate rich UI responses.

Since the instruction belongs to the request, build the `LlmAgent` and its
`Runner` per request. Share one session service across the runners, so that a
conversation keeps its history from one request to the next.

```python
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

# At startup
session_service = InMemorySessionService()

# Per request
agent = LlmAgent(
    model=LiteLlm(model=LITELLM_MODEL),
    name="Your agent name",
    description="Your agent description.",
    instruction=instruction,
    tools=[],  # Your tools
)
runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)
```

An agent that uses the ADK `SendA2uiToClientToolset` can instead put the
request's catalog and examples into the session state; see
[Dynamic Schemas](#2-dynamic-schemas-context-aware).

### Step 4: Process Request and Stream UI

The final step is to build an executor (or a custom streaming handler) that
manages the runtime lifecycle of a request: running the LLM, validating the
generated JSON, and streaming parts to the client.

#### 4a. Build an Agent Executor

Build an agent executor that uses the agent to process requests.

```python
from a2a.server.agent_execution import AgentExecutor


class MyAgentExecutor(AgentExecutor):
  def __init__(self, agent: LlmAgent):
    self.agent = agent
    # ...


agent_executor = MyAgentExecutor(agent=agent)
```

#### 4b. A2UI Extension Version Negotiation

Before processing a request, negotiate which version of the A2UI extension to activate based on the client request and your agent's advertised capabilities.

```python
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY

# In your request handler:
version = try_activate_a2ui_extension(context, agent_card)

if version:
    # Negotiate the request's processor with the generator of that version
    capabilities = (context.message.metadata or {}).get(A2UI_CLIENT_CAPABILITIES_KEY)
    processor = generators[version].create_processor(capabilities)
```

#### 4c. Select a Parsing Strategy

Depending on your latency requirements, choose between waiting for the full response or parsing text chunks incrementally.

##### Option A: Full-Response Parsing

Use this approach if you wait for the LLM to finish its entire response before processing and sending UI to the client. It is simpler to implement.

**1. Parse, Validate, and Fix**

`processor.parse_response(full_text)` parses, heals simple JSON formatting errors (e.g., trailing commas), and validates every A2UI block against `processor.active_catalogs` in a single call. It raises an `A2uiError`, such as `A2uiValidationError`, if a renderer holding the catalogs would reject the payload. Validation always runs; there is no option to skip it.

```python
from a2ui.parser import A2uiPart

# Parse and validate the full response into parts
response_parts = processor.parse_response(full_text)

for part in response_parts:
  if isinstance(part, A2uiPart):
    # part.a2ui contains the validated AgentToRendererMessage objects
    ...
```

**2. Convert to A2A Parts**

`to_a2a_parts` from `a2ui.a2a` turns the parts into A2A `Part` objects: a
`TextPart` for text and a `DataPart` with the A2UI MIME type for each message.
Catch the error to retry with a prompt that says what was wrong:

```python
from a2ui.a2a import to_a2a_parts
from a2ui.core import A2uiError

try:
    parts = to_a2a_parts(processor.parse_response(full_text), version=version)
except A2uiError as e:
    # Ask the model again, quoting the error.
    ...
else:
    yield {"is_task_complete": True, "parts": parts}
```

To wrap single messages yourself, use the `create_a2ui_part` helper. It takes a
message dictionary, so convert the models in `A2uiPart.a2ui` with
`to_message_dicts` from `a2ui.inference_formats` first.

##### Option B: Incremental Streaming Parsing (Advanced)

Use this approach for sub-second UI updates. It needs the Direct JSON format, the only one that streams; `open_stream()` raises `NotImplementedError` for Express. The stream parses, heals and checks the JSON _incrementally_ as chunks arrive from the LLM. It emits an `updateComponents` or `updateDataModel` (v0.8's `surfaceUpdate` or `dataModelUpdate`) as soon as part of it reads, by closing the open braces and brackets, and emits it again each time it grows. Any other message, such as `createSurface`, `deleteSurface` or `callRendererFunction`, waits until its object closes, and the messages after it wait with it. Each chunk is read once: the stream goes on from where the previous chunk left off and checks a growing message only for what it gains, so streaming a response takes time in proportion to its length. Open the stream with `processor.open_stream()`, so that it checks each message against `processor.active_catalogs`: each component is checked against the catalog its surface uses or, from v1.0 on, the catalog the component names.

A string still being written is emitted only for the format's progressive keys, whose open strings the stream closes where they stand. The default `DirectJsonFormatFactory()` has none, so a message with an open string waits until the string closes. To show text as it is written, pass `progressive_keys`, for example `DirectJsonFormatFactory(progressive_keys=DEFAULT_PROGRESSIVE_KEYS)` with `DEFAULT_PROGRESSIVE_KEYS` from `a2ui.constants`.

> [!IMPORTANT]
> **Prerequisite**: To use incremental streaming, your agent executor must support streaming mode. In ADK, enable this using `RunConfig`:
>
> ```python
> run_config=run_config.RunConfig(
>     streaming_mode=run_config.StreamingMode.SSE
> )
> ```

```python
from a2ui.a2a import to_a2a_parts
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory

processor = generator.create_processor(
    capabilities,
    inference_format_factory=DirectJsonFormatFactory(),
)
# One stream per response.
stream = processor.open_stream()

# Inside your LLM stream loop:
for chunk in llm_response_stream:
    # Yield text and partial UI updates as soon as they are ready.
    if parts := to_a2a_parts(stream.feed(chunk.text), version=version):
        yield {"is_task_complete": False, "parts": parts}

# After the last chunk, close the stream. It emits the text still held back as a
# possible tag, and raises if a block was left open.
if parts := to_a2a_parts(stream.close(), version=version):
    yield {"is_task_complete": False, "parts": parts}
```

Always call `close()` after the last chunk: without it, trailing text that
could still have started a tag is never emitted, and a block the model left
open goes unreported.

`feed` and `close` raise an `A2uiError` when a message is invalid. The renderer
already has the messages emitted before the error, and they may leave a surface
incomplete: references and the root are checked only when a block closes. Read
the retry with `processor.open_stream(state=stream.state)`, so it is checked
against what the renderer holds.

`stream_response_to_parts` from `a2ui.a2a` runs the same loop, closes the
stream after the last token, and converts the parts to A2A parts:

```python
from a2ui.a2a import stream_response_to_parts
from a2ui.core import A2uiError

stream = processor.open_stream()
try:
    async for part in stream_response_to_parts(stream, token_stream, version=version):
        yield {"is_task_complete": False, "parts": [part]}
except A2uiError as e:
    # Ask the model again, quoting the error, and read the retry with
    # processor.open_stream(state=stream.state).
    ...
```

> [!TIP]
> The Direct JSON stream re-emits a message only when its content changes. Change detection is per message, so a growing `updateComponents` is re-sent with all of its components so far, not only the changed ones.

#### 4d. Chat and Canvas UIs

The processor checks each response against a `RendererState`, the agent's
mirror of the surfaces the renderer holds. How long that state lives is what
separates the two ways an agent shows UI.

In a chat, each turn shows new UI. Pass no state: each call checks the response
against an empty state, so from v0.9 on, a response that updates a surface it
did not create is rejected. (A v0.8 renderer buffers updates to a surface until
its `beginRendering`, so a v0.8 response may send updates before
`beginRendering`, but one that never sends it is rejected too.) An agent that
updates surfaces from earlier turns is a canvas.

```python
parts = processor.parse_response(text)
```

In a canvas, turns update the same surfaces. Keep one state for the whole
conversation and pass it every turn, streamed or not. A turn that refers to a
component no turn sent, or that creates a cycle with components from earlier
turns, is then rejected.

```python
state = processor.create_state()

# Turn 1, parsed whole: applied all or nothing.
parts = processor.parse_response(text, state=state)

# Turn 2, streamed: a new stream that applies what it emits to the same state.
stream = processor.open_stream(state=state)
for chunk in llm_response_stream:
    send(stream.feed(chunk.text))
send(stream.close())
```

A response parsed whole is applied to the state only if all of it is valid. A
streamed response cannot be undone, since the renderer has already received
what was emitted, so after a failure the state keeps the emitted messages. The
next turn is not required to make the components they added reachable, since
no message removes a component, but it must resolve their dangling references
and give the surface its root.

To avoid passing the state on every call, bind it when creating the
processor. Calls that pass no state then use it:

```python
processor = generator.create_processor(capabilities, state=state)
parts = processor.parse_response(text)
stream = processor.open_stream()
```

The state checks every component a turn adds or replaces: it must be reachable
from the root. A component that a turn leaves unreachable, by rewriting its
parent's children, is accepted, since the protocol has no message that removes
one component.

The state holds the surfaces as they now stand, not the messages that built
them, and lives in memory, so keep it with the conversation session, for
example in a dict keyed by session id. A state rejects an update to a surface
it never saw created, as the renderer would. Since the processor is created per
request, the state must hold the request's catalogs in the same order, or the
processor raises `A2uiCatalogError`. The active catalogs follow the order of
the client's `supportedCatalogIds`, so a client that reorders its list needs a
new state too. Check with `processor.accepts_state(state)`, and start a new
state with `processor.create_state()` when it returns False:

```python
state = states.get(session_id)
if state is None or not processor.accepts_state(state):
    state = states[session_id] = processor.create_state()
```

## Use Cases

### 1. Simple Agents with Static Schemas

For agents with a fixed set of catalogs, build the system instruction from the
request's `processor.prompt_snippet`, and the agent around it.

**Example Samples:**
[restaurant_finder](../../samples/agent/adk/restaurant_finder)

```python
# Per request
processor = generator.create_processor(capabilities)
instruction = "\n\n".join([
    "You are a helpful assistant...",
    "# Workflow\nAnalyze the request and return UI...",
    "# UI Description\nUse the following components...",
    processor.prompt_snippet,
])

# Use with your LLM framework (e.g., ADK)
agent = LlmAgent(model=..., name="...", instruction=instruction)
```

### 2. Dynamic Schemas (Context-Aware)

Some agents may need to attach different catalogs or examples depending on the
user's request, client capabilities, or conversational context. This is common
for dashboard-style agents that support multiple distinct visualization types (
e.g., Charts vs. Maps).

**Example Sample:** [rizzcharts](../../samples/community/agent/adk/rizzcharts/python)

#### 2a. Injecting Catalogs into Session State

In a dynamic scenario, the agent's instruction doesn't name a catalog. Instead,
you configure an `A2uiGenerator` once with `CatalogConfig(catalog)` and
`accepts_inline_catalogs=True`, and call `generator.create_processor(capabilities)`
for each request (e.g., during session preparation) to negotiate the active
catalogs and store the selected catalog in the session state.

```python
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.utils import load_examples

# In your AgentExecutor subclass
async def _prepare_session(self, context, run_request, runner):
  session = await super()._prepare_session(context, run_request, runner)

  # 1. Determine client capabilities from metadata, keyed by protocol version,
  #    for example {"v0.9": {"supportedCatalogIds": [...]}}
  capabilities = (context.message.metadata or {}).get(A2UI_CLIENT_CAPABILITIES_KEY)

  # 2. Negotiate a request processor for the client capabilities and load examples
  processor = self.generator.create_processor(capabilities)
  examples = load_examples(
      processor.active_catalogs, "path/to/examples", validate=True
  )

  # 3. Store in session state for tool access
  await runner.session_service.append_event(
      session,
      Event(
          actions=EventActions(
              state_delta={
                  "system:a2ui_enabled": True,
                  "system:a2ui_catalogs": processor.active_catalogs,
                  "system:a2ui_examples": examples,
              }
          ),
      ),
  )
  return session
```

#### 2b. Accessing Catalogs via Providers

The `SendA2uiToClientToolset` can use **Providers**—callables that retrieve the
active catalogs and examples from the current context state at runtime.

```python
# Providers that read from context state
def get_a2ui_catalogs(ctx: ReadonlyContext):
  return ctx.state.get("system:a2ui_catalogs") or []


def get_a2ui_examples(ctx: ReadonlyContext):
  return ctx.state.get("system:a2ui_examples")


# Initialize the toolset with providers
ui_toolset = SendA2uiToClientToolset(
    a2ui_enabled=True,
    a2ui_catalogs=get_a2ui_catalogs,
    a2ui_examples=get_a2ui_examples,
)
```

#### 2c. Runtime Validation

When the LLM calls the UI tool, the toolset uses the dynamic catalogs to:

1. **Generate Instructions**: Inject the specific schema and examples into the
   LLM's system prompt for that turn.
2. **Parse and Fix Payloads**: Parse and fix the LLM's generated JSON using the
   parser and payload-fixer.
3. **Validate Payloads**: Validate the LLM's generated JSON against the specific
   active `Catalog` objects with `a2ui.utils.validate_payload`.

### 3. Multiple Version Support

To support multiple protocol versions (e.g., v0.8 and v0.9), create one
`A2uiGenerator` for each version when the agent starts, and list each in the
agent card. At runtime, use `try_activate_a2ui_extension` to negotiate the
version, and create the request's processor with that version's generator.

```python
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory

# During initialization: one generator per supported version
generators = {
    ProtocolVersion.V0_8: A2uiGenerator(
        [CatalogConfig(BasicCatalog(ProtocolVersion.V0_8))],
        inference_format_factory=DirectJsonFormatFactory(),
    ),
    ProtocolVersion.V0_9: A2uiGenerator(
        [CatalogConfig(BasicCatalog(ProtocolVersion.V0_9))],
        inference_format_factory=DirectJsonFormatFactory(),
    ),
}
extensions = [
    get_a2ui_agent_extension(
        version,
        supported_catalog_ids=[
            c.transformed_catalog.catalog_id for c in generator.catalogs
        ],
    )
    for version, generator in generators.items()
]

# Per request: select the generator for the negotiated version
version = try_activate_a2ui_extension(context, self.agent_card)

if version:
    capabilities = (context.message.metadata or {}).get(A2UI_CLIENT_CAPABILITIES_KEY)
    processor = generators[version].create_processor(capabilities)
    runner = build_runner(build_instruction(processor))
else:
    # Fall back to the text agent
    processor = None
    runner = text_runner
```

### 4. Orchestration and Delegation

Orchestrator agents delegate work to sub-agents. They often need to propagate UI
capabilities and handle cross-agent UI state.

**Example Sample:** [orchestrator](../../samples/community/agent/adk/orchestrator)

The orchestrator inspects sub-agent capabilities and aggregates their supported
catalog IDs into its own `AgentCard`.

```python
# Aggregating capabilities from sub-agents
supported_catalog_ids = set()
for subagent in subagents:
  # ... fetch subagent_card ...
  for extension in subagent_card.capabilities.extensions:
    if extension.uri == get_a2ui_extension_uri(ProtocolVersion.V0_9):
      supported_catalog_ids.update(
        extension.params.get("supportedCatalogIds") or [])

# Creating the orchestrator's AgentCard
agent_card = AgentCard(
    capabilities=AgentCapabilities(
        extensions=[
            get_a2ui_agent_extension(
                version=ProtocolVersion.V0_9,  # Specify the version to advertise
                supported_catalog_ids=list(supported_catalog_ids),
            )
        ]
    )
)
```

#### Setting or Propagating Client Capabilities on Remote A2A Agents

When calling remote A2A agents (such as delegating to a sub-agent or proxying to a backend A2A stubby agent) via ADK `RemoteA2aAgent`, you must ensure that the remote agent receives the client's UI capabilities in the `metadata` field of the A2A `Message` under the key `a2uiClientCapabilities`.

You can configure an `A2aRemoteAgentConfig` with a `before_request` interceptor (`RequestInterceptor`) to inject this metadata. There are two common scenarios:

##### Scenario 1: Propagating Capabilities from Session State (Orchestrator)

When an orchestrator receives an A2A request from a client, it captures the client capabilities into session state. When calling a sub-agent via `RemoteA2aAgent`, the interceptor propagates those capabilities from `ctx.session.state`:

```python
from a2a.types import Message as A2AMessage
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
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
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
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
      "v0.9": {
          "supportedCatalogIds": [
              "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
          ],
      },
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

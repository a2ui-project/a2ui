# A2UI ADK extension

`a2ui-adk` connects the [A2UI agent SDK](../a2ui_agent/README.md) to the
[Agent Development Kit (ADK)](https://github.com/google/adk-python). It
provides the `a2ui.adk` package.

## Installation

```bash
# ADK tools only
pip install a2ui-adk

# With the ADK-to-A2A converters and A2A subagent orchestration
pip install "a2ui-adk[a2a]"
```

The `a2a` extra installs [`a2ui-a2a`](../a2ui_a2a/README.md) and
`google-adk[a2a]`.

## Contents

Available with the base install:

- `SendA2uiToClientToolset` is an ADK toolset that lets an agent send A2UI
  to the client through a tool call. It takes whether A2UI is enabled and the
  request's `A2uiRequestProcessor`, or callbacks (`A2uiEnabledProvider`,
  `A2uiProcessorProvider`) that return them per context. The processor holds
  everything else: the catalogs, the example turns, the inference format, and
  the `RendererState` bound to it for Canvas UIs. The toolset adds the
  processor's prompt to the model's instructions, compiles each tool call with
  the processor's parser, and validates the resulting A2UI JSON messages
  before they are sent.
- `A2uiInstruction` is an ADK instruction provider for an agent that writes
  A2UI in its text response. Pass it as `LlmAgent.instruction` with the
  agent's own instruction and the same processor or callbacks as the toolset.
  It appends the processor's prompt to the agent's instruction. ADK reads
  `{name}` session state templates out of a string instruction, and the A2UI
  prompt holds braces that are not state keys (`${expression}` in the basic
  catalog, data bindings in the examples), so a string instruction fails with
  `KeyError: "Context variable not found: 'expression'."`. As a provider,
  `A2uiInstruction` is used as it is, while the agent's own instruction keeps
  its `{name}` templates.
- `A2uiProcessorStore` keeps each session's `A2uiRequestProcessor` in memory,
  since ADK's session services save state as JSON and can't hold one. Its
  `is_enabled` and `get` methods are the callbacks for the toolset,
  `A2uiInstruction` and `A2uiEventConverter`.
- `A2uiRendererCallsStore` keeps each session's `RendererFunctionCalls` (from
  `a2ui.rpc`), which holds the agent's pending `callRendererFunction` calls.
  Its `get` method returns the session's instance, creating it on first use,
  and `remove` disposes it when the session ends.

Available with the `a2a` extra:

- `A2uiPartConverter` and `A2uiEventConverter` (also in `a2ui.adk.a2a`)
  convert ADK events and GenAI parts into A2A parts with A2UI data, using the
  request's `A2uiRequestProcessor`. `A2uiEventConverter` gets the processor
  from its `a2ui_processor` argument, such as `A2uiProcessorStore.get`. Pass
  it to ADK's `A2aAgentExecutor`.
- `a2ui_rpc_callback` (also in `a2ui.adk.a2a`) returns a
  `before_agent_callback` that answers A2UI v1.0 RPC messages without running
  the agent. When the request holds only `callAgentFunction` and
  `rendererFunctionResponse` messages, it runs the agent functions of an
  `AgentFunctionRegistry` and settles the session's renderer function calls,
  and returns the `agentFunctionResponse` replies as the agent's response. For
  any other request it returns None, so the agent runs. With
  `A2aAgentExecutor`, the replies reach the client as A2UI parts.
- `A2uiSubagentMap` and `SurfaceIdAlreadyExistsError` (also in
  `a2ui.adk.orchestration`) track which subagent owns each surface in an
  orchestrator that talks to its subagents over A2A.

Without the extra, `import a2ui.adk` still works. Reading one of these names
raises an `ImportError` that explains how to install the extra.

```python
from a2ui.adk import A2uiEventConverter, A2uiInstruction, SendA2uiToClientToolset
```

To answer the renderer's RPC messages, pass the callback to the agent. To
keep a callback of your own, pass a list; ADK runs them in order until one
returns content:

```python
from a2ui.adk import A2uiRendererCallsStore, a2ui_rpc_callback
from a2ui.rpc import AgentFunctionRegistry

renderer_calls = A2uiRendererCallsStore()
agent = LlmAgent(
    ...,
    before_agent_callback=[
        a2ui_rpc_callback(
            agent_functions=AgentFunctionRegistry(catalogs),
            renderer_calls=renderer_calls.get,
        ),
        my_before_agent_callback,
    ],
)
```

The RPC messages and their replies are stored in the session's events like any
other turn.

## Running tests

From the repository root:

```bash
uv run pytest python/a2ui_adk/tests
```

The conformance cases are in
[`conformance/extensions/adk`](../../conformance/extensions/adk).

## Building

From the `python/a2ui_adk` directory:

```bash
uv build
```

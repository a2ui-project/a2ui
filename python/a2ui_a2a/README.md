# A2UI A2A extension

`a2ui-a2a` connects the [A2UI agent SDK](../a2ui_agent/README.md) to the
[Agent-to-Agent (A2A) protocol](https://a2a-protocol.org). It provides the
`a2ui.a2a` package.

## Installation

```bash
pip install a2ui-a2a
```

This installs `a2ui-agent-sdk` and `a2a-sdk` as dependencies.

## Contents

`a2ui.a2a` contains:

- Extension helpers: `get_a2ui_agent_extension` builds the `AgentExtension`
  that an agent advertises in its `AgentCard`, and
  `try_activate_a2ui_extension` activates the A2UI extension for a request
  when the client asks for it. `get_a2ui_extension_uri` and
  `A2UI_EXTENSION_BASE_URI` give the extension URI for a protocol version.
- Part helpers: `create_a2ui_part`, `is_a2ui_part` and `get_a2ui_datapart`
  wrap and unwrap A2UI messages in A2A `DataPart`s. `_compat.py` adapts those
  helpers to a2a-sdk 0.3 (`Part.root`) and 1.x (protobuf `Part`). Prefer
  `create_a2ui_part`, `is_a2ui_part`, `get_a2ui_data`, `extract_user_action`,
  and `try_activate_a2ui_extension` over `Part.root` or
  `RequestContext.add_activated_extension`. `to_a2a_parts` converts
  the parts that `A2uiRequestProcessor.parse_response()` returns, and
  `stream_response_to_parts` reads a streamed response through a
  `ResponseStream`, such as one from `A2uiRequestProcessor.open_stream()`.
  Both leave validation errors to the caller. `parse_content_to_parts`
  parses a whole response with a `Parser`, such as
  `A2uiRequestProcessor.parser`, and logs and drops one that fails. A canvas
  agent passes it the `RendererState` it keeps with `state=`.
  `extract_a2ui_json_to_parts` extracts text and `<a2ui-json>` blocks into
  A2A parts without requiring a `Parser` or `Catalog`.
- RPC helpers (v1.0): `get_a2ui_messages` returns the A2UI messages in an
  incoming A2A message's A2UI parts, such as a renderer's `callAgentFunction`
  or `action`, and `create_a2ui_parts` wraps the replies of
  `RendererToAgentMessageProcessor` (from `a2ui.rpc`) as A2UI parts.

```python
from a2ui.a2a import create_a2ui_part, get_a2ui_agent_extension

extension = get_a2ui_agent_extension(version="0.9")
part = create_a2ui_part({"version": "v0.9", "deleteSurface": {"surfaceId": "main"}})
```

In an `AgentExecutor`, answer the renderer's agent function calls before
running the agent's turn:

```python
from a2ui.a2a import create_a2ui_parts, get_a2ui_messages
from a2ui.rpc import RendererToAgentMessageProcessor

processor = RendererToAgentMessageProcessor(request_processor.active_catalogs)

messages = get_a2ui_messages(context.message)
results = [await processor.process_message(message) for message in messages]
parts = create_a2ui_parts(reply for result in results for reply in result.replies)
...  # send `parts` to the client
if len(messages) < len(context.message.parts) or not all(
    result.handled for result in results
):
    ...  # run the agent's turn for the rest, such as text or an `action`
```

The specification of the extension is in
[`a2ui_extension_specification.md`](../../specification/v0_9_1/docs/a2ui_extension_specification.md).

## Running tests

From the repository root:

```bash
uv run pytest python/a2ui_a2a/tests
```

The conformance cases are in
[`conformance/extensions/a2a`](../../conformance/extensions/a2a).

## Building

From the `python/a2ui_a2a` directory:

```bash
uv build
```

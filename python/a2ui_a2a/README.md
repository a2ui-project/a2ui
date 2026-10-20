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
  wrap and unwrap A2UI messages in A2A `DataPart`s. `parse_response_to_parts`,
  `parse_stream_chunk_to_parts`, `stream_response_to_parts` and
  `parse_content_to_parts` turn model output into A2A parts.

```python
from a2ui.a2a import create_a2ui_part, get_a2ui_agent_extension

extension = get_a2ui_agent_extension(version="0.9")
part = create_a2ui_part({"version": "v0.9", "deleteSurface": {"surfaceId": "main"}})
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

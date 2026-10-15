## Unreleased

- First release. `a2ui.adk` moves here from `a2ui-agent-sdk`, so the agent SDK
  no longer depends on `google-adk` or `google-genai`. Import paths are
  unchanged.
- `A2uiPartConverter` takes its `version` as a `ProtocolVersion`, or a version
  string with or without a leading "v". It defaults to `ProtocolVersion.V0_8`.
- The ADK-to-A2A converters (`A2uiPartConverter`, `A2uiEventConverter`) and the
  A2A orchestration helpers (`A2uiSubagentMap`, `SurfaceIdAlreadyExistsError`)
  need the `a2a` extra: `pip install "a2ui-adk[a2a]"`. `a2ui.adk` imports them
  lazily, so `SendA2uiToClientToolset` works without the extra.
- Add `GenAIFileResolver`, a `FileResolver` that returns
  `google.genai.types.Part` objects. It takes over `to_genai_part`,
  `resolve_all_to_genai_parts` and the `genai_parts` default of
  `as_tool_decorator` from `FileResolver`.

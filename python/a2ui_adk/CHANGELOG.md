## Unreleased

- **BREAKING CHANGE**: `SendA2uiToClientToolset` reads the tool call in an
  inference format, Express by default, instead of always reading JSON. Its new
  `inference_format_factory` argument picks the format; pass
  `DirectJsonFormatFactory()` to keep reading Direct JSON. The tool's argument
  is renamed from `a2ui_json` to `a2ui_payload`, and the prompt the toolset
  adds comes from the format's prompt generator. The tool compiles the payload
  with the format's parser, no longer with `parse_and_fix`, validates it, and
  still returns A2UI JSON messages for the part converter.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- **BREAKING CHANGE**: `A2uiPartConverter` checks text-based A2UI as a response
  that shows new UI, so a response that updates a surface it does not create is
  rejected and logged instead of converted. Tool-based A2UI from
  `SendA2uiToClientToolset` without a renderer state is still checked with
  `validate_payload`, which assumes such a surface exists.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- `SendA2uiToClientToolset` accepts example turns (such as
  `processor.examples`), which the format's prompt generator writes in the
  format's syntax, a markdown string, or `None`. It skips each prompt section
  (rules, catalogs, examples) that the agent's system instruction already
  holds, such as when the instruction includes `processor.prompt_snippet`. An
  optional `a2ui_state` (`RendererState` or `A2uiStateProvider`) checks and
  applies tool payloads against a Canvas state. `get_part_converter` reads
  text-based A2UI with the toolset's format.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- `A2uiPartConverter` accepts an optional `processor` (`A2uiRequestProcessor`)
  and `state` (`RendererState`), and infers `version` from the active catalogs'
  `protocol_version` when `version` is omitted.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- `A2uiEventConverter` reads `system:a2ui_processor`, `system:a2ui_state`, and
  `system:a2ui_stream` from session state in addition to `system:a2ui_catalogs`,
  reuses `A2uiPartConverter` across events, and supports incremental streaming
  via `ResponseStream` on partial ADK events.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)

## 0.1.0 (2026-10-17)

- First release. `a2ui.adk` moves here from `a2ui-agent-sdk`, so the agent SDK
  no longer depends on `google-adk` or `google-genai`. Import paths are
  unchanged.
- `A2uiPartConverter` takes its `version` as a `ProtocolVersion`, or a version
  string with or without a leading "v". It defaults to `ProtocolVersion.V0_8`.
- The ADK-to-A2A converters (`A2uiPartConverter`, `A2uiEventConverter`) and the
  A2A orchestration helpers (`A2uiSubagentMap`, `SurfaceIdAlreadyExistsError`)
  need the `a2a` extra: `pip install "a2ui-adk[a2a]"`. `a2ui.adk` imports them
  lazily, so `SendA2uiToClientToolset` works without the extra.
- `SendA2uiToClientToolset` supports multiple catalogs. Its `a2ui_catalog`
  argument is now `a2ui_catalogs`, which takes a sequence of catalogs or an
  `A2uiCatalogsProvider` (replacing `A2uiCatalogProvider`) that returns one.
  The tool describes every catalog in its prompt and validates payloads
  against all of them, and `get_part_converter` passes all of them on.
- `A2uiEventConverter` reads catalogs from the `system:a2ui_catalogs`
  session-state key by default, instead of `system:a2ui_catalog`. Its
  `catalog_key` argument is renamed to `catalogs_key`.
- Add `GenAIFileResolver`, a `FileResolver` that returns
  `google.genai.types.Part` objects. It takes over `to_genai_part`,
  `resolve_all_to_genai_parts` and the `genai_parts` default of
  `as_tool_decorator` from `FileResolver`.

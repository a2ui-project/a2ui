## Unreleased

- **BREAKING CHANGE**: `SendA2uiToClientToolset(a2ui_enabled, a2ui_processor)`
  takes the request's `A2uiRequestProcessor`, or an `A2uiProcessorProvider`
  that returns it per context, instead of catalogs and examples. The processor
  holds the catalogs, the example turns, the inference format and, for a canvas
  agent, the bound `RendererState`. `A2uiCatalogsProvider` and
  `A2uiExamplesProvider` are removed; markdown examples are no longer accepted,
  so pass example turns to `A2uiGenerator` or `A2uiRequestProcessor`. To
  migrate, store `generator.create_processor(capabilities)` under
  `system:a2ui_processor` and pass
  `a2ui_processor=lambda ctx: ctx.state["system:a2ui_processor"]`.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- **BREAKING CHANGE**: The tool reads its argument, renamed from `a2ui_json` to
  `a2ui_payload`, in the processor's inference format (Express by default)
  instead of always reading JSON. It compiles the payload with the format's
  parser, no longer with `parse_and_fix`, validates it against the processor's
  bound state or, without one, with `validate_payload`, and still returns A2UI
  JSON messages for the part converter. The prompt it adds comes from the
  format's prompt generator, and it skips each section (rules, catalogs,
  examples) that the agent's system instruction already holds, such as when the
  instruction includes `processor.prompt_snippet`.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- **BREAKING CHANGE**: `A2uiPartConverter(processor, *, bypass_tool_check=False,
fallback_text=None)` takes the processor instead of `catalogs`, `parser`,
  `version` and `state`. It reads text-based A2UI with the processor's parser
  and checks it against the processor's bound state, as a response that shows
  new UI when there is none, so a response that updates a surface it does not
  create is then rejected and logged. Each part is labeled with its message's
  protocol version.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- **BREAKING CHANGE**: `A2uiEventConverter(bypass_tool_check=False,
fallback_text=None, *, processor_key="system:a2ui_processor")` reads the
  request's processor from session state. Its `catalogs_key` argument and the
  `system:a2ui_catalogs` key are removed. When the processor's format can
  stream, it opens one `ResponseStream` per response, feeds it each partial ADK
  event, and closes it on the final event.
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

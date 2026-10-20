## Unreleased

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

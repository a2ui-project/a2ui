## Unreleased

- `create_a2ui_part` labels a part with the message's own `version` field when
  no `version` is passed, so a v0.9.1 or v1.0 message gets the current A2UI MIME
  type. [#3299](https://github.com/a2ui-project/a2ui/pull/3299)
- `parse_content_to_parts` logs a parse error, which may quote the response,
  by type at warning level and in full only at debug level.
  [#3299](https://github.com/a2ui-project/a2ui/pull/3299)

## 0.1.0 (2026-10-17)

- First release. `a2ui.a2a` moves here from `a2ui-agent-sdk`, so the agent SDK
  no longer depends on `a2a-sdk`. Import paths are unchanged.
- **BREAKING**: `try_activate_a2ui_extension` returns the `ProtocolVersion` of
  the activated extension instead of its version string, so
  `ProtocolVersion.V0_9` instead of `"0.9"`. It only activates extensions whose
  version is a `ProtocolVersion`.
- `get_a2ui_extension_uri`, `get_a2ui_agent_extension` and `create_a2ui_part`
  take a `ProtocolVersion`, or a version string with or without a leading "v".
  Previously a `ProtocolVersion` or a "v"-prefixed string produced an invalid
  URI such as `.../a2ui/vv0.9`.
- **BREAKING**: `stream_response_to_parts(stream, token_stream, version=None)`
  takes the `ResponseStream` that reads the response, such as one from
  `A2uiRequestProcessor.open_stream()`, instead of a `Parser`. It closes the
  stream after the last token, so text held back as a possible tag is emitted
  and a block left open raises. A canvas agent opens the stream with the
  `RendererState` it keeps.
- **BREAKING**: `parse_stream_chunk_to_parts` is removed. Feed chunks to a
  `ResponseStream` instead.
- **BREAKING**: The deprecated `parse_response_to_parts` is removed. Parse the
  response with `A2uiRequestProcessor.parse_response()` and convert the result
  with `to_a2a_parts`, or use `parse_content_to_parts` with a `Parser`.
- `to_a2a_parts(response_parts, version=None)` converts parsed response parts
  into A2A parts: a `TextPart` for each text part and a `DataPart` for each
  A2UI message.
- `parse_content_to_parts` takes a keyword-only `state`, the `RendererState` a
  canvas agent keeps, so a response that updates a surface from an earlier
  turn is checked against it instead of dropped.

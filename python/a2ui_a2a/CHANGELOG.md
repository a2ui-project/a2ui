## Unreleased

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

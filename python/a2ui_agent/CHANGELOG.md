## Unreleased

- Introduce typesafe fluent builder package for A2UI Protocol v1.0 (`a2ui.builder.v1_0`),
  re-exporting v1.0 common types (`DataBinding`, `FunctionCall`,
  `AccessibilityAttributes`, `ActionEvent`, and `CheckRule`) from
  `a2ui.core.schema.v1_0`, defining builder models (`ComponentBuilderNode` with
  `catalog_id`, `accessibility`, and `extensions`, `Action`, and
  `DynamicChildList`), and generating the v1.0 basic catalog components (`Button`
  with child slot, `TextField` with `placeholder`, `Slider` with `steps`, and
  `Video` with `posterUrl`)
  ([#3070](https://github.com/a2ui-project/a2ui/pull/3070)).
- **BREAKING**: `Skill` and `SkillSet` raise `A2uiValidationError` (a `ValueError`) for a `filename` that is absolute or has an empty, `.` or `..` segment, which they used to accept; the check runs on construction, on assignment, and in `SkillSet.add`. `SkillSet.export_to_directory` now removes only the directory that holds each skill file (for example `src/skills/nested` for `src/skills/nested/SKILL.md`) instead of the first path segment (`src`), removes a symlink or file at that path instead of following it, and raises before touching anything when a skill directory's parent is a symlink out of the output directory.
- The Express compiler keeps a map literal as written, quoted keys or not, when
  one of its keys shares a name with an Express construct (`variable`, `path`,
  `call`, `check`, `skipped`); before, such a map was read as a variable
  reference, data binding, function call or check, and lost its data
  ([#3410](https://github.com/a2ui-project/a2ui/issues/3410)). In v1.0 and
  later, only `@path` marks a data binding when the compiler checks a property
  that does not admit one, so a plain `path` key is data. A `_` anywhere but in
  place of an argument now raises `ExpressValidationError`.
- The Express compiler finds a data binding inside a map literal given to a
  property that does not admit one even when the map has keys named `event`,
  `functionCall` or `@call`, and raises `ExpressForbiddenDatabindingError`.
- A map literal with a `catalogId` key among the arguments of an Express check
  holds the check's options: any other key in it, or two such maps naming
  different catalogs, raises `ExpressValidationError`. Before, only a map with
  a single `catalogId` string was read as options, and any other was passed to
  the check as an argument. A null `catalogId` in such a map raises
  `ExpressValidationError` rather than being ignored.
- Only a `$path` given to an Express component's `value`, directly or through
  variables, is passed to the component's checks. A map literal shaped like a
  data binding is data and is not.
- An Express variable whose value refers back to it, directly or through other
  variables, raises `ExpressValidationError` rather than `RecursionError`.
- The Express decompiler reads only the binding and function call keys of the
  catalogs' version, so in v1.0 an object with a plain `path` or `call` key is
  written as a map literal rather than as a data binding or function call. An
  object with the binding key beside other keys, or an `event` or
  `functionCall` key whose value is not an object, is also data.
- Add `A2UI_RENDERER_CAPABILITIES_KEY` (`"a2uiRendererCapabilities"`) to
  `a2ui.constants`, the message metadata key under which the v1.0 A2A
  extension sends the renderer capabilities. v0.8 and v0.9 use
  `A2UI_CLIENT_CAPABILITIES_KEY`.
- Package dependency updated to require `a2ui-core>=0.4.1,<0.5.0`.
- The response parsers for Direct JSON, Express, Elemental and Atom remove the
  backticks left at the edges of a block when a model writes the tags as inline
  code (`` `<a2ui>` ... `</a2ui>` `` or `` `<a2ui-json>` ... `</a2ui-json>` ``),
  drop text made of nothing but backticks, and in one-shot unwrapping (`unwrap`
  and `parse_response`) recover at most one block closed with a closing tag when
  the model opened the block with a Markdown code fence (such as ` ```a2ui `) or
  omitted the opening tag; `has_format_content` counts recovered blocks as
  complete format blocks.
- The Direct JSON and Express compilers strip stray unescaped line breaks inside
  JSON object keys and identifier/reference properties (`id`, `component`,
  `child`, `children` items, `surfaceId`, `catalogId`, and `componentId`,
  leaving user data under `updateDataModel` values and `createSurface.dataModel` untouched), at the edges of
  single-line Express strings, and inside Express data paths and line-wrapped
  identifiers (outside strings and comments, when the joined name resolves to
  a declared variable), accept SQL/Lua-style `--` comments in Express, and map
  a trailing numeric positional argument across optional enum properties when a
  component schema declares a single later numeric property.
- **BREAKING**: `A2uiGenerator` and `A2uiRequestProcessor` now default to
  `ExpressFormatFactory` (`ExpressFormat`) instead of `DirectJsonFormatFactory`
  (`DirectJsonFormat`).
- Express variable and check identifiers now follow Unicode UAX 31 in the
  grammar and decompiler ([#3390](https://github.com/a2ui-project/a2ui/issues/3390)).
  From protocol v1.0 onward, `ExpressDecompiler` rejects component IDs that are
  not valid UAX 31 identifiers with `A2uiValidationError` (`invalid_identifier`);
  for pre-v1.0 catalogs (and for reserved-word IDs in any version), it derives
  a valid variable name and emits `id="..."`.
- Express number literals follow the JSON number grammar plus an optional
  leading `+` (`.5`, `1.`, `+3`, `1e2`, `2.5E-7`), the same grammar the core
  `${...}` expression parsers use
  ([#3019](https://github.com/a2ui-project/a2ui/issues/3019)). Integer text
  compiles to an exact `int`; a literal outside the double range (`1e999`)
  raises `ExpressParseError`. `ExpressDecompiler` writes doubles the way
  ECMAScript `Number.prototype.toString` does (`1e-7`, `0.000015`, `1e+21`,
  with `.0` kept on integral doubles) so the same text comes out of every SDK,
  and raises `ExpressValidationError` for infinite or NaN values instead of
  writing `inf`/`nan`.
- Add `RendererState` to `a2ui.utils`, the agent's mirror of the surfaces a
  renderer holds (#3268). It wraps a `MessageProcessor` and checks each
  outbound message against the state applied before it: `apply` and nested
  `transaction` blocks roll back through an undo log on failure, and
  `check_topology` checks the trees of the touched surfaces. It needs
  `SurfaceComponentsModel.insert_component` from the next `a2ui-core`
  release, so that release must also raise the `a2ui-core` floor in
  `pyproject.toml` to its version.
- `validate_payload` runs the payload through a short-lived `RendererState`
  instead of building a new `MessageProcessor` for each surface and
  candidate catalog. Its results are unchanged, except that a v0.8 update
  that follows a `deleteSurface` of its surface is now buffered, as a v0.8
  renderer does, instead of rejected. A payload may now be any iterable of
  messages, such as a generator.
- The `a2ui.utils.validation` module is removed. `validate_payload` moved to
  `a2ui.utils.renderer_state` and is still exported from `a2ui.utils`.
- `Parser.parse_response` and `Parser.open_stream` take an optional
  `RendererState`. Without one, a call checks the response against an empty
  state, as a chat turn that shows new UI: **BREAKING**, an update to a
  surface the response does not create is now rejected, by
  `A2uiRequestProcessor.parse_response` too. `validate_payload`, which checks
  one payload with no record of earlier ones, still assumes such a surface
  exists.
- `parse_response` applies a response to the state all or nothing, and checks
  the trees of the surfaces it touches once every block is applied, so a
  component may name a child that a later block of the response adds. When
  that check fails, the error's `partial_results` holds only the text, since
  the check spans every block.
- Add `RendererState.mark_checked(surface_ids)`, which stops holding the
  components each surface changed against later `check_topology` calls. A
  stream that fails after emitting messages, and a block cut off at the end
  of a response, mark their surfaces checked: the renderer holds those
  components and no message removes one, so later turns aren't required to
  make them reachable.
- Add `Parser.open_stream`, which returns a `ResponseStream` for one
  response, with `feed` and `close`. Messages the stream emits are applied to
  its state as they are emitted, and the stream checks each message against
  the state instead of building a new `MessageProcessor` for every message on
  every chunk. Only `updateComponents` and `updateDataModel` (v0.8's
  `surfaceUpdate` and `dataModelUpdate`) are emitted while they grow; any
  other message, such as `createSurface`, `deleteSurface` or
  `callRendererFunction`, is held until its object closes. `close` emits text
  still held back as a possible tag, raises `A2uiParseError` if a block is
  still open, and checks the tree of an unwrapped stream. `ResponseStream` is
  exported from `a2ui.parser` and `DirectJsonResponseStream` from
  `a2ui.inference_formats.direct_json`.
- `DirectJsonResponseStream` reads each chunk once. The scan for the close tag
  and the read of the open block go on from where the previous chunk left
  them, a message that has closed is not read or checked again, and a message
  that grows is checked for what it gains: an `updateComponents` applies only
  the components it added, and an `updateDataModel` is applied again once it
  closes. Streaming a response of n components or n messages in small chunks
  now takes time in proportion to n rather than its square.
- **BREAKING**: `DirectJsonParser.compile` returns `AgentToRendererMessage`
  models, as the other formats' `compile` does, rather than the decoded JSON
  mappings. A message that matches no protocol version's message schema
  raises `A2uiValidationError` there. Use `to_message_dicts` for the wire
  form.
- `A2uiRequestProcessor.parse_response` and the new
  `A2uiRequestProcessor.open_stream` take an optional `state`.
  `A2uiRequestProcessor.create_state` creates an empty one, and
  `A2uiRequestProcessor(state=...)` and
  `A2uiGenerator.create_processor(..., state=...)` bind one so that calls
  need not pass it. A state that holds other catalogs than the processor is
  rejected with `A2uiCatalogError`. `A2uiRequestProcessor.accepts_state`
  tells whether a state holds the processor's catalogs, so an agent that
  keeps a state per conversation can tell when to make a new one.
- **BREAKING**: A parser holds no state, and the APIs that assumed one parser
  per response are removed. To migrate:
  - `Parser.parse_chunk(chunk, wrapped)`: open a stream with
    `parser.open_stream(wrapped=...)` and call `feed(chunk)`, then `close()`.
  - `A2uiRequestProcessor.create_parser()`: use the `processor.parser`
    property, which returns the one parser the processor reuses, or
    `processor.parse_response` and `processor.open_stream`.
  - The `parser` property of `DirectJsonFormat`, `ExpressFormat`,
    `ElementalFormat` and `AtomFormat`: use `create_parser()`.
  - `validate_payload(..., surface_catalog_ids=...)`: check the payload
    against a `RendererState` that saw the surfaces created.
- **BREAKING**: `Parser.compile` only translates a block into messages: it
  reports what the notation gets wrong, but does not check the messages
  against the catalogs or a renderer state. `parse_response` and
  `open_stream` compile and check, and `parse_response(block, wrapped=False)`
  compiles and checks one block, which is what `compile` did before. A
  `Parser` subclass also implements the `catalogs` property.
  `_compile_raw_part` is removed.
- **BREAKING**: Express, Elemental and Atom output is checked against the
  catalogs and the surface trees like Direct JSON output. This rejects inline
  child ids that collide with assigned variables, check lists on components
  that declare none, and a function call given to a property with a static
  type. Elemental output whose top-level element has no `id="root"` is
  rejected, as its prompt requires.

## 0.9.0 (2026-10-17)

- **BREAKING**: Package dependency updated to require `a2ui-core>=0.4.0,<0.5.0`.
- `resolve_catalogs`, `validate_payload`, and the Direct JSON and Express
  formats resolve cross-catalog `$ref`s between the catalogs they are given.
  `resolve_catalogs` also resolves references into registered catalogs that
  the renderer doesn't support and into the unpruned catalogs that
  transformers start from. It links per-request copies, so the registered
  catalogs are never modified, and an inline catalog is only linked when the
  agent accepts it.
- **BREAKING**: Remove the `a2ui.schema` package.
  - The constants move to `a2ui.constants`. For example,
    `from a2ui.schema import A2UI_OPEN_TAG` becomes
    `from a2ui.constants import A2UI_OPEN_TAG`.
  - `load_examples`, `resolve_examples_path`, `load_agent_to_renderer_schema`
    and `load_common_types_schema` move to `a2ui.utils`.
  - `find_repo_root`, `get_spec_dir`, `get_basic_catalog_path`,
    `get_basic_examples_dir`, `wrap_as_json_array` and `deep_update` are
    removed. The path helpers only worked in a repository checkout.
  - The `VERSION_0_8`, `VERSION_0_9`, `VERSION_0_9_1` and `VERSION_1_0`
    constants are removed. Use the `ProtocolVersion` members from
    `a2ui.core.schema` instead, such as `ProtocolVersion.V0_9`. Their values
    carry a leading "v" (`"v0.9"`); `a2ui.utils.to_version_number` returns the
    bare form (`"0.9"`) for paths and URIs.
  - The `SPECIFICATION_DIR` constant is removed.
- `resolve_catalogs` and `A2uiGenerator.create_processor` read v0.8
  capabilities in the shape the v0.8 specification defines, the entry itself
  (`{"supportedCatalogIds": [...]}`), as well as keyed by `"v0.8"`. From v0.9
  the capabilities must be keyed by protocol version.
- **BREAKING**: Move `a2ui.inference_formats.experimental.express` to
  `a2ui.inference_formats.express`.
- `ExpressCompiler`: a variable holding a function call that names its
  `catalogId` (`total = formatString("...", catalogId="...")`) is inlined
  wherever it is used, like any other variable holding a function call.
  Previously it was compiled as a component and failed with "Unknown component".
- **BREAKING**: The agent SDK no longer depends on an agent framework. `a2ui.a2a`
  moves to the new `a2ui-a2a` package and `a2ui.adk` to the new `a2ui-adk`
  package, and `a2a-sdk`, `google-adk`, `google-genai` and `nest-asyncio` are no
  longer dependencies. Import paths are unchanged. To migrate, install the
  packages you use: `pip install a2ui-a2a` and `pip install "a2ui-adk[a2a]"`.
- **BREAKING**: `FileResolver` no longer creates `google.genai` parts.
  `to_genai_part` and `resolve_all_to_genai_parts` move to
  `a2ui.adk.GenAIFileResolver`. `FileResolver.resolve_all` resolves a list of
  file pointers, and `resolve_all` and `as_tool_decorator` take a `convert`
  callback `(bytes, mime_type) -> Any`. Without one they return
  `(bytes, mime_type)` tuples, and `as_tool_decorator` injects them into
  `resolved_files` instead of `genai_parts`. To keep the old behavior, use
  `GenAIFileResolver` from `a2ui-adk`.
- The experimental Elemental and Atom formats warn through an A2UI decorator
  instead of ADK's. Set `A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS`
  instead of `ADK_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS` to silence the
  warnings.
- `DirectJsonParser.parse_chunk` raises `A2uiValidationError` on the chunk that
  closes an invalid v1.0 component. Previously the error was swallowed until the
  block ended, and every component after it was held back.
- **BREAKING**: `DirectJsonStreamParser`, `DirectJsonStreamParserModern`,
  `DirectJsonStreamParserV08Legacy` and `DirectJsonFormat.create_stream_parser`
  are removed (#3074). To migrate, call `parse_chunk` on the parser that
  `DirectJsonFormat.create_parser()` returns. It streams v0.8, v0.9 and v1.0,
  and behaves differently from the removed parsers:
  - It adds no placeholder components. A parent is emitted with the child ids
    it names before those children arrive.
  - A message that is still arriving is emitted whole each time it changes,
    rather than pruned to the parts that parse.
  - A block whose messages never become valid, for example with an orphan or a
    cycle, raises when it closes instead of dropping the bad parts.
  - Paths are emitted as written. The v0.8 parser added a leading slash.
- `DirectJsonParser.parse_chunk` emits a `createSurface` or `beginRendering`
  once, after its object closes, instead of again each time it grows. A string
  that starts with `http://`, `https://` or `data:` is never healed, even under
  a progressive key, since a cut URL is a broken one.
- `InferenceFormat.supports_streaming` tells whether a format's parser
  implements `parse_chunk`. `DirectJsonFormat` returns `True`.
- `validate_payload` accepts a payload that creates a surface whose
  components name children that a later message in the payload adds, and a
  v0.8 payload that deletes a surface and starts it over.
- **BREAKING**: Implement `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `CatalogProvider` (`FileSystemCatalogProvider`, `InMemoryCatalogProvider`),
  `InferenceFormatFactory` (`DirectJsonFormatFactory`, `ExpressFormatFactory`,
  `ElementalFormatFactory`, `AtomFormatFactory`), `PromptGenerator`, and unified
  `Parser` (`ResponsePart`, `TextPart`, `A2uiPart`, `RawResponsePart`,
  `RawA2uiPart`) per `a2ui_agent.blueprint.md`. `InferenceFormat.parser` is
  replaced by `InferenceFormat.create_parser()`, `CatalogConfig` moves from
  `a2ui.schema` to `a2ui.processor` with
  `CatalogConfig(catalog, transformers=None)` and `transformed_catalog`, and
  `A2uiCatalogProvider` is replaced by `CatalogProvider`.
- `ComponentPruningTransformer` and `FunctionPruningTransformer` keep a
  catalog's metadata and authored document, so a pruned catalog loaded from a
  file serializes with `to_json()` as that file minus the pruned entries, with
  the unions rebuilt. The macro expander builds the expanded catalog from
  `to_json()`, keeping common type references and metadata (#3053).
- `DirectJsonPromptGenerator` (`schema_to_prompt`) embeds each active catalog's
  `Catalog.to_json()` document alongside the pruned `common_types` schema,
  avoiding duplicate inlined common type definitions across multiple catalogs.
- The SDK reads `Catalog.validation_schema` instead of the deprecated
  `catalog_schema` (#3053).
- A generated skill no longer falls back to the catalog's `description` when
  none is given, since catalogs loaded with `Catalog.from_json` now carry the
  file's description (#3053).

## 0.8.0 (2026-10-08)

- **BREAKING**: Package dependency updated to require `a2ui-core>=0.3.0,<0.4.0`.
- **BREAKING**: `Parser.compile` and inference format parsers/compilers now
  return `list[AgentToRendererMessage]` models, and `Parser.decompile` and
  format decompilers accept `Sequence[AgentToRendererMessage]` (#3064). Use
  `a2ui.inference_formats.to_message_models` and `to_message_dicts` to convert
  between dicts and models.
- **BREAKING**: Renamed `_DirectJsonDecompiler` to `DirectJsonDecompiler` and
  exported it from `a2ui.inference_formats` (#3064).
- **BREAKING**: `DirectJsonFormat`, `DirectJsonParser` and
  `DirectJsonStreamParser` now reject duplicate catalog IDs, and their
  `catalogs` property returns a list copy instead of a tuple (#3064).
- **BREAKING**: `remove_strict_validation` and the `schema_modifiers`
  parameter of `CatalogConfig.to_catalog` are removed. Catalog schemas are
  parsed as published, with `additionalProperties` and `unevaluatedProperties`
  kept, and `CatalogConfig` `transformers` are the way to shape a catalog. To
  migrate, drop `schema_modifiers=[remove_strict_validation]` from
  `to_catalog` calls, and make examples and generated payloads match the
  catalog schema.
- From v1.0, `DirectJsonStreamParser` yields a component only once its JSON
  object closes, instead of healing and yielding it while it streams. A v1.0
  component may name its own `catalogId` after its type and properties, and a
  component yielded early was checked against its surface's catalog. Progressive
  keys still heal data model values. v0.8 and v0.9 streaming is unchanged.
- **BREAKING**: `DirectJsonParser`, `DirectJsonStreamParser` and
  `A2uiPartConverter` take a sequence of catalogs instead of one catalog, and
  expose them as `catalogs`. A parser holds every catalog the renderer supports
  and checks each surface against the catalog that its start message names, or
  a component against the catalog its `catalogId` names. `DirectJsonFormat`
  passes all of its catalogs to its parsers, and `create_stream_parser()` uses
  the format's catalogs without taking a `catalog` parameter (#2967). To
  migrate, wrap a single catalog in a list: `DirectJsonParser([catalog])`.
- A `DirectJsonStreamParser` surface can be created again after
  `deleteSurface`. Before, the parser kept the surface ID as deleted and
  dropped every later message for it. v0.9 and later clear it on
  `createSurface`; v0.8, which has no `createSurface`, clears it on the next
  message for the surface that isn't `deleteSurface` (#2967).
- `validate_payload` takes `surface_catalog_ids`, the catalogs that earlier
  payloads created surfaces with, and checks updates to those surfaces against
  them, and types `payload` as `AgentToRendererMessagePayload` (#2967).
- Rename `DirectJsonStreamParserV08` to `DirectJsonStreamParserV08Legacy`
  (`streaming_v08_legacy.py`) and `DirectJsonStreamParserV09` to
  `DirectJsonStreamParserModern` (`streaming_modern.py`), fix the v0.9.1 and
  v1.0 streaming parsers applying the v0.8 path heuristic to data bindings, and
  pass `callRendererFunction` and `agentFunctionResponse` messages through for
  v1.0 (#2967).
- **BREAKING**: `A2uiCatalog` is removed. Inference formats, prompt
  generators, parsers, skills, macros and the ADK toolset take and return the
  `a2ui.core` catalog itself, typed `CatalogApi`. The protocol schemas that
  `A2uiCatalog` carried come from the inference format or from `a2ui.core`
  (#2966). To migrate:
  - `A2uiCatalog.from_config(config, version)` becomes
    `config.to_catalog(protocol_version=version)`, and
    `A2uiCatalog.from_json_file(path)` becomes
    `CatalogConfig.from_path(name, path).to_catalog()`.
  - `core_catalog` is the catalog itself, `version` becomes
    `protocol_version`, and `name` stays on `CatalogConfig`.
  - `catalog_schema` is the schema that the core catalog generates. Unlike
    the file, it refers to common types locally, has the catalog's own
    definitions inlined, and has no `$id`, `title` or `description`.
  - `s2c_schema` and `common_types_schema` are no longer on the catalog or
    the format. The SDK uses the published schemas for the catalog's
    protocol version, which `get_agent_to_renderer_schema_map` and
    `get_common_types_schema_map` in `a2ui.core` return.
  - `with_pruning(allowed_components, allowed_messages)` becomes
    `ComponentPruningTransformer(allowed_components)`, applied with
    `transform` or passed to `CatalogConfig` as `transformers`, and
    `schema_to_prompt([catalog], allowed_messages=...)`.
  - `render_as_llm_instructions()` becomes `schema_to_prompt([catalog])` from
    `a2ui.inference_formats.direct_json`.
  - `load_examples(path, validate)` becomes
    `load_examples([catalog], path, validate)` from `a2ui.schema`.
  - `validate_components(payload)`, which returned a list of errors, becomes
    `validate_payload([catalog], payload)` from `a2ui.utils`, which raises
    `A2uiValidationError`.
  - `validator` becomes `PayloadValidator(catalog)` from `a2ui.core`.
- Add `a2ui.catalog_transformers` with `CatalogTransformer`,
  `ComponentPruningTransformer` and `FunctionPruningTransformer`.
  `CatalogConfig` takes `transformers`, which `to_catalog` applies to the
  loaded catalog (#2966).
- Add `a2ui.utils`. `resolve_catalogs` returns the catalogs that are active
  for the capabilities a renderer sent. `prune_messages_schema` and
  `prune_common_types_schema` reduce the protocol schemas. `validate_payload`
  checks a payload the way a renderer holding the catalogs would, including
  the `version` that each message states, and raises `A2uiValidationError`
  (#2966).
- Add `schema_to_prompt` to `a2ui.inference_formats.direct_json`, which
  returns the prompt text for a sequence of catalogs of one protocol version,
  together with the agent-to-renderer schema and the common types
  they reference, shown once, and
  `DirectJsonFormat.create_stream_parser`, which builds a stream parser with
  the format's progressive keys (#2966).
- The Direct JSON stream parser checks each message with `validate_payload`,
  which runs it through a `MessageProcessor` holding the catalog, instead of
  against the JSON agent-to-renderer schema. It no longer takes or loads the
  protocol schemas, and its errors are the core's, prefixed with
  `Validation failed:` (#2966).
- **BREAKING**: `DirectJsonFormat(catalogs, *, examples_path, progressive_keys)`
  takes the catalogs that are already resolved for a renderer and no longer
  selects or changes them (#2966). To migrate:
  - The protocol version comes from the catalogs, which must share one. Pass
    the version to `CatalogConfig.to_catalog` instead of `version`.
    `schema_modifiers` is removed; the catalog, agent-to-renderer and common
    types schemas are used as published.
  - `get_selected_catalog(client_ui_capabilities)` is removed. Call
    `resolve_catalogs(configs, capabilities, accepts_inline_catalogs)` from
    `a2ui.utils` and build the format from the result, once per renderer.
    Inline catalogs become catalogs of their own instead of being merged into
    the selected one, and ones the agent doesn't accept are dropped instead
    of raising.
  - `resolve_catalogs` reads capabilities keyed by protocol version, such as
    `{"v0.9": {"supportedCatalogIds": [...]}}`. A flat capabilities object, a
    bare `V09Capabilities` model or an empty mapping raises
    `A2uiValidationError` instead of falling back to the default catalog. No
    capabilities at all activates every registered catalog instead of the
    first one, and an empty `supportedCatalogIds` without inline catalogs
    raises `A2uiCatalogError`.
  - `accepts_inline_catalogs` and `experiments` are removed from the format.
    The agent card still takes `accepts_inline_catalogs`.
  - The prompt describes every catalog of the format, and
    `prompt_generator.generate` raises `A2uiCatalogError` if given
    `client_ui_capabilities`. Its `allowed_components` and
    `allowed_messages` are deprecated and ignored. Prune components before
    building the format with `ComponentPruningTransformer`, for example passed
    to `CatalogConfig` as `transformers`, and restrict messages with
    `schema_to_prompt(catalogs, allowed_messages=...)`.
  - `examples_path` replaces `CatalogConfig.examples_path` for the prompt's
    examples, which are validated against every catalog of the format.
  - `_supported_catalogs` and `supported_catalog_ids` become the `catalogs`
    property, and the `load_examples` method becomes
    `load_examples(catalogs, path, validate)` from `a2ui.schema`.
- **BREAKING**: The deprecated `a2ui.schema.manager.A2uiSchemaManager` is
  removed. Use `DirectJsonFormat` (#2966).
- **BREAKING**: `DirectJsonParser.compile`, and so `parse_response`, checks a
  final payload with `validate_payload` against the parser's catalog, and
  raises `A2uiValidationError` for one that fails. Before, it checked nothing
  by default. `DirectJsonParser` no longer takes a `validator`. `A2uiPartConverter` uses this parser, so it
  now falls back for invalid A2UI (#2966).
- **BREAKING**: `CatalogConfig.custom_cuttable_keys` is removed. The string
  keys that the Direct JSON stream parser heals are now a format option,
  `DirectJsonFormat(progressive_keys=...)`, which replaces the defaults. The
  defaults are exported as `DEFAULT_PROGRESSIVE_KEYS` from
  `a2ui.inference_formats.direct_json`, and an empty set turns healing off
  (#2966).
- **BREAKING**: Allowlists are read literally. An empty `allowed_components`
  now keeps no components and an empty `allowed_messages` keeps no messages;
  before, an empty list kept everything. `None` still keeps everything
  (#2966).
- `SendA2uiToClientToolset` now returns a tool error, with the validation
  message, for a payload that fails validation. Before, it ignored the errors
  that `validate_components` returned (#2966).
- The schema helpers of the Express, Elemental and Atom formats inline a
  catalog's local references with `inline_local_refs` from `a2ui.core`, as
  `Catalog.from_json` does, so a catalog built from models, such as
  `BasicCatalog("0.9")`, keeps properties that it defines in its own `$defs`,
  such as `weight` (#2966).
- **BREAKING**: The SDK no longer bundles specification JSON files.
  `load_from_bundled_resource` and `A2UI_ASSET_PACKAGE` are removed; get the
  agent-to-renderer schema from `get_agent_to_renderer_schema_map` in
  `a2ui.core` instead. `PROTOCOL_VERSION_MAP`, its alias `SPEC_VERSION_MAP`,
  `SERVER_TO_CLIENT_SCHEMA_KEY` and `COMMON_TYPES_SCHEMA_KEY`, which described
  the specification files, are removed too. The `VERSION_*` constants still
  name the supported versions (#2964).
- Building or installing the SDK from source no longer regenerates the Express
  parser, so it no longer needs Java. The generated parser stays committed; after
  changing `Express.g4`, run `scripts/generate_express_parser.py` (#2964).
- Catalogs that inference formats take or return are typed `CatalogApi` from `a2ui.core` instead of `Catalog[Any, Any]`.
- Add A2UI Macros API under `a2ui.transformers.macros` (`@macro` decorator and `MacroExpander`), enabling authoring of reusable, high-level composite components using fluent Python builder classes that lower into primitive A2UI component subtrees (`transform_to_transport`) and synthesize inference catalog schemas (`transform_to_inference_catalog`, `to_catalog`) (#2519).
- **BREAKING**: The common types schema is no longer bundled as an asset.
  `DirectJsonFormat` takes it from a2ui-core's generated schema
  (`a2ui.schema.utils.load_common_types_schema`), the same definitions that
  payload validation uses.
- Streaming validation errors quote the schema's own pattern (for example
  `\p{XID_Start}`) instead of its expansion for Python's `re` module.
- **BREAKING**: `a2ui.basic_catalog` (`BasicCatalog`, `BundledCatalogProvider`,
  and `BASIC_CATALOG_NAME`) is removed, and the basic catalog JSON files are no
  longer bundled. Use `BasicCatalog` from `a2ui.core.basic_catalog` instead:
  `BasicCatalog.get_config(version)` becomes
  `CatalogConfig.from_catalog("basic", BasicCatalog(version))`.
- Add `CatalogConfig.from_catalog` and `InMemoryCatalogProvider` (exported from
  `a2ui.schema`) to configure a catalog from an `a2ui.core` catalog instance.

## 0.7.0 (2026-09-28)

- **BREAKING**: Validation modules `a2ui.validation.*` and `a2ui.schema.validator` are removed. Use `A2uiCatalog.validate_components` for component tree validation.
- **BREAKING**: `A2uiCatalog.validator` now returns a single-catalog `PayloadValidator` instance (from `a2ui.core.validation`) instead of `A2uiValidator`. `PayloadValidator` does not provide an envelope-walking `.validate()` method; call `A2uiCatalog.validate_components` or `PayloadValidator.validate_component()` / `PayloadValidator.validate_function()`.
- **BREAKING**: `A2uiTemplateManager` is removed.
- **BREAKING**: Package dependency updated to require `a2ui-core>=0.2.0,<0.3.0`.
- Add type-safe Python Builder API under `a2ui.builder` for constructing A2UI component trees as nested objects and serializing them into protocol messages (#2425).
- `A2uiCatalog.core_catalog` now passes its `common_types_schema` through to
  `Catalog.from_json`, so a catalog that references the shared types across
  documents resolves them from that document instead of leaving the references
  unresolvable.
- Add `SkillGenerator` API and `Skill` / `SkillSet` domain models to compile inference format rules and component catalog definitions into standardized agent skill packages (`SKILL.md`) (#2516).
- Use `is_at_least_version` and `ProtocolVersion.V1_0` in `ExpressCompiler` for protocol version comparisons.
- Update `A2uiCompilationError` to forward error `details` to `A2uiError.details` and inherit directly from `A2uiError`.

## 0.6.0

- Add support for keyword arguments (`param=value`) and mixed positional/keyword argument syntax in A2UI Express DSL component constructors and catalog function calls (#2131).
- Add multi-version output support (`v0.9`, `v0.9.1`, `v1.0`) to `ExpressCompiler`, emitting standard `v0.9.1` message sequences or `v1.0` unified surface envelopes based on target configuration (#2131).
- Add top-level `surface()` and `deleteSurface()` directive support in Express DSL to target or delete UI surfaces (#2163).
- Invoke ANTLR from the grammar's directory when regenerating the Express parser, so generated file headers no longer embed the absolute path of the machine that built them (#2371).
- Stop rewriting the non-package fallback import in the generated Express visitor to a relative import, which pointed at a module name the rename step had already replaced. A from-source build now leaves the working tree clean (#2371).

## 0.5.0

- Rename inference format `Transport` / `transport` terminology to `Direct JSON` / `direct_json` (`DirectJsonFormat`, `DirectJsonParser`, `DirectJsonStreamParser`). Deprecate `a2ui.inference_formats.transport` module alias.
- Cache `A2uiValidator` on `A2uiCatalog.validator` using `functools.cached_property` to avoid redundant construction on every access (#1972).

## 0.4.0

- Standardize Python namespace packages to PEP 420 (#1815). Note: Breaking change removing `a2ui.__version__` from the root `a2ui` namespace level; use `from a2ui.version import __version__`.
- Update required `a2ui-core` dependency to `>=0.1.1,<0.2.0`.

## 0.3.0

- Split `a2ui_core` and `a2ui_agent` into separate packages.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.2

## 0.1.1

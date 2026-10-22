# [a2ui_agent](https://pub.dev/packages/a2ui_agent) Changelog

## Unreleased

- Requires the next release of `a2ui_core`, which adds
  `SurfaceComponentsModel.insertComponent`, `insertComponents`,
  `saveReferenceFields` and `restoreReferenceFields` and
  `SurfaceGroupModel.detachSurface`, and exports
  `checkPathsAndRecursion` and `checkDuplicateComponentIds`. The release that
  publishes this version raises the `a2ui_core` constraint to `^0.3.1` along
  with that `a2ui_core` release; until then the workspace resolves
  `a2ui_core` from this repository.
- Breaking: `A2uiGenerator.inferenceFormatFactory` and
  `A2uiRequestProcessor.formatFactory` default to `ExpressFormatFactory`
  instead of `DirectJsonFormatFactory`.
- The Express compiler throws `A2uiValidationError` for a check on a
  component whose schema declares no `checks`, such as
  `Text("hi", ?required($/name))`, rather than writing `checks` onto it.
- Add `RendererState`, the agent's mirror of the surfaces a renderer holds.
  It wraps one `MessageProcessor` for its whole life and checks each message
  against everything applied before it, so an agent that keeps one state for
  a conversation catches a reference to a component no turn sent, a cycle
  with components from an earlier turn, or a new component that nothing
  reaches.
  - `apply` checks messages and applies them. The call is atomic: if a
    message is rejected, the state is left as it was. An update to a surface
    the state never saw created is rejected, as a renderer would reject it.
  - `transaction` makes several calls atomic. Transactions nest: a failed
    inner transaction undoes only what it applied, and the outer one goes
    on.
  - Being atomic costs what the messages change, not the size of the
    surfaces they touch: the state keeps an undo log of what each message
    replaced instead of copying a surface, so the time to apply n messages
    to one surface grows with n. A deleted surface is kept aside until the
    outermost call ends, so a rollback puts the same surface back. A rollback
    keeps the order of a surface's components and of the keys of its data
    model, restores the fields its references are read through, and undoes
    the whole log even if one step of it fails, rethrowing the error that
    caused the rollback.
  - `checkTopology` checks the trees of the given surfaces: the root exists,
    every reference resolves, and every component added or replaced since
    the last check is reachable from the root. A component that an update
    detached, by rewriting its parent's children, is accepted, since the
    protocol has no message that removes one component.
  - `markChecked` stops holding the components each surface changed against
    later `checkTopology` calls. A stream that fails after emitting messages,
    and a block cut off at the end of a response, mark their surfaces
    checked: the renderer holds those components and no message removes one,
    so later turns aren't required to make them reachable. Dangling
    references and a missing root are still reported.
  - `dispose` releases the surfaces the state holds.
- Add `validatePayload`, which checks one payload with no record of earlier
  ones, such as the argument of a tool call. It runs on a short-lived
  `RendererState` that assumes a surface the payload only updates exists, and
  replaces the processor that payload checks built for every call.
- Breaking: `Parser.parseResponse` and `A2uiRequestProcessor.parseResponse`
  take an optional `state` and check every message they compile against it.
  Without one, a call checks the response against a new, empty state, as a
  chat turn that shows new UI, so an update to a surface the response does
  not create is rejected; `Parser.parseResponse` accepted it before. A
  canvas agent keeps one state for the conversation and passes it on every
  turn. The response is applied to the state all or nothing, and the trees of
  every surface it touches, including surfaces it only updates, are checked
  once every block is applied, unless a block is cut off by the end of the
  response; the components of a cut-off block are marked checked. Express
  output is checked the same way, which rejects inline child ids that collide
  with assigned variables and check lists on components that declare none.
- Breaking: a parser holds no state, so one parser reads every response of a
  request. `Parser.parseChunk` is removed: open a stream for each response
  with `parser.openStream(wrapped: ...)`, call `feed(chunk)` for each chunk,
  and `close()` after the last one. `Parser.openStream` and
  `A2uiRequestProcessor.openStream` return a `ResponseStream`, and the direct
  JSON parser a `DirectJsonResponseStream`:
  - Each message the stream emits is checked against the stream's state and
    applied to it as it is emitted, so the state mirrors what the renderer
    received even when the response fails part way.
  - When a block closes, the trees of the surfaces it touched are checked,
    which a streamed response skipped before: a component nothing reaches, a
    dangling reference or a cycle now throws.
  - Only `updateComponents` and `updateDataModel` are emitted while they grow;
    any other message, such as `createSurface`, `deleteSurface` or
    `callRendererFunction`, is held until its object closes, so it is emitted
    once. A message for a surface that does not exist yet is held back, as a
    renderer would reject it, and the block throws when it closes.
  - `close` emits the text held back as a possible tag, throws
    `A2uiParseError` if a block is still open, and checks the tree of an
    unwrapped stream.
  - A stream that throws has ended: `feed` then throws `StateError`, and
    `close` returns nothing. The messages it emitted stay in its state, and
    their components are marked checked.
- Breaking: `Parser.compile` only translates a block into messages. It
  reports what the notation gets wrong, but `DirectJsonParser.compile` no
  longer checks components, function calls, themes or catalog ids against the
  catalogs; `parseResponse(block, wrapped: false)` compiles and checks one
  block. A `Parser` subclass implements the new `catalogs` getter.
- `A2uiRequestProcessor` reuses one parser, which its `parser` getter
  returns. `createState` creates an empty `RendererState` for the active
  catalogs. A processor can be bound to a state, through its `state`
  constructor parameter or `A2uiGenerator.createProcessor(..., state: ...)`,
  so that `parseResponse` and `openStream` use it when a call passes none.
  A state for other catalogs throws `A2uiCatalogError`.
  `A2uiRequestProcessor.acceptsState` tells whether a state holds the
  processor's catalogs, so an agent that keeps a state per conversation can
  tell when to make a new one.
  `A2uiRequestProcessor.parseResponse` also takes `wrapped`.
- Support cross-catalog `$ref` references across peer catalogs in
  `resolveCatalogs`, payload checks, `DirectJsonPromptGenerator` (preserving
  unbundled external `$ref`s in `Catalog.toJson()` while retaining transitive
  `common_types.json` definitions), and the Express format (`ExpressPromptGenerator`,
  `ExpressCompiler`, and `ExpressDecompiler`). Each links copies of the
  catalogs with `linkCatalogs` and never changes the catalogs it is given:
  `resolveCatalogs` returns linked copies, linked with every registered
  catalog as declared and as transformed, and `ExpressCompiler.catalogs` and
  `ExpressDecompiler.catalogs` hold linked copies. An inline catalog the agent
  does not accept is linked with nothing.
- `CatalogConfig.transformedCatalog` is computed on first access and then
  reused, so every request sees the same transformed catalog.
- Implemented protocol v1.0. The SDK reads and writes the protocol version
  that the active catalogs target, rather than always v0.9:
  - `FileSystemCatalogProvider` and `InMemoryCatalogProvider` load documents
    that declare `protocolVersion` `1.0`, and take
    `A2uiProtocolVersion.v1_0`.
  - `resolveCatalogs`, and so `A2uiGenerator.createProcessor`, negotiate a
    protocol version with the renderer. The registered catalogs may target
    several versions; the latest one the renderer declares capabilities for
    is used, or the next earlier one when the two have no catalog in common
    there. `createProcessor` gives each processor the example turns written
    in its version, and throws `A2uiValidationError` for a turn written in a
    version no registered catalog targets.
  - Without capabilities, `resolveCatalogs` throws `A2uiCatalogError` for
    registered catalogs of different versions, since nothing says which one
    the renderer reads. Given capabilities, it throws it when no catalog is
    registered.
  - Both formats compile and decompile v1.0 messages, in which a component
    or function call may name its own catalog.
  - In Express, a `catalogId` argument names a catalog, and a function call
    written as a statement of its own compiles to `callRendererFunction`.
  - The Express prompt explains how to name a catalog, lists the functions
    the agent may call, and carries each catalog's `instructions`.
  - A `callRendererFunction` may call only a function whose `allowedCallers`
    lets the agent call it and that needs no user activation. `RendererState`,
    `openStream`, `parseResponse` and `ExpressCompiler.compile` all check it
    through `a2ui_core`'s `MessageProcessor.forAgent`, so a streamed call the
    renderer would reject is never emitted.
  - The direct JSON parser holds a streamed v1.0 component back until it
    closes; `bufferIncompleteComponents` applies only before v1.0.
- Exported `ExpressFormat`, `ExpressPromptGenerator`, `ExpressParser`,
  `ExpressCompiler` and `ExpressDecompiler`, which the agent SDK blueprint
  lists, as the direct JSON classes are. `ExpressFormat` has a public
  constructor, as `DirectJsonFormat` does.
- `DirectJsonFormat` and `ExpressFormatFactory.createFormat` throw
  `A2uiCatalogError` for two catalogs with the same id, since a `catalogId`
  could not say which of the two it names.
- Express prompts, compilers and decompilers, and direct JSON parsers, throw
  `A2uiCatalogError` for catalogs that target different protocol versions.
  Catalogs of v0.9 and v0.9.1, which share message shapes, mix as v0.9, there
  and in `resolveCatalogs`.
- Payload checks run through `a2ui_core`'s `MessageProcessor.forAgent`.
- `DirectJsonResponseStream` reads and checks only what each chunk adds,
  rather than the whole block so far: a message once it closes, after which
  it is not read again, a growing `updateComponents` for its new components,
  and a growing `updateDataModel` for the lists and maps its value gains,
  with the value applied once it closes. The time to stream a payload grows
  with its size rather than with its square: streaming 6.4 KB in 16-byte
  chunks takes about 0.1 s rather than 1.4 s, and 105 KB about 0.3 s. A
  message that grows is emitted again with the components it emitted
  before, as the same objects.
- The Express decompiler rejects a check condition with extra fields rather
  than dropping them.
- The Express prompt gives each function's description.
- A streamed string cut inside an escaped surrogate pair is cut before the
  pair rather than healed with U+FFFD.
- The Express compiler rejects an inline component whose id another
  component has, rather than renaming it.
- The Express decompiler writes a single check without brackets, a multiline
  string with backslashes as a raw triple-quoted string, and an
  `updateDataModel` below the root as assignments at its path.
- A check's default message has no trailing period, as in the other SDKs.
- Bump `a2ui_core` dependency to `^0.3.0`.
- The Direct JSON prompt lists `description` after `type` in the
  agent-to-renderer and `common_types` schemas it embeds, following the
  reordered specification files.
- Align `MessageProcessor.model` and `PayloadValidator` usage with `a2ui_core`.
- `DirectJsonPromptGenerator` embeds the agent-to-renderer schema, the pruned
  `common_types` schema, and each active catalog's `Catalog.toJson()` document
  instead of the deprecated `catalogSchema`, avoiding duplicate inlined common
  type definitions when multiple catalogs are active.
- `allowedMessages` of the Direct JSON format accepts only messages: the
  definitions the agent-to-renderer schema lists in `oneOf` and their envelope
  keys. Other definitions, such as v1.0's `Component` and `ComponentsList`,
  throw `ArgumentError`.
- Payload validation builds its `MessageProcessor` with `defaultVersion`.
- Payload validation gives `MessageProcessor` the catalog through
  `Catalog.withFunctions`, so a catalog read by `Catalog.fromJson` keeps its
  protocol version, its authored `$defs` (a recursive `#/$defs/node` no
  longer fails as an unresolvable reference) and each function's
  `description` and declared `allowedCallers` and `requiresUserActivation`.
- The Express format reads component signatures from
  `Catalog.resolvedComponentSchema`, since `ComponentApi.schema` now keeps a
  component's schema as the catalog document wrote it.
- `FileSystemCatalogProvider` and `InMemoryCatalogProvider` pass the
  provider's id and protocol version to `Catalog.fromJson` instead of
  writing the id into the document, so `load().toJson()` writes back a
  document that omits its `catalogId` without one, and the catalog reports
  the provider's protocol version when the document declares none.
- Include common mixin properties (`accessibility`, `weight`) at the end of
  Express component signatures (after component-specific properties) so
  positional arguments map to component properties while supporting common
  properties via keyword arguments; previously they were omitted.
- `A2uiRequestProcessor` checks each example with `validatePayload`, as one
  render: a surface the example creates may arrive across several
  `updateComponents` messages, and must have a root, resolved references and
  every component reachable from the root once the whole example is applied.
  An example may also update a surface it does not create, which is assumed
  to exist; such an example was rejected before. Undeclared component types,
  duplicate ids, cycles and malformed data-model paths are still rejected per
  message.
- `DirectJsonParser`, `DirectJsonFormat` and `DirectJsonFormatFactory` take
  `bufferIncompleteComponents`. When it is true, a streamed component is
  emitted only once its JSON object closes, as v1.0 requires, and progressive
  keys heal only values outside components. It is false by default, which keeps
  the v0.9 behavior of healing a component while it streams.
- The Direct JSON message reader and the Express decompiler continue to
  reject a `createSurface` message without a `catalogId` with
  `A2uiValidationError`. The check moved into the agent SDK now that
  `a2ui_core` makes the field optional for v1.0; previously `a2ui_core`
  rejected the message during parsing.
- pub.dev now recognizes the license. The package `LICENSE` linked
  `https://` where the Apache text has `http://`, which pana does not match,
  and carried the root's notice for `eval/bin/transcrypt`, a file outside
  this package. Also a longer `description`.
- The Express lexer and parser are generated from `Express.g4` with ANTLR
  instead of written by hand, so the package depends on `antlr4`. Where the
  handwritten parser differed from the grammar, Express now follows the
  grammar: a comment ends at a lone `\r`, `r"""` without a closing `"""` is
  read as `r""` followed by a string, and `r"` followed by a line break is
  read as the name `r` followed by a string. Syntax errors carry ANTLR's
  messages, and their columns count Unicode code points.
- `ExpressParser.unwrap` and `hasFormatContent` read strings and comments as
  `Express.g4` does when finding the `</a2ui>` that ends a block, so a close
  tag after one of the constructs above ends the block instead of being read
  as part of a string or comment.
- An Express integer too large for `int` compiles to a double instead of
  throwing `FormatException`.

## 0.0.1-wip005

- Catalogs are typed `CatalogApi`, the new name of `a2ui_core`'s
  `SchemaCatalog`.
- `ComponentPruningTransformer` and `FunctionPruningTransformer` now accept an optional or null allowlist, treating it as empty.

- Implemented the rest of the agent SDK blueprint API for protocol v0.9:
  - `CatalogProvider`, `FileSystemCatalogProvider`, `InMemoryCatalogProvider`
    and `CatalogConfig.fromPath`. A document's id and version are settled with
    the provider's; on the web, `FileSystemCatalogProvider` cannot read files.
  - The direct JSON format: `DirectJsonFormatFactory`, `DirectJsonFormat`,
    `DirectJsonPromptGenerator` and `DirectJsonParser`. The prompt carries the
    v0.9 message schema pruned to `allowedMessages`, the common types and the
    catalogs. `parseChunk` emits each message once it reads and satisfies the
    catalogs, healing `progressiveKeys` while their values stream.
  - Express decompilation, through `Parser.decompile`, and prompt examples
    in the Express prompt.
  - Inline catalogs in `resolveCatalogs`, when `acceptsInlineCatalogs` is
    true. An inline catalog whose id is already active is dropped.
- Added `CatalogTransformer`, `ComponentPruningTransformer`,
  `FunctionPruningTransformer` and `CatalogConfig.transformers`.
- Added `resolveCatalogs`, which `A2uiGenerator.createProcessor` now uses. The
  active catalogs are the transformed ones. Renderer capabilities of null,
  for a request that carries none, activate every registered catalog.
- Added `allowedMessages` to `ExpressFormatFactory`. The Express prompt
  describes only the statements that compile to the allowed message types.
- Added `examples` to `A2uiGenerator`, `A2uiRequestProcessor`,
  `ExpressPromptGenerator` and `InferenceFormatFactory.createFormat`. A
  processor checks each example against its active catalogs when it is
  created, and renders its prompt then, so an example the format cannot
  write fails there.
- `A2uiGenerator.createProcessor` takes an `inferenceFormatFactory` that
  overrides the generator's.
- `Parser` has new members: `hasFormatContent`, `wrap`, `decompile`,
  `supportsStreaming` and `parseChunk`. Only the direct JSON parser
  implements `parseChunk`.
- The Express compiler reads a block that assigns components but no `root`
  as an update of a surface created earlier, and compiles it to
  `updateComponents` alone.
- A payload whose `createSurface` names an inactive catalog is an
  `A2uiValidationError` rather than an `A2uiCatalogError`.
- The Express syntax rules no longer show `Card(...)`, so a pruned `Card`
  never reaches the prompt.
- Breaking: the Express parser reads a direct JSON block (`<a2ui-json>`) as
  text instead of throwing `A2uiParseError`. A parser reads only its own
  format's tags.
- Breaking: `A2uiGenerator.inferenceFormatFactory` and
  `A2uiRequestProcessor.formatFactory` default to `DirectJsonFormatFactory`
  instead of being required, as in the blueprint.
- Breaking: custom `Parser` subclasses must implement the new abstract
  members.

## 0.0.1-wip004

- Implement full Express format compiler, parser, syntax lexer, and prompt generator for protocol v0.9:
  - `ExpressCompiler`: Compiles Express blocks (`components`, `updateComponents`, `dataModel`, `updateDataModel`, `deleteSurface`) into canonical A2UI v0.9 message payloads.
  - `ExpressParser`: Parses streaming LLM output into structured `ResponsePart` chunks (`TextBlock`, `ExpressBlock`), validating message boundaries and syntax.
  - `ExpressPromptGenerator` / `A2uiRequestProcessor.promptSnippet`: Dynamically generates system prompt instructions describing Express syntax, active catalog components, functions, and positional signatures.
  - `ExpressSyntax`: Grammar, token definitions, keywords, and AST representation for Express blocks.
- Add shared conformance test harness integration running cross-language `conformance/agent/express` test suites (`express_conformance_test.dart`).
- Add end-to-end integration test runner in `e2e_test/` targeting Gemini models (`gemini-3.6-flash`).
- Bump dependency on `a2ui_core` to `^0.2.2`.

## 0.0.1-wip003

- Added the initial API scaffolding for one agent turn in the Express format, limited
  to protocol v0.9: `A2uiGenerator`, `A2uiRequestProcessor`, `CatalogConfig`,
  `InferenceFormatFactory`, `ExpressFormatFactory` and the `ResponsePart`
  types.
- `InferenceFormatFactory.createFormat` binds a format to the active catalogs
  as an `InferenceFormat`, which provides a `PromptGenerator` and a `Parser`.
- Removed the placeholder `Awesome` class.

## 0.0.1-wip002

- Requires `a2ui_core` `^0.2.0`, which takes two type parameters on `Catalog`.
- Dropped an unnecessary `library;` directive.

## 0.0.1-wip001

- Initial version.

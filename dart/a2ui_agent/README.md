# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md). It
implements the whole API of the blueprint for A2UI protocols v0.9 and v1.0,
with two inference formats: [Express](../../specification/proposals/express/README.md),
the default, a compact notation read once the response is complete, and direct
JSON, which can be read as it streams.

The protocol version is the one the catalogs target. A v1.0 catalog document
declares it as `protocolVersion`; a v0.9 document declares none, so a catalog
provider loading one is given `A2uiProtocolVersion.v0_9`. The catalogs
registered with one `A2uiGenerator` may target several versions: each
processor negotiates one with its renderer, the latest version in which the
two have a catalog in common, and shows the model the examples written in it.

## Status

Implemented:

- `FileSystemCatalogProvider`, `InMemoryCatalogProvider` and
  `CatalogConfig.fromPath` load catalog documents, checking the catalog id and
  protocol version against the ones the provider is given.
- `A2uiGenerator.createProcessor` and `resolveCatalogs` negotiate the
  protocol version, then pick the registered catalogs of that version the
  renderer supports, after their transformers, and the inline catalogs it
  declares when `acceptsInlineCatalogs` is true. For a request
  that carries no capabilities, `resolveCatalogs` takes null and activates
  every registered catalog.
- `ComponentPruningTransformer` and `FunctionPruningTransformer` narrow a
  catalog to an allowlist.
- `A2uiRequestProcessor.promptSnippet` teaches the model the format, the
  catalogs' components and functions, and the prompt examples, written in the
  format. Both format factories take `allowedMessages`, which limits the
  prompt to the message types the model may write.
- `A2uiRequestProcessor.parseResponse` compiles each payload block into
  messages and checks them against a `RendererState`, the agent's mirror of
  the surfaces a renderer holds, as described in
  [Chat and canvas](#chat-and-canvas).
- `validatePayload` checks one payload on its own, such as the argument of a
  tool call.
- Prompt examples are checked against the active catalogs, and written in the
  format, when a processor is created.
- For both formats, `Parser` wraps and unwraps responses, and compiles and
  decompiles payloads. A parser holds no state, so one parser reads every
  response of a request. The direct JSON parser also reads a streamed
  response through the `ResponseStream` that `openStream` returns.

What v1.0 adds to both formats:

- A `createSurface` carries the surface's components and initial data model,
  and a data binding or a function call is written with `@path` or `@call`.
- A component or a function call may name its own catalog. With several
  catalogs a surface names none, and each component and call names its own,
  as [multi_catalog_formats.yaml](../../conformance/agent/multi_catalog_formats.yaml)
  describes. In Express, a name that several catalogs declare takes a
  `catalogId` argument.
- A `callRendererFunction` asks the renderer to run a function.
  A parser and `processor.parseResponse` accept a call only to a function
  whose `allowedCallers` lets the agent call it and that needs no user
  activation, as `a2ui_core`'s `MessageProcessor.forAgent` checks, so
  `openStream` never emits a call the renderer would reject. In Express it is a
  function call written as a statement of its own, and the prompt names the
  functions that can be called this way.
- The direct JSON parser holds a streamed component back until its object
  closes, since the component's `catalogId` may come last.
- The Express prompt carries each catalog's `instructions`, with the JSON
  examples in them written in Express.

Not supported:

- Protocol versions other than v0.9 and v1.0.
- A request without renderer capabilities in `createProcessor`, which
  requires them, as in the blueprint.
- In Express for v0.9, function calls written as statements of their own,
  such as `openUrl("...")`, since v0.9 has no message for them. Decompiling
  messages that use what Express cannot write throws `A2uiValidationError`.

## Usage

See [example/a2ui_agent_example.dart](example/a2ui_agent_example.dart) for one
agent turn:

```dart
final generator = A2uiGenerator(catalogs: [CatalogConfig(catalog)]);
final A2uiRequestProcessor processor = generator.createProcessor(
  rendererCapabilities,
);
final String llmOutput = await callLlm(processor.promptSnippet, userMessage);
final List<ResponsePart> parts = processor.parseResponse(llmOutput);
```

To show the UI while the model is still writing it, configure a processor with
`DirectJsonFormatFactory` and read the direct JSON response as it streams,
through a stream opened for that response. Each part carries the text, or the
messages, that are new or changed since the previous chunk. Call `close` after
the last chunk: it returns the text held back as a possible tag, and throws if a
block is still open:

```dart
final A2uiRequestProcessor processor = generator.createProcessor(
  rendererCapabilities,
  inferenceFormatFactory: const DirectJsonFormatFactory(),
);
final ResponseStream stream = processor.openStream();
await for (final String chunk in llmStream) {
  stream.feed(chunk).forEach(deliver);
}
stream.close().forEach(deliver);
```

To heal a string while it streams, such as the text of a `Text` component,
name its key in `progressiveKeys` of the `DirectJsonFormatFactory` given to
the generator.

### Chat and canvas

Each response is checked against a `RendererState`, which holds the surfaces
a renderer holds and checks each message against everything sent before it.
How long the state lives depends on how the agent shows UI:

1. In a chat, each turn shows new UI. Pass no state, and each call checks the
   response against a new, empty one, so an update to a surface the response
   does not create is rejected.
2. In a canvas, turns update the surfaces that earlier turns created. Keep one
   state for the conversation, created by `processor.createState()`, and pass
   it to `parseResponse` or `openStream` on every turn, or bind it with
   `generator.createProcessor(capabilities, state: state)`.

A response parsed whole is applied to the state all or nothing, and the
trees of the surfaces it touches are checked once every block is applied. A
streamed response applies each message as it is emitted, so the state matches
what the renderer received even when the response fails part way.

```dart
final RendererState canvas = processor.createState();
// On every turn:
final List<ResponsePart> parts = processor.parseResponse(
  llmOutput,
  state: canvas,
);
```

## Tests

[test/conformance](test/conformance) runs every shared agent suite this API
covers: those under [conformance/agent/direct_json](../../conformance/agent/direct_json)
and [conformance/agent/express](../../conformance/agent/express), and
`catalog_provider.yaml`, `catalog_resolution.yaml`, `catalog_transformer.yaml`
and `request_processor.yaml` under [conformance/agent](../../conformance/agent).
They are written against v1.0, and each runs twice: as written in v1.0, and
lowered to v0.9, where the harness lowers what a case hands the package to
v0.9 and lifts what it returns back to v1.0 before comparing; see
[test/conformance/suites.dart](test/conformance/suites.dart). Cases that need
something v0.9 or this API does not have are skipped with the reason.
[conformance/agent/multi_catalog_formats.yaml](../../conformance/agent/multi_catalog_formats.yaml)
runs as written in v1.0 only.

The `scaling.yaml` suites time parsing rather than check what it returns, and
a slow or loaded machine can fail them, so their tests are tagged
`performance` and [dart_test.yaml](dart_test.yaml) skips them. Run them with
`dart test -P performance`. CI runs them in a job of their own.

The other tests cover what the suites do not: the published basic catalogs,
decisions of this package, errors, and a round trip of every basic catalog
example through both formats.

[e2e_test](e2e_test) runs an agent turn in each format against a real Gemini
model, and a direct JSON turn read as it streams, for v0.9 and v1.0. It needs
an API key, so it lives in a separate package and runs in a separate CI
pipeline.

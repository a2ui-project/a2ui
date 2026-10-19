# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md). It
implements the whole API of the blueprint for A2UI protocols v0.9 and v1.0,
with two inference formats: direct JSON, the default, which can be read as it
streams, and [Express](../../specification/proposals/express/README.md), a
compact notation read once the response is complete.

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
  messages and checks them the way a renderer would.
- Prompt examples are checked against the active catalogs, and written in the
  format, when a processor is created.
- For both formats, `Parser` wraps and unwraps responses, and compiles and
  decompiles payloads. The direct JSON parser also reads a streamed response
  through `parseChunk`.

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
  `parseChunk` never emits a call the renderer would reject. In Express it is a
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
final generator = A2uiGenerator(
  catalogs: [CatalogConfig(catalog)],
  inferenceFormatFactory: const ExpressFormatFactory(),
);
final A2uiRequestProcessor processor = generator.createProcessor(
  rendererCapabilities,
);
final String llmOutput = await callLlm(processor.promptSnippet, userMessage);
final List<ResponsePart> parts = processor.parseResponse(llmOutput);
```

To show the UI while the model is still writing it, read a direct JSON
response as it streams, with a parser for the negotiated catalogs. Each part
carries the text, or the messages, that are new or changed since the previous
chunk:

```dart
final Parser parser = const DirectJsonFormatFactory(
  progressiveKeys: {'text'},
).createFormat(processor.activeCatalogs).createParser();
await for (final String chunk in llmStream) {
  for (final ResponsePart part in parser.parseChunk(chunk)) {
    deliver(part);
  }
}
```

A streamed message is checked on its own. `processor.parseResponse` on the
whole response also runs the checks that need the whole surface, such as a
reachable root.

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

The other tests cover what the suites do not: the published basic catalogs,
decisions of this package, errors, and a round trip of every basic catalog
example through both formats.

[e2e_test](e2e_test) runs an agent turn in each format against a real Gemini
model, and a direct JSON turn read as it streams, for v0.9 and v1.0. It needs
an API key, so it lives in a separate package and runs in a separate CI
pipeline.

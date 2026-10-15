# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md). It
implements the whole API of the blueprint for A2UI protocol v0.9, with two
inference formats: direct JSON, the default, which can be read as it streams,
and [Express](../../specification/proposals/express/README.md), a compact
notation read once the response is complete. Protocol v1.0 is declared and
partly implemented; see [Status](#status).

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

For protocol v1.0, catalogs load, negotiate with the renderer's v1.0
capabilities, and are described by the direct JSON prompt. The rest throws
`UnimplementedError` for v1.0 catalogs until it is implemented:

- the Express prompt;
- compiling Express and direct JSON into v1.0 messages, including streaming
  direct JSON, and decompiling them into Express;
- checking v1.0 examples and responses, which `a2ui_core`'s
  `MessageProcessor.forAgent` will do once it checks a `callRendererFunction`.

Not supported:

- Protocol versions other than v0.9 and v1.0.
- A request without renderer capabilities in `createProcessor`, which
  requires them, as in the blueprint.
- In Express, standalone function calls such as `openUrl("...")` on a line of
  their own, since v0.9 has no message for them, and properties every
  component shares, such as `weight`. Decompiling messages that use what
  Express cannot write throws `A2uiValidationError`.
- Function descriptions in the Express prompt, since `a2ui_core`'s
  `FunctionApi` does not keep them.

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
something v0.9 or this API does not have are skipped with the reason, and a
v1.0 case that reaches a part not implemented yet is skipped naming that
part. [conformance/agent/multi_catalog_formats.yaml](../../conformance/agent/multi_catalog_formats.yaml)
runs as written in v1.0 only.

The other tests cover what the suites do not: the published basic catalogs,
decisions of this package, errors, and a round trip of every basic catalog
example through both formats. Tests of v1.0 behavior that is not implemented
yet are skipped.

[e2e_test](e2e_test) runs an agent turn in each format against a real Gemini
model, and a direct JSON turn read as it streams, for v0.9; the v1.0 turns are
skipped until v1.0 is implemented. It needs an API key, so it
lives in a separate package and runs in a separate CI pipeline.

# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md), limited
to A2UI protocol v0.9. It implements the whole API of the blueprint, with two
inference formats: direct JSON, the default, which can be read as it streams,
and [Express](../../specification/proposals/express/README.md), a compact
notation read once the response is complete.

## Status

Implemented:

- `FileSystemCatalogProvider`, `InMemoryCatalogProvider` and
  `CatalogConfig.fromPath` load catalog documents, checking the catalog id and
  protocol version against the ones the provider is given.
- `A2uiGenerator.createProcessor` and `resolveCatalogs` pick the registered
  catalogs the renderer supports, after their transformers, and the inline
  catalogs it declares when `acceptsInlineCatalogs` is true. For a request
  that carries no capabilities, `resolveCatalogs` takes null and activates
  every registered catalog.
- `ComponentPruningTransformer` and `FunctionPruningTransformer` narrow a
  catalog to an allowlist.
- `A2uiRequestProcessor.promptSnippet` teaches the model the format, the
  catalogs' components and functions, and the prompt examples, written in the
  format. Both format factories take `allowedMessages`, which limits the
  prompt to the message types the model may write.
- `A2uiRequestProcessor.parseResponse` compiles each payload block into v0.9
  messages and checks them the way a renderer would.
- Prompt examples are checked against the active catalogs, and written in the
  format, when a processor is created.
- For both formats, `Parser` wraps and unwraps responses, and compiles and
  decompiles payloads. The direct JSON parser also reads a streamed response
  through `parseChunk`.

Not supported:

- Protocol versions other than v0.9.
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
They are written against v1.0, so the harness lowers what a case hands the
package to v0.9 and lifts what it returns back to v1.0 before comparing; see
[test/conformance/suites.dart](test/conformance/suites.dart). Cases that need
something v0.9 or this API does not have are skipped with the reason.

The other tests cover what the suites do not: the published v0.9 basic
catalog, decisions of this package, errors, and a round trip of every v0.9
basic catalog example through both formats.

[e2e_test](e2e_test) runs an agent turn in each format against a real Gemini
model, and a direct JSON turn read as it streams. It needs an API key, so it
lives in a separate package and runs in a separate CI pipeline.

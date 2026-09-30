# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md), limited
to A2UI protocol v0.9. It declares the whole API of the blueprint and
implements the [Express](../../specification/proposals/express/README.md)
inference format. The rest of the API is stubbed and throws
`UnimplementedError`.

## Status

Implemented:

- `A2uiGenerator.createProcessor` and `resolveCatalogs` pick the registered
  catalogs the renderer supports, after their transformers.
- `ComponentPruningTransformer` and `FunctionPruningTransformer` narrow a
  catalog to an allowlist.
- `A2uiRequestProcessor.promptSnippet` teaches the model the Express syntax and
  the catalogs' components and functions.
- `A2uiRequestProcessor.parseResponse` compiles each Express block into v0.9
  messages and checks them the way a renderer would.
- Prompt examples are checked against the active catalogs when a processor is
  created.
- `Parser.wrap` and `Parser.hasFormatContent` for Express.

Stubbed:

- Loading catalogs with `FileSystemCatalogProvider`, `InMemoryCatalogProvider`
  and `CatalogConfig.fromPath`.
- Inline catalogs in `resolveCatalogs`.
- Prompt examples in the Express prompt, and decompiling messages into Express.
- The direct JSON format, including streaming. It is the default format of
  `A2uiGenerator` and `A2uiRequestProcessor`, so pass `ExpressFormatFactory`
  to get a working processor.

Not supported:

- Protocol versions other than v0.9.
- Standalone function calls such as `openUrl("...")` on a line of their own,
  since v0.9 has no message for them.
- Function descriptions in the prompt, since `a2ui_core`'s `FunctionApi` does
  not keep them.

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

## Tests

[test/conformance](test/conformance) runs the shared suites under
[conformance/agent/express](../../conformance/agent/express) and
[conformance/agent/catalog_transformer.yaml](../../conformance/agent/catalog_transformer.yaml). They are written
against v1.0, so the harness lifts the v0.9 messages this package emits into
the v1.0 shape before comparing. Cases for what is not implemented yet are
skipped with the reason.

[e2e_test](e2e_test) runs the example turn against a real Gemini model. It
needs an API key, so it lives in a separate package and runs in a separate
CI pipeline.

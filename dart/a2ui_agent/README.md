# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md), limited
to A2UI protocol v0.9 and the
[Express](../../specification/proposals/express/README.md) inference format.

## Status

The API is a stub. Catalog negotiation and the version and format checks work;
`A2uiRequestProcessor.promptSnippet` and `A2uiRequestProcessor.parseResponse`
throw `UnimplementedError`.

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

[e2e_test](e2e_test) runs the example turn against a real Gemini model. It
needs an API key, so it lives in a separate package and runs in a separate
CI pipeline.

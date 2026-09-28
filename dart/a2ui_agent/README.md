# A2UI Agent SDK

Helps an AI agent generate A2UI: it negotiates catalogs with the renderer,
teaches the LLM the catalog through a system prompt snippet, and parses the
LLM's response into A2UI messages.

The package follows the
[agent SDK blueprint](../../blueprints/modules/a2ui_agent.blueprint.md), limited
to A2UI protocol v0.9 and the
[Express](../../specification/proposals/express/README.md) inference format.

## Status

Implemented for one agent turn:

- `A2uiGenerator.createProcessor` picks the registered catalogs the renderer
  supports.
- `A2uiRequestProcessor.promptSnippet` teaches the model the Express syntax and
  the catalogs' components and functions.
- `A2uiRequestProcessor.parseResponse` compiles each Express block into v0.9
  messages and checks them the way a renderer would.

Not supported yet:

- Protocol versions other than v0.9, and formats other than Express.
- Standalone function calls such as `openUrl("...")` on a line of their own,
  since v0.9 has no message for them.
- Catalog transformers and prompt examples.
- Decompiling messages into Express, and `Parser.wrap`.
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
[conformance/agent/express](../../conformance/agent/express). They are written
against v1.0, so the harness lifts the v0.9 messages this package emits into
the v1.0 shape before comparing. Cases for what is not implemented yet are
skipped with the reason.

[e2e_test](e2e_test) runs the example turn against a real Gemini model. It
needs an API key, so it lives in a separate package and runs in a separate
CI pipeline.

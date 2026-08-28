# A2UI Agent SDK

The Dart agent SDK for [A2UI](https://github.com/a2ui-project/a2ui): catalog
management, capability negotiation, prompt engineering, response parsing and
payload validation for agents that generate UI.

It implements **version 0.9** of the A2UI protocol. Payloads and capabilities
that declare any other version, or that omit the version, are rejected.

## Status

This package currently defines the API surface described by
[the agent blueprint](https://github.com/a2ui-project/a2ui/blob/main/blueprints/modules/a2ui_agent.blueprint.md).
Catalog loading, catalog transformers, format wiring and response part handling
are implemented; prompt generation, response parsing, streaming, capability
negotiation and the EXPRESS format throw `UnimplementedError`.

The tests describe the intended behaviour of everything that is still stubbed
and are marked `skip:` with the reason, so `dart test` doubles as the
implementation checklist.

## Architecture

| Layer   | Type                                                        | Role                                               |
| ------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Facade  | `A2uiGenerator`                                             | Long-lived, holds every catalog the agent supports |
| Facade  | `A2uiRequestProcessor`                                      | Per request, bound to one renderer's capabilities  |
| Catalog | `CatalogConfig`, `CatalogProvider`                          | Load a catalog and attach its transformers         |
| Catalog | `ComponentPruningTransformer`, `FunctionPruningTransformer` | Narrow a catalog to an allowlist                   |
| Format  | `InferenceFormat`, `InferenceFormatFactory`                 | Pair a prompt generator with a parser              |
| Format  | `DirectJsonFormat`, `ExpressFormat`                         | The concrete wire formats                          |
| Output  | `Parser`, `TextPart`, `A2uiPart`                            | Tokenize, compile and validate model output        |

Protocol models, catalogs, renderer capabilities and payload validation live in
[`a2ui_core`](https://github.com/a2ui-project/a2ui/tree/main/dart/a2ui_core),
which both agents and renderers depend on.

## Usage

```dart
// Once, at agent startup.
final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
  catalogs: [
    CatalogConfig.fromPath(
      'specification/v0_9_1/catalogs/basic/catalog.json',
      transformers: [
        ComponentPruningTransformer(['Card', 'Column', 'Text', 'Button']),
      ],
    ),
  ],
);

// Per request, against the renderer's declared capabilities.
final processor = generator.createProcessor(rendererCapabilities);
final output = await callYourModel(processor.promptSnippet);

for (final part in processor.parseResponse(output)) {
  switch (part) {
    case TextPart(:final text):
      sendTextToUser(text);
    case A2uiPart(:final a2ui):
      sendA2uiToRenderer(a2ui);
    case ResponsePart():
      break;
  }
}
```

See [`example/a2ui_agent_example.dart`](example/a2ui_agent_example.dart) for the
full walkthrough.

## Testing

```sh
dart test
```

Behavioural tests are driven by the shared datasets in
[`conformance/`](https://github.com/a2ui-project/a2ui/tree/main/conformance) and
run against the published
[basic catalog schema](https://github.com/a2ui-project/a2ui/tree/main/specification/v0_9_1/catalogs/basic),
not a catalog implemented inside this package, so every A2UI SDK is measured
against the same contract.

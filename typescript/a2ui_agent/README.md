# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets A2UI protocol **v0.9** and **v1.0**, and supports the **Direct JSON** and **Express** inference formats.

## Getting started

Load your catalogs once at startup and create an `A2uiGenerator`. On each turn, create a request processor for the client's capabilities, include its `promptSnippet` in your system prompt, and pass the model's response to `parseResponse`:

```ts
import {
  A2uiGenerator,
  CatalogConfig,
  ExpressFormatFactory,
  type RendererCapabilities,
} from '@a2ui/agent';

// 1. Load catalogs and build the generator once at startup.
const componentCatalog = await CatalogConfig.fromPath('path/to/catalog.json');
const generator = new A2uiGenerator(
  [componentCatalog],
  undefined,
  // Omit to use DirectJsonFormatFactory by default, or pass ExpressFormatFactory:
  new ExpressFormatFactory(),
);

// 2. Per request, negotiate active catalogs for the client's capabilities.
const capabilities: RendererCapabilities = {
  v1_0: {supportedCatalogIds: [componentCatalog.catalog.id]},
};
const processor = generator.createProcessor(capabilities);

// 3. Append processor.promptSnippet to your LLM system prompt, then parse the reply.
const systemPrompt = `You are a helpful assistant.\n\n${processor.promptSnippet}`;
const llmResponse = await callYourModel(systemPrompt, userMessage);

for (const part of processor.parseResponse(llmResponse)) {
  if (part.type === 'text') {
    console.log('Text:', part.content);
  } else {
    // Validated AgentToRendererMessage[] ready to send to the renderer
    console.log('A2UI messages:', part.content);
  }
}
```

## Loading catalogs

The SDK bundles no catalogs. Load catalog JSON documents with `CatalogConfig.fromPath` or `FileSystemCatalogProvider`, or pass an existing object to `InMemoryCatalogProvider`.

The emitted protocol version is taken from the catalog. Because the v0.9 basic catalog JSON document omits both `protocolVersion` and `catalogId`, pass them explicitly when loading it:

```ts
const v09Catalog = await CatalogConfig.fromPath(
  'specification/v0_9/json/basic_catalog.json',
  [],
  'v0.9',
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
);
```

## Development

```sh
yarn workspace @a2ui/agent test
yarn workspace @a2ui/agent lint
yarn workspace @a2ui/agent format
```

Architecture, design decisions, and parser regeneration instructions live in the [codebase blueprint](../../blueprints/codebases/typescript/a2ui_agent/codebase.blueprint.md).

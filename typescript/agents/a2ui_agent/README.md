# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets A2UI protocol **v0.9** and **v1.0**, and supports the **Direct JSON** and **Express** inference formats.

## Getting started

Load your catalogs once at startup and create an `A2uiGenerator`. On each turn, create a request processor for the client's capabilities, include its `promptSnippet` in your system prompt, and pass the model's response to `parseResponse`:

```ts
import {A2uiGenerator, CatalogConfig, type RendererCapabilities} from '@a2ui/agent';

// 1. Load catalogs and build the generator once at startup.
const componentCatalog = CatalogConfig.fromPath('path/to/catalog.json');
const generator = new A2uiGenerator([componentCatalog]);

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
    console.log('Text:', part.text);
  } else {
    // Validated AgentToRendererMessage[] ready to send to the renderer
    console.log('A2UI messages:', part.a2ui);
  }
}
```

`parseResponse` throws an `A2uiError` when a block cannot be read or a renderer would reject a message. The error's `partialResults` holds the parts before the failing block, or only the text when the tree check across every block fails. None of them is applied to the state.

## Chat and canvas

Every response is checked against a `RendererState`, the agent's record of the surfaces one renderer holds. How long the state lives decides what a response may refer to:

1. In a chat, each turn shows new UI. Pass no state, and each call checks the response against a new, empty one, so an update to a surface the response did not create is rejected.
2. In a canvas, turns update the surfaces earlier turns created. Create one state per conversation and pass it on every turn, or bind it to the processor:

```ts
const state = processor.createState();
processor.parseResponse(firstReply, {state});
// A later turn may refer to the components the first turn sent.
processor.parseResponse(secondReply, {state});

// Or bind the state, so that calls use it by default:
const canvas = generator.createProcessor(capabilities, undefined, {state});
canvas.parseResponse(thirdReply);
```

A response parsed whole is applied to the state all or nothing. To check one payload with no record of earlier ones, such as the argument of a tool call, use `validatePayload(catalogs, messages)`.

## Streaming

Direct JSON responses can be read as they arrive. `openStream` returns a `ResponseStream` for one response: pass each chunk to `feed` and call `close` after the last one. Each message the stream emits has been checked and applied to the state, so a canvas state matches what the client received even when a response fails part way.

```ts
const stream = processor.openStream({state});
for await (const chunk of modelStream) {
  for (const part of stream.feed(chunk)) send(part);
}
for (const part of stream.close()) send(part);
```

`close` emits text that was held back because it could have started a tag, throws a `ParseError` if a block is still open, and checks the tree of a response read with `wrapped: false`. A stream that throws has ended. The error's `partialResults` holds the parts the chunk made ready before the failure, which have been applied to the state, so send them too. Express responses are read whole.

By default the first rejected block ends the stream. To show the rest of the response, open the stream with `afterRejectedBlock: 'continue'`. `feed` and `close` then return an `ErrorPart` in place of a rejected block and go on with the text and blocks after it. The messages the block emitted before it was rejected stay in the state.

```ts
const stream = processor.openStream({afterRejectedBlock: 'continue'});
for (const part of stream.feed(chunk)) {
  if (part.type === 'error') showError(part.error);
  else send(part);
}
```

`stream.isInBlock` tells whether the response read so far ends inside a block. A client that joins the chunks of a paused and resumed response reads it before adding a space between them, since a space inside a block could break it.

### An app that is both agent and renderer

An app that calls the model and renders its answer itself, such as a chat in the browser, checks and renders each message once by giving the stream a state on the processor it renders from:

```ts
import {MessageProcessor} from '@a2ui/web_core';

const renderer = new MessageProcessor([catalog], onAction);
const stream = processor.openStream({state: RendererState.of(renderer)});
stream.feed(chunk); // the surfaces show up in renderer.model
```

`StreamedAnswer` does this for one answer and keeps its parts in the order the model wrote them: its text, a part for each surface it creates, and an `ErrorPart` where it rejected a block, followed by the text and surfaces after it.

```ts
const answer = new StreamedAnswer(processor, {renderer: new MessageProcessor([catalog], onAction)});
answer.feed(chunk);
answer.close();
answer.parts; // text, surfaces and errors, in order
```

## Loading catalogs

The SDK bundles no catalogs. Load catalog JSON documents with `CatalogConfig.fromPath` or `FileSystemCatalogProvider`, or pass an existing object to `InMemoryCatalogProvider`.

The emitted protocol version is taken from the catalog. Because the v0.9 basic catalog JSON document omits both `protocolVersion` and `catalogId`, pass them explicitly when loading it:

```ts
const v09Catalog = CatalogConfig.fromPath(
  'specification/v0_9/catalogs/basic/catalog.json',
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

The timing suites of the conformance tests, `conformance/agent/direct_json/scaling.yaml` and `conformance/agent/express/scaling.yaml`, check that parsing and streaming a response take time in proportion to its size. Times depend on the machine, so `test` leaves them out. Run them on their own:

```sh
yarn workspace @a2ui/agent test:timing
```

Architecture, design decisions, and parser regeneration instructions live in the [codebase blueprint](../../../blueprints/codebases/typescript/agents/a2ui_agent/codebase.blueprint.md).

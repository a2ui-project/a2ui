# @a2ui/agent

A2UI Agent SDK for TypeScript and Node.js.

This package targets A2UI protocol **v0.9** and **v1.0**, and supports the **Direct JSON** and **Express** inference formats.

## Getting started

Load your catalogs once at startup and create an `A2uiGenerator`. On each turn, create a request processor for the client's capabilities, include its `promptSnippet` in your system prompt, and pass the model's response to `parseResponse`:

```ts
import {A2uiGenerator, CatalogConfig, readRendererCapabilities} from '@a2ui/agent';

// 1. Load catalogs and build the generator once at startup.
const componentCatalog = CatalogConfig.fromPath('path/to/catalog.json');
const generator = new A2uiGenerator([componentCatalog]);

// 2. Per request, extract client capabilities from transport metadata.
const capabilities = readRendererCapabilities(requestMetadata);
if (!capabilities) {
  // Client did not request A2UI on this turn; reply with plain text.
  return;
}
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

Both Express and Direct JSON responses can be read as they arrive. `openStream` returns a `ResponseStream` for one response: pass each chunk to `feed` and call `close` after the last one. Each message the stream emits has been checked and applied to the state, so a canvas state matches what the client received even when a response fails part way.

```ts
const stream = processor.openStream({state});
for await (const chunk of modelStream) {
  for (const part of stream.feed(chunk)) send(part);
}
for (const part of stream.close()) send(part);
```

`close` emits text that was held back because it could have started a tag, throws a `ParseError` if a block is still open, and checks the tree of a response read with `wrapped: false`. A stream that throws has ended. The error's `partialResults` holds the parts the chunk made ready before the failure, which have been applied to the state, so send them too.

By default the first rejected block ends the stream. To show the rest of the response, open the stream with `afterRejectedBlock: 'continue'`. `feed` and `close` then return an `ErrorPart` in place of a rejected block and go on with the text and blocks after it. The messages the block emitted before it was rejected stay in the state.

```ts
const stream = processor.openStream({afterRejectedBlock: 'continue'});
for (const part of stream.feed(chunk)) {
  if (part.type === 'error') showError(part.error);
  else send(part);
}
```

`stream.isInBlock` tells whether the response read so far ends inside a block. A client that joins the chunks of a paused and resumed response reads it before adding a space between them, since a space inside a block could break it.

In `wrapped: true` mode, `openStream` strips Markdown code fences and inline backticks placed either inside or immediately outside `<a2ui>` and `</a2ui>` tags, checks surface topology as each `<a2ui>` block closes (unlike `parseResponse`, which checks topology across all blocks at the end of the response), and requires the opening `<a2ui>` tag rather than recovering a block whose opening tag was omitted.

### An app that is both agent and renderer

An app that calls the model and renders its answer itself, such as a chat in the browser, checks and renders each message once by giving the stream a state on the processor it renders from:

```ts
import {MessageProcessor} from '@a2ui/web_core';

const renderer = new MessageProcessor([catalog], undefined, {
  outboundListener: message => {
    if (!('error' in message)) sendToAgent(message);
  },
  unifiedOutbound: true,
});
const stream = processor.openStream({state: RendererState.of(renderer)});
stream.feed(chunk); // the surfaces show up in renderer.model
```

`StreamedAnswer` does this for one answer and keeps its parts in the order the model wrote them: its text, a part for each surface it creates, and an `ErrorPart` where it rejected a block, followed by the text and surfaces after it.

```ts
const answer = new StreamedAnswer(processor, {
  renderer: new MessageProcessor([catalog], undefined, {
    outboundListener: message => {
      if (!('error' in message)) sendToAgent(message);
    },
    unifiedOutbound: true,
  }),
});
answer.feed(chunk);
answer.close();
answer.parts; // text, surfaces and errors, in order
```

## Loading catalogs

The SDK bundles no catalogs. Load catalog JSON documents with `CatalogConfig.fromPath` or `FileSystemCatalogProvider`, or pass an existing object to `InMemoryCatalogProvider`.

The emitted protocol version is taken from the catalog. Because the v0.9 basic catalog JSON document omits both `protocolVersion` and `catalogId`, pass them explicitly when loading it:

```ts
const v09Catalog = CatalogConfig.fromPath(
  'catalogs/basic/v0_9/catalog.json',
  [],
  'v0.9',
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
);
```

## Agent functions

From v1.0, a catalog can declare functions that run on the agent: a renderer that doesn't implement a function sends `callAgentFunction` and waits for the agent's `agentFunctionResponse`. Add agent functions to your copy of a catalog with `copyWith`. `AgentFunction.fromApi` binds a handler to a function the catalog already declares, and `new AgentFunction(...)` adds a new one, with its arguments as a Zod schema (which types the handler) or a JSON Schema object. A v1.0 catalog checks that the parameter names are UAX #31 identifiers when it gets the function. A handler takes `(args)` or `(args, context)`, where `context` has the catalog, surface and call IDs. `withHandler` returns a copy bound to another handler, such as a test double.

```ts
import {AgentFunction} from '@a2ui/agent';
import {z} from 'zod';

const catalog = loaded.copyWith({
  agentFunctions: [
    AgentFunction.fromApi<{id: string}>(loaded.functions.get('lookupAccount')!, args =>
      findAccount(args.id),
    ),
    new AgentFunction({
      name: 'fetchFxRate',
      returnType: 'number',
      schema: z.object({base: z.string()}),
      // `base` is a string, and the handler must return a number.
      handler: async ({base}) => fetchRate(base),
    }),
  ],
});
```

`RendererToAgentMessageProcessor` takes each message the renderer sends and returns whether it handled it and the messages to send back. It answers `callAgentFunction` itself, and passes `action`, `error` and `rendererFunctionResponse` messages to their callback, after checking them against the v1.0 schema. A message whose callback isn't set, or whose callback returns `false` to decline it, comes back with `handled: false`, so the app can pass it on to the model.

```ts
const messages = new RendererToAgentMessageProcessor({
  catalogs: [catalog],
  agentFunctionTimeoutMs: 10_000,
  onError: message => log.warn(message.error),
  // Handle the button that saves locally; let the model answer the others.
  onAction: message => (message.action.name === 'save' ? save(message) : false),
});

for (const fromRenderer of request.messages) {
  const {handled, replies} = await messages.processMessage(fromRenderer);
  for (const reply of replies) send(reply);
  if (!handled) runModelTurn(fromRenderer);
}
```

The processor handles one message per call, so the app decides whether to process a request's messages one after another or concurrently, and what to do when one of them fails. A message whose `version` isn't `'1.0'` is an `A2uiValidationError`. The processor keeps no state between messages, so build one per agent, or one per request from the catalogs the request uses. Two catalogs with the same id are an `A2uiCatalogError`.

### Calling renderer functions

An agent calls a function the renderer implements with `callRendererFunction`. `RendererFunctionCalls` builds the message and gives a promise of the result, which `resolve` settles when the `rendererFunctionResponse` arrives. Pass `resolve` to the processor as `onRendererFunctionResponse`. It returns `false` for a response to a call it isn't waiting for, such as one the model wrote, so the processor leaves that response unhandled for the model:

```ts
const calls = new RendererFunctionCalls({defaultTimeoutMs: 10_000});
const messages = new RendererToAgentMessageProcessor({
  catalogs: [catalog],
  onRendererFunctionResponse: calls.resolve,
});

const [message, locale] = calls.call<string>({catalogId: catalog.id, name: 'getLocale'});
send(message);
console.log(await locale); // once the renderer's response has gone through messages.processMessage
```

Pass the catalogs the renderer was sent as `catalogs`, and `call` checks each call against them before anything is sent: a catalog the catalogs don't have, or a function that isn't one of its `rendererFunctions` (an agent function runs on the agent, not the renderer), is an `A2uiRpcError` with `UNKNOWN_FUNCTION`, and a function the agent may not call (its `allowedCallers` is `rendererOnly` or omitted, or it requires user activation, which a call from the agent can't give) is one with `INVALID_FUNCTION_CALL`. The arguments aren't checked against the function's schema.

```ts
const calls = new RendererFunctionCalls({catalogs: [catalog]});
```

Each instance keeps its pending calls in memory, so a response must reach the same instance that made the call, over a connection that stays open such as a WebSocket. A call fails with `TIMEOUT` when no response arrives in time: after `defaultTimeoutMs` (30 seconds unless set), or the call's own `timeoutMs`, a finite number greater than 0. With `defaultTimeoutMs: null`, calls without their own `timeoutMs` never time out.

`call` throws before anything is sent or becomes pending when the call can't be made: a `RangeError` for a bad `timeoutMs`, and otherwise an `A2uiRpcError` with `INVALID_FUNCTION_CALL` (or `DISPOSED`, `DUPLICATE`, `TOO_MANY_PENDING`). The `name` must be a UAX #31 identifier that doesn't start with `@`, and `args` a plain object whose keys are UAX #31 identifiers and whose values are JSON values (no `NaN`, `Infinity`, `undefined`, functions or class instances). Nested `@call` and `@path` objects are sent as they are, for the renderer to check. The arguments are checked before the catalogs.

A call fails with `CANCELLED` when it is cancelled or the instance disposed, and with the renderer's error code when the renderer reports one.

## Macros

A macro is a component the model can use that the agent lowers to catalog components before the messages reach the renderer, so the renderer needs only the catalogs it already has. Macros target v1.0.

Define a macro with `defineMacro`. Its parameters come from `param`, which has the parameter types of the shared macro conformance suite, and `render` returns a tree of nested component objects:

```ts
import {defineMacro, param} from '@a2ui/agent';

const FlightCard = defineMacro({
  name: 'FlightCard',
  description: 'A card with one flight.',
  parameters: {
    from: param.string({description: 'Departure city'}),
    to: param.string({description: 'Destination city'}),
    status: param.string({enum: ['onTime', 'delayed'], default: 'onTime'}),
    onBook: param.action({required: false}),
  },
  render: ({from, to, status, onBook}) => ({
    component: 'Card',
    child: {
      component: 'Column',
      children: [
        {component: 'Text', text: `${from} to ${to}`},
        {component: 'Text', text: status === 'delayed' ? 'Delayed' : 'On time', variant: 'caption'},
        ...(onBook
          ? [{component: 'Button', child: {component: 'Text', text: 'Book'}, action: onBook}]
          : []),
      ],
    },
  }),
});
```

The arguments of `render` are typed from the parameters: `from` and `to` are strings, `status` is `'onTime' | 'delayed'`, and `onBook` is an `Action` or `undefined`. Before `render` runs, the expander checks each argument against its parameter and turns the shorthands a model writes into full values, such as an event name into `{event: {name}}`.

The nested components need no IDs. When an invocation is lowered, the root of its tree takes the invocation's ID and the other components get IDs under it, such as `flight_1__text_1`, so a macro can be used more than once on a surface. A slot can also hold the ID of a component already on the surface. For trees built without macros, `flattenComponentTree` does this flattening on its own.

Add the macros to the catalog the model sees, and lower each response before you send it:

```ts
import {A2uiGenerator, CatalogConfig, MacroExpander} from '@a2ui/agent';

const expander = new MacroExpander([FlightCard], {onError: 'raise'});
const generator = new A2uiGenerator([
  new CatalogConfig(expander.transformToInferenceCatalog(basicCatalog)),
]);

const processor = generator.createProcessor(capabilities);
for (const part of processor.parseResponse(llmResponse)) {
  if (part.type === 'a2ui') send(expander.transformToTransport(part.a2ui));
}
```

`transformToInferenceCatalog` adds the macros to a copy of one catalog that keeps its ID, so it still matches the catalog the client supports. For a surface that mixes catalogs, use `transformCatalogs`, which returns the base catalogs followed by a standalone catalog of the macros. The expander then decides by `@catalogId` which components are macros, and stamps the owning `@catalogId` on lowered components where the surface needs it. `passthroughComponents` limits the catalog components the model sees next to the macros.

A few things to keep in mind:

1. With `onError: 'raise'`, an invocation that doesn't match its macro throws an `A2uiValidationError` that an agent can hand back to the model. By default the expander logs it and leaves the invocation unexpanded.
2. The response is checked against the catalog with the macros, so a `RendererState` holds the macro invocations, not their lowered components.
3. The expander remembers the default catalog of the surfaces it sees created. Use one expander per session, or pass `surfaceCatalogs` to `transformToTransport`.
4. A macro's `render` can call another macro's `render` to inline its tree, or use another macro by name in its tree, which the expander lowers too.

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

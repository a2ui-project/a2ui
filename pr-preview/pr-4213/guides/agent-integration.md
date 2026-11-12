# How to Integrate A2UI into an Agent

> Step-by-step guide to integrating A2UI UI generation into TypeScript, Python, and Dart agents.

Canonical URL: https://a2ui.org/guides/agent-integration/

Integrate A2UI into an [agent](/concepts/glossary/#agent) using the [Agent SDKs](/concepts/sdks/#agent-sdk) to stream validated interactive [surfaces](/concepts/glossary/#surface) to clients and respond to user actions across turns.

For the client side, see [How to Integrate A2UI into a Client](/guides/client-integration/). If your agent and renderer live in the same binary or codebase, combine both guides, skip the transport step, and pass messages directly from agent output into the rendering pipeline (the Agent and Renderer SDKs share the same [Core SDK](/concepts/sdks/#core-sdk) data structures). To register custom widgets beyond the built-in [Basic catalog](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json), see [How to Define a Catalog](/guides/defining-a-catalog/), and for trade-offs between inference formats see [Inference Formats](/concepts/inference-formats/). Agent SDKs are available for TypeScript, Python, and Dart, while Swift and Kotlin target client-side rendering (see [SDKs](/concepts/sdks/#agent-sdk)).

---

## Step 1: Install dependencies

Install the Agent SDK and Core SDK packages for your language:

#### TypeScript

```bash
npm install @a2ui/agent @a2ui/web_core
```

#### Python

```bash
pip install a2ui-agent-sdk
```

#### Dart

```bash
dart pub add a2ui_agent a2ui_core
```

---

## Step 2: Initialize the A2UI generator

Create a shared [generator](/concepts/glossary/#a2uigenerator) configured with your component [catalogs](/concepts/glossary/#catalog), your chosen [inference format](/concepts/inference-formats/), and a session map to track active surface state across turns.

The steps below use an illustrative `OrderAgentService` class representing your application's own domain service rather than an A2UI SDK class. Register the built-in `v1.0` [Basic catalog](/specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json) (and any [custom domain catalogs](/guides/defining-a-catalog/)) at startup, and inject a model-streaming callback so the service stays decoupled from any specific LLM client or transport. The generator also configures the inference format: Express (`ExpressFormatFactory`) is the default, instructing the model to emit compact `<a2ui>` blocks that compile into validated A2UI messages, and can be swapped for other formats such as Direct JSON (see [Inference Formats](/concepts/inference-formats/)):

#### TypeScript

```typescript
import {
  A2uiGenerator,
  type AgentToRendererMessage,
  CatalogConfig,
  ExpressFormatFactory,
  RendererState,
  type RendererToAgentMessage,
  RendererToAgentMessageProcessor,
} from '@a2ui/agent';
import {basicCatalog} from '@a2ui/web_core/v1_0';

export type ModelStreamFn = (
  sessionId: string,
  systemPrompt: string,
  userMessage: string,
) => AsyncIterable<string>;

export class OrderAgentService {
  readonly catalogs = [
    basicCatalog,
    // Add custom domain catalogs here (see /guides/defining-a-catalog/).
  ];
  readonly generator = new A2uiGenerator(
    this.catalogs.map(catalog => new CatalogConfig(catalog)),
    undefined, // Optional few-shot examples in A2UI JSON (decompiled into the active format).
    new ExpressFormatFactory(), // Default; swap to change inference format.
  );
  private readonly sessions = new Map<string, RendererState>();

  constructor(private readonly callModel: ModelStreamFn) {}
}
```

#### Python

```python
from __future__ import annotations

from collections.abc import AsyncIterable, Callable
import json
import logging

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats import ExpressFormatFactory
from a2ui.parser import A2uiPart
from a2ui.processor import A2uiGenerator, CatalogConfig
from a2ui.rpc import (
    A2uiRendererActionMessage,
    RendererToAgentMessageInput,
    RendererToAgentMessageProcessor,
)
from a2ui.utils import RendererState

logger = logging.getLogger(__name__)
ModelStreamFn = Callable[[str, str, str], AsyncIterable[str]]

class OrderAgentService:

  def __init__(self, call_model: ModelStreamFn) -> None:
    self._call_model = call_model
    self.catalogs = [
        BasicCatalog(ProtocolVersion.V1_0),
        # Add custom domain catalogs here (see /guides/defining-a-catalog/).
    ]
    self.generator = A2uiGenerator(
        catalogs=[CatalogConfig(catalog=c) for c in self.catalogs],
        inference_format_factory=ExpressFormatFactory(),  # Default; swap to change inference format.
    )
    self.sessions: dict[str, RendererState] = {}
```

#### Dart

```dart
import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

typedef ModelStreamFn = Stream<String> Function(
  String sessionId,
  String systemPrompt,
  String userMessage,
);

class OrderAgentService {
  OrderAgentService(this._callModel);

  final ModelStreamFn _callModel;
  final List<CatalogApi> catalogs = [
    BasicCatalog.v1_0(),
    // Add custom domain catalogs here (see /guides/defining-a-catalog/).
  ];
  late final A2uiGenerator generator = A2uiGenerator(
    catalogs: [for (final catalog in catalogs) CatalogConfig(catalog)],
    inferenceFormatFactory:
        const ExpressFormatFactory(), // Default; swap to change inference format.
  );
  final Map<String, RendererState> _sessions = {};
}
```

---

## Step 3: Build the system prompt and stream A2UI messages

On each conversation turn, generate the A2UI system prompt instructions for the session and stream the language model's token output through a request processor to emit validated A2UI messages.

Look up or initialize the session's renderer state, create a request processor for your registered catalogs (or [negotiate client capabilities](#negotiate-client-capabilities) per request when serving external clients) bound to that state, and append its generated prompt snippet to your agent's role instructions. When reusing session state across turns, instruct the model to pass `update=true` (`surface("id", update=true)`) when modifying an existing surface so follow-up turns update the active surface in place rather than attempting to recreate it. If each chat turn creates an independent surface instead, omit the session state so every response validates from an empty state.

As tokens arrive from the language model, feed each chunk into the processor's stream and close the stream when generation finishes. Stream parts carry either conversational prose (`text` parts, omitted in the UI-only generator below) or A2UI payloads: the stream reader closes partial string properties such as `text` incrementally as tokens arrive, updates the session state, and yields Core SDK `AgentToRendererMessage` structures ([`createSurface`](/concepts/messages/#createsurface), [`updateComponents`](/concepts/messages/#updatecomponents), [`updateDataModel`](/concepts/messages/#updatedatamodel), and [`deleteSurface`](/concepts/messages/#deletesurface)) as soon as they are ready:

#### TypeScript

```typescript
async *runTurn(
  sessionId: string,
  userMessage: string,
): AsyncGenerator<AgentToRendererMessage> {
  let state = this.sessions.get(sessionId);
  if (!state) {
    state = new RendererState(this.catalogs);
    this.sessions.set(sessionId, state);
  }

  const processor = this.generator.createProcessor(
    // Synthesize rendererCapabilities from registered catalogs (see #negotiate-client-capabilities for external clients):
    {'1.0': {supportedCatalogIds: this.catalogs.map(c => c.id)}},
    undefined, // Optional per-turn inferenceFormatFactory override.
    {state},
  );
  const systemPrompt = [
    'You are an order assistant. Show order details in an interactive card.',
    'Give each new surface a unique surfaceId, or call surface("id", update=true) when updating an existing surface.',
    processor.promptSnippet,
  ].join('\n\n');

  const stream = processor.openStream();
  for await (const chunk of this.callModel(sessionId, systemPrompt, userMessage)) {
    for (const part of stream.feed(chunk)) {
      if (part.type === 'a2ui') {
        yield* part.a2ui;
      }
    }
  }
  for (const part of stream.close()) {
    if (part.type === 'a2ui') {
      yield* part.a2ui;
    }
  }
}
```

#### Python

```python
async def run_turn(
    self, session_id: str, user_message: str
) -> AsyncIterable[AgentToRendererMessage]:
  state = self.sessions.get(session_id)
  if state is None:
    state = RendererState(self.catalogs)
    self.sessions[session_id] = state

  processor = self.generator.create_processor(
      {"1.0": {"supportedCatalogIds": [c.catalog_id for c in self.catalogs]}},
      state=state,
  )
  system_prompt = (
      "You are an order assistant. Show order details in an interactive card.\n"
      'Give each new surface a unique surfaceId, or call surface("id", update=true) '
      "when updating an existing surface.\n\n"
      f"{processor.prompt_snippet}"
  )

  stream = processor.open_stream()
  async for chunk in self._call_model(session_id, system_prompt, user_message):
    for part in stream.feed(chunk):
      if isinstance(part, A2uiPart):
        for message in part.a2ui:
          yield message
  for part in stream.close():
    if isinstance(part, A2uiPart):
      for message in part.a2ui:
        yield message
```

#### Dart

```dart
Stream<AgentToRendererMessage> runTurn(
  String sessionId,
  String userMessage,
) async* {
  final state = _sessions.putIfAbsent(
    sessionId,
    () => RendererState(catalogs),
  );

  final processor = generator.createProcessor(
    A2uiRendererCapabilities.forCatalogIds(
      [for (final catalog in catalogs) catalog.id],
      version: A2uiProtocolVersion.v1_0,
    ),
    state: state,
  );
  final systemPrompt =
      'You are an order assistant. Show order details in an interactive card.\n'
      'Give each new surface a unique surfaceId, or call surface("id", update=true) '
      'when updating an existing surface.\n\n'
      '${processor.promptSnippet}';

  final stream = processor.openStream();
  await for (final chunk in _callModel(sessionId, systemPrompt, userMessage)) {
    for (final part in stream.feed(chunk)) {
      if (part is A2uiPart) {
        yield* Stream.fromIterable(part.a2ui);
      }
    }
  }
  for (final part in stream.close()) {
    if (part is A2uiPart) {
      yield* Stream.fromIterable(part.a2ui);
    }
  }
}
```

<details>
<summary>Wire format: outbound agent-to-renderer messages</summary>

The stream compiles the model's output into standard A2UI wire messages (`agent_to_renderer.json` in `v1.0`, `server_to_client.json` in `v0.9.1`). In `v1.0`, `createSurface` embeds initial `components` and `dataModel` directly and binds dynamic values with `{"@path": "..."}`, whereas `v0.9.1` sends separate `updateComponents` and `updateDataModel` envelopes and binds paths with `{"path": "..."}`:

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'agent_to_renderer.json',
      href: '/specification/v1.0/schemas/#agent_to_renderer.json',
      title: 'v1.0 Agent-to-Renderer Message Schema',
    },
    {
      version: 'v0.9.1',
      label: 'server_to_client.json',
      href: '/specification/v0.9.1/schemas/#server_to_client.json',
      title: 'v0.9.1 Server-to-Client Message Schema',
    },
  ]}
/>

#### v1.0

```json
[
  {
    "version": "1.0",
    "createSurface": {
      "surfaceId": "order_summary",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["headline", "confirm_btn"]},
        {"id": "headline", "component": "Text", "text": {"@path": "/summaryText"}},
        {
          "id": "confirm_btn",
          "component": "Button",
          "child": "confirm_label",
          "action": {
            "event": {"name": "confirm_order", "context": {"orderId": {"@path": "/orderId"}}}
          }
        },
        {"id": "confirm_label", "component": "Text", "text": "Confirm order"}
      ],
      "dataModel": {
        "orderId": "ORD-4821",
        "summaryText": "2 items ready for pickup"
      }
    }
  }
]
```

#### v0.9.1

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "order_summary",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "order_summary",
      "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["headline", "confirm_btn"]},
        {"id": "headline", "component": "Text", "text": {"path": "/summaryText"}},
        {
          "id": "confirm_btn",
          "component": "Button",
          "child": "confirm_label",
          "action": {
            "event": {"name": "confirm_order", "context": {"orderId": {"path": "/orderId"}}}
          }
        },
        {"id": "confirm_label", "component": "Text", "text": "Confirm order"}
      ]
    }
  },
  {
    "version": "v0.9",
    "updateDataModel": {
      "surfaceId": "order_summary",
      "path": "/",
      "value": {"orderId": "ORD-4821", "summaryText": "2 items ready for pickup"}
    }
  }
]
```

</details>

---

## Step 4: Process messages from the renderer

Handle incoming A2UI messages from the client renderer with `RendererToAgentMessageProcessor`, prompting the model on user actions and handling other messages with deterministic logic.

Separate plain text inputs from A2UI [`renderer_to_agent`](/concepts/messages/#renderer-to-agent-messages) messages at your transport boundary: text messages always prompt the model directly through your turn runner, whereas A2UI messages go through your renderer message handler. Register an action callback on `RendererToAgentMessageProcessor` that forwards [`action`](/concepts/messages/#action) events to the turn runner, while deterministic logic handles [`callAgentFunction`](/concepts/messages/#callagentfunction-v10-only) RPCs (see [Register agent-hosted functions](#register-agent-hosted-functions)) and client [`error`](/specification/v1.0/schemas/#renderer_to_agent.json/properties/error) reports:

#### TypeScript

```typescript
async *handleRendererMessage(
  sessionId: string,
  message: RendererToAgentMessage | Record<string, unknown>,
): AsyncGenerator<AgentToRendererMessage> {
  let modelTurn: AsyncIterable<AgentToRendererMessage> | undefined;
  const processor = new RendererToAgentMessageProcessor({
    catalogs: this.catalogs,
    onAction: actionMessage => {
      modelTurn = this.runTurn(sessionId, JSON.stringify(actionMessage));
    },
    onError: errorMessage => {
      console.error('Renderer error:', errorMessage.error);
    },
  });

  const result = await processor.processMessage(message);
  yield* result.replies;
  if (modelTurn) {
    yield* modelTurn;
  }
}
```

#### Python

```python
async def handle_renderer_message(
    self, session_id: str, message: RendererToAgentMessageInput
) -> AsyncIterable[AgentToRendererMessage]:
  model_turn: AsyncIterable[AgentToRendererMessage] | None = None

  def on_action(action_message: A2uiRendererActionMessage) -> None:
    nonlocal model_turn
    payload = action_message.model_dump(by_alias=True, exclude_unset=True)
    model_turn = self.run_turn(session_id, json.dumps(payload))

  processor = RendererToAgentMessageProcessor(
      self.catalogs,
      on_action=on_action,
      on_error=lambda err: logger.error("Renderer error: %s", err.error),
  )
  result = await processor.process_message(message)
  for reply in result.replies:
    yield reply
  if model_turn is not None:
    async for update in model_turn:
      yield update
```

#### Dart

```dart
Stream<AgentToRendererMessage> handleRendererMessage(
  String sessionId,
  Object message,
) async* {
  Stream<AgentToRendererMessage>? modelTurn;
  final processor = RendererToAgentMessageProcessor(
    catalogs: catalogs,
    onAction: (actionMessage) {
      modelTurn = runTurn(sessionId, jsonEncode(actionMessage.toJson()));
    },
    onError: (errorMessage) {
      stderr.writeln('Renderer error: ${errorMessage.error.message}');
    },
  );

  final result = await processor.processMessage(message);
  yield* Stream.fromIterable(result.replies);
  if (modelTurn case final turn?) {
    yield* turn;
  }
}
```

<details>
<summary>Wire format: inbound action message</summary>

When the user clicks **Confirm order**, the client resolves `context` bindings against its local [data model](/concepts/glossary/#data-model) and sends the `action` message below (`"version": "1.0"` in `v1.0`, `"version": "v0.9"` in `v0.9.1`). `RendererToAgentMessageProcessor` processes `v1.0` envelopes; agents serving `v0.9.1` clients pass the `action` payload directly to the turn runner:

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_to_agent.json',
      href: '/specification/v1.0/schemas/#renderer_to_agent.json',
      title: 'v1.0 Renderer-to-Agent Message Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_to_server.json',
      href: '/specification/v0.9.1/schemas/#client_to_server.json',
      title: 'v0.9.1 Client-to-Server Message Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "version": "1.0",
  "action": {
    "name": "confirm_order",
    "surfaceId": "order_summary",
    "sourceComponentId": "confirm_btn",
    "timestamp": "2026-05-01T18:30:00.000Z",
    "context": {
      "orderId": "ORD-4821"
    }
  }
}
```

#### v0.9.1

```json
{
  "version": "v0.9",
  "action": {
    "name": "confirm_order",
    "surfaceId": "order_summary",
    "sourceComponentId": "confirm_btn",
    "timestamp": "2026-05-01T18:30:00.000Z",
    "context": {
      "orderId": "ORD-4821"
    }
  }
}
```

</details>

---

## Step 5: Connect to a transport

Connect your agent service to the transport channel your application uses to exchange messages with clients, or pass messages directly to a local renderer when running in the same process.

A2UI is transport-agnostic: an agent can exchange JSON envelopes over Server-Sent Events (SSE), WebSockets, HTTP streaming responses, gRPC, or standardized agent protocols such as [AG-UI](#ag-ui-and-copilotkit), [A2A](#a2a-protocol), and [MCP](/guides/mcp-overview/) (covered in [Connect to agent frameworks and transports](#connect-to-agent-frameworks-and-transports)). Whichever transport you choose, separate plain text messages from A2UI messages: pass text prompts directly to your turn runner, pass A2UI envelopes to your renderer message handler, and serialize each emitted `AgentToRendererMessage` onto your outbound channel.

The example below wires `OrderAgentService` to a streaming LLM chat session per `sessionId` and exposes it over a minimal HTTP SSE endpoint (`POST /api/agent`):

#### TypeScript

```bash
npm install @google/genai
```

```typescript
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';

import {type Chat, GoogleGenAI} from '@google/genai';

import {OrderAgentService} from './order-agent.js';

interface AgentRequestBody {
  sessionId?: string;
  prompt?: string;
  message?: Record<string, unknown>;
}

async function readJson(req: IncomingMessage): Promise<AgentRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as AgentRequestBody;
}

// Example using @google/genai; substitute any streaming LLM SDK.
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const chats = new Map<string, Chat>();

async function* callModelStream(
  sessionId: string,
  systemPrompt: string,
  userMessage: string,
): AsyncGenerator<string> {
  let chat = chats.get(sessionId);
  if (!chat) {
    chat = ai.chats.create({model: 'gemini-2.5-flash'});
    chats.set(sessionId, chat);
  }
  const response = await chat.sendMessageStream({
    message: userMessage,
    config: {systemInstruction: systemPrompt},
  });
  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

const agentService = new OrderAgentService(callModelStream);

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST' || req.url !== '/api/agent') {
    res.writeHead(404).end();
    return;
  }

  try {
    const body = await readJson(req);
    const sessionId = body.sessionId ?? 'default';
    const events = body.message
      ? agentService.handleRendererMessage(sessionId, body.message)
      : agentService.runTurn(sessionId, body.prompt ?? 'Show my order summary');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for await (const msg of events) {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({error: String(err)}));
    }
  } finally {
    res.end();
  }
}).listen(8080);
```

#### Python

```bash
pip install fastapi uvicorn google-genai
```

```python
from __future__ import annotations

from collections.abc import AsyncIterable
import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from google.genai.chats import AsyncChat

from order_agent import OrderAgentService

# Example using google-genai; substitute any streaming LLM SDK.
ai = genai.Client()
chats: dict[str, AsyncChat] = {}

async def call_model_stream(
    session_id: str, system_prompt: str, user_message: str
) -> AsyncIterable[str]:
  chat = chats.get(session_id)
  if chat is None:
    chat = ai.aio.chats.create(model="gemini-2.5-flash")
    chats[session_id] = chat
  stream = await chat.send_message_stream(
      user_message,
      config=types.GenerateContentConfig(system_instruction=system_prompt),
  )
  async for chunk in stream:
    if chunk.text:
      yield chunk.text

app = FastAPI()
agent_service = OrderAgentService(call_model_stream)

# Run with: uvicorn server:app --port 8080
@app.post("/api/agent")
async def handle_agent(request: Request):
  body = await request.json()
  session_id = body.get("sessionId", "default")
  events = (
      agent_service.handle_renderer_message(session_id, body["message"])
      if body.get("message") is not None
      else agent_service.run_turn(
          session_id, body.get("prompt", "Show my order summary")
      )
  )

  async def event_stream() -> AsyncIterable[str]:
    async for msg in events:
      payload = msg.model_dump(by_alias=True, exclude_unset=True)
      yield f"data: {json.dumps(payload)}\n\n"

  return StreamingResponse(event_stream(), media_type="text/event-stream")
```

#### Dart

```bash
dart pub add dartantic_ai
```

```dart
import 'dart:convert';
import 'dart:io';

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;

import 'package:my_agent/order_agent.dart';

// Example using package:dartantic_ai; substitute any streaming LLM SDK.
final llm = dartantic.Agent.forProvider(
  dartantic.GoogleProvider(apiKey: Platform.environment['GEMINI_API_KEY']!),
  chatModelName: 'gemini-2.5-flash',
);
final histories = <String, List<dartantic.ChatMessage>>{};

Stream<String> callModelStream(
  String sessionId,
  String systemPrompt,
  String userMessage,
) async* {
  final history = histories.putIfAbsent(
    sessionId,
    () => [dartantic.ChatMessage.system(systemPrompt)],
  );
  history[0] = dartantic.ChatMessage.system(systemPrompt);
  final reply = StringBuffer();
  await for (final result in llm.sendStream(userMessage, history: history)) {
    if (result.output.isNotEmpty) {
      reply.write(result.output);
      yield result.output;
    }
  }
  history
    ..add(dartantic.ChatMessage.user(userMessage))
    ..add(dartantic.ChatMessage.model(reply.toString()));
}

Future<void> main() async {
  final agentService = OrderAgentService(callModelStream);
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 8080);

  server.listen((HttpRequest req) async {
    if (req.method != 'POST' || req.uri.path != '/api/agent') {
      req.response.statusCode = HttpStatus.notFound;
      await req.response.close();
      return;
    }

    try {
      final rawBody = await utf8.decoder.bind(req).join();
      final body = (jsonDecode(rawBody) as Map).cast<String, Object?>();
      final sessionId = (body['sessionId'] as String?) ?? 'default';
      final message = (body['message'] as Map?)?.cast<String, Object?>();
      final events = message != null
          ? agentService.handleRendererMessage(sessionId, message)
          : agentService.runTurn(
              sessionId,
              (body['prompt'] as String?) ?? 'Show my order summary',
            );

      req.response
        ..statusCode = HttpStatus.ok
        ..bufferOutput = false
        ..headers.set('Content-Type', 'text/event-stream')
        ..headers.set('Cache-Control', 'no-cache');

      await for (final msg in events) {
        req.response.write('data: ${jsonEncode(msg.toJson())}\n\n');
      }
    } catch (err) {
      if (req.response.headers.contentType == null) {
        req.response
          ..statusCode = HttpStatus.internalServerError
          ..write(jsonEncode({'error': '$err'}));
      }
    } finally {
      await req.response.close();
    }
  });
}
```

---

## Additional steps

### Negotiate client capabilities

Negotiate active catalogs per request when your agent serves external clients or multiple shipped app versions with different widget sets.

If your team owns both the agent and the client app, targeting your known catalogs directly as in [Step 3](#step-3-build-the-system-prompt-and-stream-a2ui-messages) avoids runtime capability plumbing. Otherwise, register every catalog your agent supports on the generator, read `metadata.a2uiRendererCapabilities` (or `metadata.a2uiClientCapabilities` for `v0.9.1` clients) on each request, and verify that the negotiated processor accepts the existing session state in case the caller's [catalogs](/concepts/catalogs/#catalog-negotiation-and-multi-catalog-surfaces) changed. In TypeScript and Python, all catalogs on a single generator must target the same protocol version, so maintain a separate `v0.9` generator when serving both `v1.0` and `v0.9.1` clients (Dart groups mixed-version catalogs automatically):

#### TypeScript

```typescript
// Add `type A2uiRequestProcessor` and `type RendererCapabilities` to the Step 2 import.
prepareNegotiatedTurn(
  sessionId: string,
  capabilitiesPayload?: Record<string, RendererCapabilities>,
): {processor: A2uiRequestProcessor; state: RendererState; systemPrompt: string} {
  const capabilities: Record<string, RendererCapabilities> = capabilitiesPayload ?? {
    '1.0': {supportedCatalogIds: this.catalogs.map(c => c.id)},
  };

  const probe = this.generator.createProcessor(capabilities);
  let state = this.sessions.get(sessionId);
  if (!state || !probe.acceptsState(state)) {
    state = probe.createState();
    this.sessions.set(sessionId, state);
  }

  const processor = this.generator.createProcessor(
    capabilities,
    undefined, // Optional per-turn inferenceFormatFactory override.
    {state},
  );
  const systemPrompt = [
    'You are an order assistant. Show order details in an interactive card.',
    'Give each new surface a unique surfaceId, or call surface("id", update=true) when updating an existing surface.',
    processor.promptSnippet,
  ].join('\n\n');

  return {processor, state, systemPrompt};
}
```

#### Python

```python
# Add `from typing import Any` and `A2uiRequestProcessor` (from `a2ui.processor`) to Step 2 imports.
def prepare_negotiated_turn(
    self,
    session_id: str,
    capabilities_payload: dict[str, Any] | None = None,
) -> tuple[A2uiRequestProcessor, RendererState, str]:
  capabilities = capabilities_payload or {
      "1.0": {"supportedCatalogIds": [c.catalog_id for c in self.catalogs]}
  }

  probe = self.generator.create_processor(capabilities)
  state = self.sessions.get(session_id)
  if state is None or not probe.accepts_state(state):
    state = probe.create_state()
    self.sessions[session_id] = state

  processor = self.generator.create_processor(capabilities, state=state)
  system_prompt = (
      "You are an order assistant. Show order details in an interactive card.\n"
      'Give each new surface a unique surfaceId, or call surface("id", update=true) '
      "when updating an existing surface.\n\n"
      f"{processor.prompt_snippet}"
  )
  return processor, state, system_prompt
```

#### Dart

```dart
({
  A2uiRequestProcessor processor,
  RendererState state,
  String systemPrompt,
}) prepareNegotiatedTurn(
  String sessionId, {
  Map<String, Object?>? capabilitiesPayload,
}) {
  final capabilities = capabilitiesPayload != null
      ? A2uiRendererCapabilities.fromJson(capabilitiesPayload)
      : A2uiRendererCapabilities.forCatalogIds(
          [for (final catalog in catalogs) catalog.id],
          version: A2uiProtocolVersion.v1_0,
        );

  final probe = generator.createProcessor(capabilities);
  RendererState? state = _sessions[sessionId];
  if (state == null || !probe.acceptsState(state)) {
    state = probe.createState();
    _sessions[sessionId] = state;
  }

  final processor = generator.createProcessor(capabilities, state: state);
  final systemPrompt =
      'You are an order assistant. Show order details in an interactive card.\n'
      'Give each new surface a unique surfaceId, or call surface("id", update=true) '
      'when updating an existing surface.\n\n'
      '${processor.promptSnippet}';

  return (processor: processor, state: state, systemPrompt: systemPrompt);
}
```

<details>
<summary>Wire format: inbound renderer capabilities metadata</summary>

Client renderers attach their supported [capabilities](/concepts/glossary/#capabilities) in transport [metadata](/concepts/messages/#metadata) (`a2uiRendererCapabilities` under `"1.0"` in `v1.0`, or `a2uiClientCapabilities` under `"v0.9"` in `v0.9.1`):

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_capabilities.json',
      href: '/specification/v1.0/schemas/#renderer_capabilities.json',
      title: 'v1.0 Renderer Capabilities Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_capabilities.json',
      href: '/specification/v0.9.1/schemas/#client_capabilities.json',
      title: 'v0.9.1 Client Capabilities Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "metadata": {
    "a2uiRendererCapabilities": {
      "1.0": {
        "supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"]
      }
    }
  }
}
```

#### v0.9.1

```json
{
  "metadata": {
    "a2uiClientCapabilities": {
      "v0.9": {
        "supportedCatalogIds": ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"]
      }
    }
  }
}
```

</details>

### Register agent-hosted functions

Attach `AgentFunction` handlers to your catalog to run deterministic server-side operations without an LLM round-trip.

Use `AgentFunction` for deterministic backend work (such as database updates, pricing rules, or order lookups) rather than branching on `action` event names. Attach your agent functions to the catalog before passing it to `A2uiGenerator` and `RendererToAgentMessageProcessor` in [Step 4](#step-4-process-messages-from-the-renderer); incoming [`callAgentFunction`](/concepts/messages/#callagentfunction-v10-only) messages (`v1.0` only) validate arguments against the function schema and return an [`agentFunctionResponse`](/concepts/messages/#agentfunctionresponse-v10-only) automatically:

#### TypeScript

```typescript
import {AgentFunction, RendererToAgentMessageProcessor} from '@a2ui/agent';
import {basicCatalog} from '@a2ui/web_core/v1_0';

export const pickupEtaFn = new AgentFunction({
  name: 'lookupPickupEta',
  description: 'Looks up the pickup window for an order.',
  returnType: 'object',
  schema: {
    type: 'object',
    properties: {orderId: {type: 'string'}},
    required: ['orderId'],
  },
  handler: args => ({
    orderId: String(args.orderId ?? 'unknown'),
    eta: 'Today, 5:30 PM',
  }),
});

export const agentCatalog = basicCatalog.copyWith({
  agentFunctions: [pickupEtaFn],
});
export const rendererMessages = new RendererToAgentMessageProcessor({
  catalogs: [agentCatalog],
});
```

#### Python

```python
from a2ui.core import AgentFunction
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.rpc import RendererToAgentMessageProcessor

pickup_eta_fn = AgentFunction(
    "lookupPickupEta",
    description="Looks up the pickup window for an order.",
    return_type="object",
    schema={
        "type": "object",
        "properties": {"orderId": {"type": "string"}},
        "required": ["orderId"],
    },
    handler=lambda args: {
        "orderId": args["orderId"],
        "eta": "Today, 5:30 PM",
    },
)

agent_catalog = BasicCatalog(ProtocolVersion.V1_0).copy_with(
    agent_functions=[pickup_eta_fn]
)
renderer_messages = RendererToAgentMessageProcessor([agent_catalog])
```

#### Dart

```bash
dart pub add json_schema_builder
```

```dart
import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

final pickupEtaFn = AgentFunction(
  name: 'lookupPickupEta',
  description: 'Looks up the pickup window for an order.',
  returnType: A2uiReturnType.object,
  argumentSchema: Schema.fromMap({
    'type': 'object',
    'properties': {
      'orderId': {'type': 'string'},
    },
    'required': ['orderId'],
  }),
  handler: (args, _) => <String, Object?>{
    'orderId': args['orderId'] ?? 'unknown',
    'eta': 'Today, 5:30 PM',
  },
);

final basic = BasicCatalog.v1_0();
// Widen the function type parameter to FunctionApi before attaching AgentFunctions:
final CatalogApi agentCatalog = basic
    .withFunctions<FunctionApi>(basic.functions.values)
    .copyWith(agentFunctions: [pickupEtaFn]);
final rendererMessages = RendererToAgentMessageProcessor(
  catalogs: [agentCatalog],
);
```

<details>
<summary>Wire format: callAgentFunction and agentFunctionResponse</summary>

When the client invokes an agent-hosted function in `v1.0`, it sends [`callAgentFunction`](/concepts/messages/#callagentfunction-v10-only) and awaits the correlated [`agentFunctionResponse`](/concepts/messages/#agentfunctionresponse-v10-only):

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'callAgentFunction',
      href: '/specification/v1.0/schemas/#renderer_to_agent.json/properties/callAgentFunction',
      title: 'v1.0 Call Agent Function Schema',
    },
    {
      version: 'v1.0',
      label: 'AgentFunctionResponseMessage',
      href: '/specification/v1.0/schemas/#agent_to_renderer.json/$defs/AgentFunctionResponseMessage',
      title: 'v1.0 Agent Function Response Schema',
    },
  ]}
/>

```json
{
  "version": "1.0",
  "callAgentFunction": {
    "surfaceId": "order_summary",
    "functionCallId": "call_01",
    "callFunction": {
      "@call": "lookupPickupEta",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      "args": {
        "orderId": "ORD-4821"
      }
    }
  }
}
```

```json
{
  "version": "1.0",
  "agentFunctionResponse": {
    "functionCallId": "call_01",
    "value": {
      "orderId": "ORD-4821",
      "eta": "Today, 5:30 PM"
    }
  }
}
```

</details>

### Call renderer-side functions

Invoke authorized client-side functions from the agent over a persistent duplex connection using `RendererFunctionCalls`.

Over full-duplex transports such as WebSockets, `RendererFunctionCalls` builds [`callRendererFunction`](/concepts/messages/#callrendererfunction-v10-only) messages (`v1.0` only) for catalog functions whose `allowedCallers` permits agent calls (`rendererOrAgent` or `agentOnly`). Given a custom catalog (`customCatalog` / `custom_catalog`) that declares `readViewportWidth` with `allowedCallers: "rendererOrAgent"`, wire `resolve` into `RendererToAgentMessageProcessor` so incoming [`rendererFunctionResponse`](/concepts/messages/#rendererfunctionresponse-v10-only) messages settle the pending promise or future:

#### TypeScript

```typescript
import {
  type AgentToRendererMessage,
  RendererFunctionCalls,
  RendererToAgentMessageProcessor,
} from '@a2ui/agent';

const rendererCalls = new RendererFunctionCalls({catalogs: [customCatalog]});
const rendererMessages = new RendererToAgentMessageProcessor({
  catalogs: [customCatalog],
  onRendererFunctionResponse: msg => rendererCalls.resolve(msg),
});

async function fetchViewportWidth(
  sendToClient: (msg: AgentToRendererMessage) => void,
): Promise<unknown> {
  const [callMsg, pendingValue] = rendererCalls.call({
    catalogId: customCatalog.id,
    name: 'readViewportWidth',
  });
  sendToClient(callMsg);
  return await pendingValue;
}
```

#### Python

```python
from collections.abc import Awaitable, Callable
from typing import Any

from a2ui.rpc import RendererFunctionCalls, RendererToAgentMessageProcessor

renderer_calls = RendererFunctionCalls(catalogs=[custom_catalog])
renderer_messages = RendererToAgentMessageProcessor(
    [custom_catalog],
    on_renderer_function_response=renderer_calls.resolve,
)

async def fetch_viewport_width(
    send_to_client: Callable[[dict[str, Any]], Awaitable[None]],
) -> Any:
  call_msg, pending_value = renderer_calls.call(
      catalog_id=custom_catalog.catalog_id,
      name="readViewportWidth",
  )
  await send_to_client(call_msg.model_dump(by_alias=True, exclude_unset=True))
  return await pending_value
```

#### Dart

```dart
import 'package:a2ui_agent/a2ui_agent.dart';

final rendererCalls = RendererFunctionCalls(catalogs: [customCatalog]);
final rendererMessages = RendererToAgentMessageProcessor(
  catalogs: [customCatalog],
  onRendererFunctionResponse: rendererCalls.resolve,
);

Future<Object?> fetchViewportWidth(
  void Function(Map<String, Object?>) sendToClient,
) async {
  final (callMsg, pendingValue) = rendererCalls.call(
    catalogId: customCatalog.id,
    name: 'readViewportWidth',
  );
  sendToClient(callMsg.toJson());
  return await pendingValue;
}
```

### Read synchronized client data models

Read the surface data model attached in transport metadata when a surface is created with [`sendDataModel: true`](/concepts/data-binding/#senddatamodel-true).

Two-way input components mutate the client's local [data model](/concepts/glossary/#data-model) without sending a wire message on every keystroke. When a surface sets `sendDataModel: true`, the renderer attaches that surface's full data model under `metadata.a2uiRendererDataModel.surfaces[surfaceId]` (`metadata.a2uiClientDataModel.surfaces[surfaceId]` in `v0.9.1`) on every message it sends to the agent:

#### TypeScript

```typescript
export function readSyncedSurfaceData(
  surfaceId: string,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  const dm = (metadata?.a2uiRendererDataModel ?? metadata?.a2uiClientDataModel) as
    | {surfaces?: Record<string, Record<string, unknown>>}
    | undefined;
  return dm?.surfaces?.[surfaceId] ?? {};
}
```

#### Python

```python
from typing import Any

def read_synced_surface_data(
    surface_id: str, metadata: dict[str, Any] | None = None
) -> dict[str, Any]:
  dm = (metadata or {}).get("a2uiRendererDataModel") or (metadata or {}).get(
      "a2uiClientDataModel", {}
  )
  return dm.get("surfaces", {}).get(surface_id, {})
```

#### Dart

```dart
Map<String, Object?> readSyncedSurfaceData(
  String surfaceId, [
  Map<String, Object?>? metadata,
]) {
  final rawDm =
      metadata?['a2uiRendererDataModel'] ?? metadata?['a2uiClientDataModel'];
  final surfaces = ((rawDm as Map?)?['surfaces'] as Map?)?.cast<String, Object?>();
  return (surfaces?[surfaceId] as Map?)?.cast<String, Object?>() ?? const {};
}
```

<details>
<summary>Wire format: synchronized data-model metadata</summary>

Below is an inbound [`action`](/concepts/messages/#action) request accompanied by synchronized data-model metadata (`a2uiRendererDataModel` in `v1.0`, `a2uiClientDataModel` in `v0.9.1`):

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_data_model.json',
      href: '/specification/v1.0/schemas/#renderer_data_model.json',
      title: 'v1.0 Renderer Data Model Metadata Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_data_model.json',
      href: '/specification/v0.9.1/schemas/#client_data_model.json',
      title: 'v0.9.1 Client Data Model Metadata Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "message": {
    "version": "1.0",
    "action": {
      "name": "confirm_order",
      "surfaceId": "order_summary",
      "sourceComponentId": "confirm_btn",
      "timestamp": "2026-05-01T18:30:00.000Z",
      "context": {
        "orderId": "ORD-4821"
      }
    }
  },
  "metadata": {
    "a2uiRendererDataModel": {
      "version": "1.0",
      "surfaces": {
        "order_summary": {
          "orderId": "ORD-4821",
          "summaryText": "2 items ready for pickup"
        }
      }
    }
  }
}
```

#### v0.9.1

```json
{
  "message": {
    "version": "v0.9",
    "action": {
      "name": "confirm_order",
      "surfaceId": "order_summary",
      "sourceComponentId": "confirm_btn",
      "timestamp": "2026-05-01T18:30:00.000Z",
      "context": {
        "orderId": "ORD-4821"
      }
    }
  },
  "metadata": {
    "a2uiClientDataModel": {
      "version": "v0.9",
      "surfaces": {
        "order_summary": {
          "orderId": "ORD-4821",
          "summaryText": "2 items ready for pickup"
        }
      }
    }
  }
}
```

</details>

### Non-streaming generation and validation retry

Buffer complete model responses before sending messages when you want atomic validation and clean-slate retries instead of progressive streaming.

In [Step 3](#step-3-build-the-system-prompt-and-stream-a2ui-messages), `openStream()` (`open_stream()` in Python) validates component schemas and surface topology incrementally as tokens arrive. Because progressive messages have already reached the client when a streamed block fails, recovering mid-stream means flushing `err.partialResults` (`err.partial_results` in Python), opening a new `openStream()` on the same `RendererState`, and either repairing existing surfaces in place (`surface("id", update=true)`) or sending `deleteSurface` before regenerating.

When your agent uses buffered (non-streaming) LLM calls instead, pass the full model text to `parseResponse` (`parse_response` in Python). If a block invents an unknown component, omits `root`, or leaves a dangling child ID, `parseResponse` rolls back `RendererState` and raises an `A2uiError` so you can pass the failed output and error message back to the model on a retry turn:

#### TypeScript

```typescript
import {A2uiError, type A2uiRequestProcessor, type AgentToRendererMessage} from '@a2ui/agent';

export async function generateValidatedTurn(
  processor: A2uiRequestProcessor,
  userPrompt: string,
  callLlm: (prompt: string) => Promise<string>,
  maxRetries = 2,
): Promise<AgentToRendererMessage[]> {
  let prompt = userPrompt;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const rawText = await callLlm(prompt);
    try {
      const parts = processor.parseResponse(rawText);
      const messages: AgentToRendererMessage[] = [];
      for (const part of parts) {
        if (part.type === 'a2ui') {
          messages.push(...part.a2ui);
        }
      }
      return messages;
    } catch (err) {
      if (!(err instanceof A2uiError) || attempt === maxRetries) {
        throw err;
      }
      prompt = [
        userPrompt,
        `Your previous response:\n${rawText}`,
        `Validation failed: ${err.message}`,
        'Fix the A2UI output so every component and ID matches the catalog.',
      ].join('\n\n');
    }
  }
  return [];
}
```

#### Python

```python
from collections.abc import Awaitable, Callable

from a2ui.core import A2uiError
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import A2uiPart
from a2ui.processor import A2uiRequestProcessor

async def generate_validated_turn(
    processor: A2uiRequestProcessor,
    user_prompt: str,
    call_llm: Callable[[str], Awaitable[str]],
    max_retries: int = 2,
) -> list[AgentToRendererMessage]:
  prompt = user_prompt
  for attempt in range(max_retries + 1):
    raw_text = await call_llm(prompt)
    try:
      parts = processor.parse_response(raw_text)
      return [
          msg
          for part in parts
          if isinstance(part, A2uiPart)
          for msg in part.a2ui
      ]
    except A2uiError as err:
      if attempt == max_retries:
        raise
      prompt = (
          f"{user_prompt}\n\n"
          f"Your previous response:\n{raw_text}\n\n"
          f"Validation failed: {err}\n"
          "Fix the A2UI output so every component and ID matches the catalog."
      )
  return []
```

#### Dart

```dart
import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

Future<List<AgentToRendererMessage>> generateValidatedTurn(
  A2uiRequestProcessor processor,
  String userPrompt,
  Future<String> Function(String prompt) callLlm, {
  int maxRetries = 2,
}) async {
  var prompt = userPrompt;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    final rawText = await callLlm(prompt);
    try {
      final parts = processor.parseResponse(rawText);
      return [
        for (final part in parts)
          if (part is A2uiPart) ...part.a2ui,
      ];
    } on A2uiError catch (err) {
      if (attempt == maxRetries) rethrow;
      prompt = '$userPrompt\n\n'
          'Your previous response:\n$rawText\n\n'
          'Validation failed: $err\n'
          'Fix the A2UI output so every component and ID matches the catalog.';
    }
  }
  return const [];
}
```

### Customize catalogs, examples, and inference formats

Prune large catalogs, attach few-shot A2UI JSON examples, or customize inference format options on the generator to steer layout quality and reduce prompt size.

Attach component or function pruning transformers to `CatalogConfig` to expose only the widgets a workflow needs, and pass canonical A2UI JSON example turns to `A2uiGenerator`, which validates them against the negotiated catalogs and decompiles them into the active inference format (such as `<a2ui>` blocks in Express). You can also pass options to `ExpressFormatFactory` or swap to `DirectJsonFormatFactory` when a model emits raw JSON inside `<a2ui-json>` tags (see [Inference Formats](/concepts/inference-formats/)). In Python, compose server-side component templates with `@macro` and `MacroExpander` so clients render new composite layouts without a client release (see [Using Macros](/guides/macros/)):

#### TypeScript

```typescript
import {
  A2uiGenerator,
  type AgentToRendererMessage,
  CatalogConfig,
  ComponentPruningTransformer,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
} from '@a2ui/agent';
import {basicCatalog} from '@a2ui/web_core/v1_0';

const exampleTurn: AgentToRendererMessage[] = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'order_summary',
      catalogId: basicCatalog.id,
      components: [
        {id: 'root', component: 'Card', child: 'status'},
        {id: 'status', component: 'Text', text: 'Order ORD-4821 ready for pickup'},
      ],
    },
  },
];

export const formatFactory = new ExpressFormatFactory({
  surfaceId: 'order_summary',
  allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel'],
});

// Or emit raw A2UI JSON inside <a2ui-json> tags:
export const jsonFormatFactory = new DirectJsonFormatFactory({
  progressiveKeys: ['text'],
});

export const prunedGenerator = new A2uiGenerator(
  [
    new CatalogConfig(basicCatalog, [
      new ComponentPruningTransformer(['Card', 'Column', 'Text', 'Button']),
    ]),
  ],
  {[basicCatalog.id]: exampleTurn},
  formatFactory,
);
```

#### Python

```python
from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import (
    DirectJsonFormatFactory,
    ExpressFormatFactory,
    to_message_models,
)
from a2ui.processor import A2uiGenerator, CatalogConfig

basic = BasicCatalog(ProtocolVersion.V1_0)

example_turn = to_message_models([
    {
        "version": "1.0",
        "createSurface": {
            "surfaceId": "order_summary",
            "catalogId": basic.catalog_id,
            "components": [
                {"id": "root", "component": "Card", "child": "status"},
                {
                    "id": "status",
                    "component": "Text",
                    "text": "Order ORD-4821 ready for pickup",
                },
            ],
        },
    },
])

format_factory = ExpressFormatFactory(
    allowed_messages=["createSurface", "updateComponents", "updateDataModel"],
    surface_id="order_summary",
)

# Or emit raw A2UI JSON inside <a2ui-json> tags:
json_format_factory = DirectJsonFormatFactory(progressive_keys={"text"})

pruned_generator = A2uiGenerator(
    catalogs=[
        CatalogConfig(
            catalog=basic,
            transformers=[
                ComponentPruningTransformer(["Card", "Column", "Text", "Button"])
            ],
        ),
    ],
    examples=[example_turn],
    inference_format_factory=format_factory,
)
```

#### Dart

```dart
import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

final basic = BasicCatalog.v1_0();

final exampleTurn = [
  AgentToRendererMessage.fromJson({
    'version': '1.0',
    'createSurface': {
      'surfaceId': 'order_summary',
      'catalogId': basic.id,
      'components': [
        {'id': 'root', 'component': 'Card', 'child': 'status'},
        {
          'id': 'status',
          'component': 'Text',
          'text': 'Order ORD-4821 ready for pickup',
        },
      ],
    },
  }),
];

const formatFactory = ExpressFormatFactory(
  allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel'],
);

// Or emit raw A2UI JSON inside <a2ui-json> tags:
const jsonFormatFactory = DirectJsonFormatFactory(progressiveKeys: {'text'});

final prunedGenerator = A2uiGenerator(
  catalogs: [
    CatalogConfig(
      basic,
      transformers: [
        ComponentPruningTransformer(['Card', 'Column', 'Text', 'Button']),
      ],
    ),
  ],
  examples: [exampleTurn],
  inferenceFormatFactory: formatFactory,
);
```

---

## Connect to agent frameworks and transports

Plug the A2UI generator and message processors into standard agent frameworks and protocols instead of writing custom transport plumbing.

### Google ADK

Use the ADK integration package to manage per-session request processors, inject A2UI prompt instructions without colliding with ADK `{variable}` state templating, expose the client A2UI toolset, and bridge A2A events and function RPCs:

```bash
pip install "a2ui-adk[a2a]"
```

```python
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutorConfig
from google.adk.agents import LlmAgent

from a2ui.adk import (
    A2uiEventConverter,
    A2uiInstruction,
    A2uiProcessorStore,
    SendA2uiToClientToolset,
    a2ui_rpc_callback,
)

processors = A2uiProcessorStore()

def active_catalogs(ctx):
  processor = processors.get(ctx)
  return processor.active_catalogs if processor else None

order_agent = LlmAgent(
    model="gemini-2.5-flash",
    name="order_agent",
    instruction=A2uiInstruction(
        "You help customers manage pickup orders in {store_city}.",
        a2ui_processor=processors.get,
        a2ui_enabled=processors.is_enabled,
    ),
    tools=[
        SendA2uiToClientToolset(
            a2ui_enabled=processors.is_enabled,
            a2ui_processor=processors.get,
        ),
    ],
    before_agent_callback=a2ui_rpc_callback(catalogs=active_catalogs),
)

executor_config = A2aAgentExecutorConfig(
    event_converter=A2uiEventConverter(a2ui_processor=processors.get),
)

# In your request executor before running the session:
# processors.set(session.id, processor if a2ui_active else None)
```

> **Note**
  ADK substitutes `{name}` placeholders in plain string instructions from session state.
  Concatenating `processor.prompt_snippet` into a raw `LlmAgent.instruction` string raises
  `KeyError` on A2UI braces (such as `${expression}` or `\p{XID_Start}`). Always wrap your
  instruction in `A2uiInstruction`, which resolves your own `{store_city}` template variables while
  leaving the A2UI prompt untouched.

### A2A protocol

Use the A2A integration package to advertise A2UI support on your agent card, negotiate the [A2A Extension Specification](/specification/v1.0-a2ui-extension-specification/) per request, stream A2UI messages as `application/a2ui+json` data parts, and answer inbound function RPCs:

```bash
pip install a2ui-a2a
```

```python
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import AgentCapabilities, AgentCard

from a2ui.a2a import (
    create_a2ui_parts,
    get_a2ui_agent_extension,
    get_a2ui_messages,
    stream_response_to_parts,
    try_activate_a2ui_extension,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.rpc import RendererToAgentMessageProcessor

basic = BasicCatalog(ProtocolVersion.V1_0)

agent_card = AgentCard(
    name="Order Agent",
    description="Streams interactive order summaries with A2UI.",
    url="http://localhost:10002/",
    version="1.0.0",
    default_input_modes=["text/plain"],
    default_output_modes=["text/plain", "application/a2ui+json"],
    capabilities=AgentCapabilities(
        streaming=True,
        extensions=[
            get_a2ui_agent_extension(
                ProtocolVersion.V1_0,
                supported_catalog_ids=[basic.catalog_id],
            ),
        ],
    ),
    skills=[],
)

class OrderA2aExecutor(AgentExecutor):
  # Given a session processor lookup and an enqueue_parts(event_queue, parts) helper:
  async def execute(
      self, context: RequestContext, event_queue: EventQueue
  ) -> None:
    activated_version = try_activate_a2ui_extension(context, agent_card)
    if activated_version is None:
      return
    processor, token_stream = await self.prepare_session(context)
    inbound = (
        get_a2ui_messages(context.message)
        if context.message is not None
        and activated_version == ProtocolVersion.V1_0
        else []
    )
    rpc_processor = RendererToAgentMessageProcessor(processor.active_catalogs)
    results = [await rpc_processor.process_message(msg) for msg in inbound]
    if inbound and all(result.handled for result in results):
      rpc_reply_parts = create_a2ui_parts(
          [reply for result in results for reply in result.replies],
          version=activated_version,
      )
      if rpc_reply_parts:
        await enqueue_parts(event_queue, rpc_reply_parts)
      return

    async for a2a_part in stream_response_to_parts(
        processor.open_stream(), token_stream, activated_version
    ):
      await enqueue_parts(event_queue, [a2a_part])
```

### AG-UI and CopilotKit

Enable A2UI on `CopilotRuntime` to stream A2UI surfaces over [AG-UI](https://docs.ag-ui.com/) across Python and TypeScript agent backends.

When `injectA2UITool: true` is set (or when the frontend supplies a catalog), CopilotKit injects the A2UI generation tool and translates tool calls and state deltas into AG-UI events across integrations including Google ADK (`ag_ui_adk`), LangGraph (`CopilotKitMiddleware`), and AWS Strands (`@ag-ui/aws-strands`). See the [CopilotKit A2UI documentation](https://docs.copilotkit.ai/generative-ui/a2ui) for runtime setup details:

```typescript
import {CopilotRuntime} from '@copilotkit/runtime';

const runtime = new CopilotRuntime({
  agents: {
    order_agent: myOrderAgent, // Your AG-UI compatible agent instance
  },
  a2ui: {
    injectA2UITool: true, // Optional (default: false)
  },
});
```

For Model Context Protocol tool servers that attach interactive UI resources (`ui://`), see [Serve A2UI Layouts from an MCP Server](/guides/a2ui-over-mcp/) and [MCP Integration Overview](/guides/mcp-overview/).

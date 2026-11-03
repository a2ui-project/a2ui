/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The A2A server of the scripted test agent.
 *
 * `createServer` wires a `ScriptedModel` into an `@a2a-js/sdk` executor built on `@a2ui/agent`:
 *
 * - Inbound, each request is negotiated against the renderer's capabilities, read from the A2A
 *   message with `readRendererCapabilities`. A request with capabilities gets a processor for its
 *   protocol version and format, bound to the conversation's `RendererState`; a request without
 *   gets none, so the system prompt carries no A2UI snippet and the model answers with text only.
 *   Renderer messages in the request (`action`, `error`) reach the model as text through
 *   `parseInboundMessage` and `formatInboundForModel`; `callAgentFunction` is answered by the
 *   conversation's `RendererState` without a model turn.
 * - Outbound, the model's chunks go through the processor's streaming parser, so the renderer
 *   gets `application/a2ui+json` parts as they parse.
 *
 * `GET /e2e/log` returns the `RequestLog` as JSON, and `DELETE /e2e/log` clears it.
 */

import crypto from 'crypto';
import path from 'path';

import type {AgentCard, DataPart, Message, Part, Task, TaskStatusUpdateEvent} from '@a2a-js/sdk';
import {
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  type RequestContext,
} from '@a2a-js/sdk/server';
import {agentCardHandler, jsonRpcHandler, UserBuilder} from '@a2a-js/sdk/server/express';
import {
  A2uiRequestProcessor,
  type AgentFunctionRegistry,
  type CatalogApi,
  CatalogConfig,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  formatInboundForModel,
  type InferenceFormatFactory,
  parseInboundMessage,
  readRendererCapabilities,
  RendererState,
  resolveCatalogs,
  type ResponsePart,
} from '@a2ui/agent';
import express from 'express';

import {buildCatalog, buildRegistry, repoRoot, type VersionProfile, VERSIONS} from './functions.js';
import {loadScenarios, type ScenarioIndex} from './scenarios.js';
import {type ChatTurn, RequestLog, ScriptedModel} from './scripted-model.js';

export const A2UI_MIME_TYPE = 'application/a2ui+json';
export const AGENT_NAME = 'A2UI E2E Test Agent';

/** The inference formats the agent can be started with, by scenario name. */
export const FORMATS: Readonly<Record<string, () => InferenceFormatFactory>> = {
  direct_json: () => new DirectJsonFormatFactory(),
  express: () => new ExpressFormatFactory(),
};

export const DEFAULT_SCENARIO_DIR = path.join(repoRoot(), 'conformance', 'e2e');

const ROLE =
  'You are the A2UI end-to-end test agent. You replay a scripted scenario and never answer ' +
  'anything else.';
const RPC_KEYS = ['callAgentFunction', 'rendererFunctionResponse'];
const RENDERER_KEYS = ['action', 'userAction', 'error', ...RPC_KEYS];

export interface ServerConfig {
  readonly port?: number;
  /** The scenario format the model streams and the parser reads. */
  readonly format?: string;
  readonly scenarioDir?: string;
  readonly chunkDelayMs?: number;
  readonly rpcDelayMs?: number;
  /** The scenarios to serve. Loaded from `scenarioDir` when not given. */
  readonly scenarios?: ScenarioIndex;
}

export interface A2uiE2eServer {
  readonly app: express.Express;
  readonly agentCard: AgentCard;
  readonly log: RequestLog;
  readonly format: string;
}

/** What the agent keeps for one A2A context across its turns. */
interface Conversation {
  profile?: VersionProfile;
  state?: RendererState;
  registry?: AgentFunctionRegistry;
  readonly history: ChatTurn[];
}

/** The outcome of reading one request's capabilities. */
interface Negotiation {
  readonly profile?: VersionProfile;
  readonly processor?: A2uiRequestProcessor;
  readonly state?: RendererState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatFactory(format: string): InferenceFormatFactory {
  const factory = FORMATS[format];
  if (!factory) {
    throw new Error(
      `Unknown format '${format}'; expected one of ${Object.keys(FORMATS).join(', ')}.`,
    );
  }
  return factory();
}

function toA2aParts(parts: readonly ResponsePart[]): Part[] {
  return parts.flatMap((part): Part[] =>
    part.type === 'text'
      ? [{kind: 'text', text: part.text}]
      : part.a2ui.map(
          (message): DataPart => ({
            kind: 'data',
            data: message as unknown as Record<string, unknown>,
            metadata: {mimeType: A2UI_MIME_TYPE},
          }),
        ),
  );
}

function a2uiDataParts(messages: readonly unknown[]): Part[] {
  return messages.map(
    (message): DataPart => ({
      kind: 'data',
      data: message as Record<string, unknown>,
      metadata: {mimeType: A2UI_MIME_TYPE},
    }),
  );
}

/** The renderer message a part carries, if it is one. */
function rendererMessage(part: Part): Record<string, unknown> | undefined {
  if (part.kind !== 'data' || !isRecord(part.data)) return undefined;
  const mime = isRecord(part.metadata) ? part.metadata.mimeType : undefined;
  if (mime === A2UI_MIME_TYPE || RENDERER_KEYS.some(key => key in part.data)) {
    return part.data;
  }
  return undefined;
}

function sameCatalogs(left: readonly CatalogApi[], right: readonly CatalogApi[]): boolean {
  return left.length === right.length && left.every((catalog, i) => catalog.id === right[i].id);
}

/** Publishes the task's events, with the shape the sample agents use. */
class TaskEvents {
  constructor(
    private readonly eventBus: ExecutionEventBus,
    private readonly requestContext: RequestContext,
  ) {}

  /** Announces the task, unless it already exists from an earlier turn. */
  start(): void {
    const {taskId, contextId, userMessage, task} = this.requestContext;
    if (task) return;
    const initial: Task = {
      kind: 'task',
      id: taskId,
      contextId,
      status: {state: 'submitted', timestamp: new Date().toISOString()},
      history: [userMessage],
    };
    this.eventBus.publish(initial);
  }

  status(
    state: TaskStatusUpdateEvent['status']['state'],
    final: boolean,
    parts: Part[] = [],
  ): void {
    const {taskId, contextId} = this.requestContext;
    const message: Message | undefined =
      parts.length > 0
        ? {kind: 'message', role: 'agent', messageId: crypto.randomUUID(), taskId, contextId, parts}
        : undefined;
    const event: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {state, timestamp: new Date().toISOString(), ...(message ? {message} : {})},
      final,
    };
    this.eventBus.publish(event);
  }
}

class ScriptedExecutor implements AgentExecutor {
  private readonly conversations = new Map<string, Conversation>();
  private readonly catalogs = new Map<VersionProfile, CatalogConfig[]>();

  constructor(
    private readonly model: ScriptedModel,
    private readonly factory: InferenceFormatFactory,
    rpcDelayMs: number,
  ) {
    for (const profile of VERSIONS) {
      this.catalogs.set(profile, [new CatalogConfig(buildCatalog(profile, {rpcDelayMs}))]);
    }
  }

  /** The catalog ids the agent serves for each version, for the agent card. */
  catalogIds(profile: VersionProfile): string[] {
    return (this.catalogs.get(profile) ?? []).map(config => config.transformedCatalog.id);
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const events = new TaskEvents(eventBus, requestContext);
    try {
      await this.run(requestContext, events);
    } catch (e) {
      console.error(`Task ${requestContext.taskId} failed:`, e);
      const detail = e instanceof Error ? e.message : String(e);
      events.status('failed', true, [
        {kind: 'text', text: `The agent could not answer this request: ${detail}`},
      ]);
    }
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log('Cancellation requested for', taskId);
  }

  private async run({contextId, userMessage}: RequestContext, events: TaskEvents): Promise<void> {
    events.start();
    const conversation = this.conversation(contextId);
    const negotiation = this.negotiate(userMessage, conversation);
    events.status('working', false);

    // Renderer RPC messages are answered by the renderer state, without a model turn. Other
    // renderer messages reach the model as text.
    const texts: string[] = [];
    const rpcReplies: unknown[] = [];
    for (const part of userMessage.parts ?? []) {
      if (part.kind === 'text') {
        if (part.text) texts.push(part.text);
        continue;
      }
      const message = rendererMessage(part);
      if (!message) continue;
      if (RPC_KEYS.some(key => key in message)) {
        const state = negotiation.state ?? this.rpcState(conversation);
        await state.receive(message);
        rpcReplies.push(...state.drainOutbound());
        continue;
      }
      const formatted = formatInboundForModel(
        parseInboundMessage(message, negotiation.profile?.wireVersion ?? '1.0'),
      );
      if (formatted) texts.push(formatted);
    }
    if (rpcReplies.length > 0) {
      events.status('working', false, a2uiDataParts(rpcReplies));
    }
    if (texts.length === 0) {
      events.status('completed', true);
      return;
    }

    conversation.history.push({role: 'user', text: texts.join('\n')});
    const systemPrompt = this.systemPrompt(negotiation);
    const publish = (parts: readonly ResponsePart[]) => {
      const a2aParts = toA2aParts(parts);
      if (a2aParts.length > 0) events.status('working', false, a2aParts);
    };

    let fullText = '';
    const {processor} = negotiation;
    if (processor && processor.parser.supportsStreaming) {
      const stream = processor.openStream();
      for await (const chunk of this.model.generate(systemPrompt, conversation.history)) {
        fullText += chunk;
        publish(stream.feed(chunk));
      }
      publish(stream.close());
    } else {
      for await (const chunk of this.model.generate(systemPrompt, conversation.history)) {
        fullText += chunk;
      }
      publish(processor ? processor.parseResponse(fullText) : [{type: 'text', text: fullText}]);
    }
    conversation.history.push({role: 'model', text: fullText});
    events.status('completed', true);
  }

  private conversation(contextId: string): Conversation {
    let conversation = this.conversations.get(contextId);
    if (!conversation) {
      conversation = {history: []};
      this.conversations.set(contextId, conversation);
    }
    return conversation;
  }

  /**
   * Reads the request's capabilities and binds the conversation's renderer state.
   *
   * A renderer that withdraws its capabilities for a turn gets no processor, and text, for that
   * turn; the state is kept for when they come back.
   */
  private negotiate(message: Message, conversation: Conversation): Negotiation {
    for (const profile of [...VERSIONS].reverse()) {
      const capabilities = readRendererCapabilities(message.metadata, profile.wireVersion);
      if (!capabilities) continue;
      const active = resolveCatalogs(this.catalogs.get(profile)!, capabilities);
      let {state} = conversation;
      if (!state || conversation.profile !== profile || !sameCatalogs(state.catalogs, active)) {
        conversation.registry = buildRegistry(active);
        state = new RendererState(active, {agentFunctions: conversation.registry});
      }
      const processor = new A2uiRequestProcessor(active, undefined, this.factory, {state});
      conversation.profile = profile;
      conversation.state = state;
      return {profile, processor, state};
    }
    return {};
  }

  /** The state that answers an RPC message sent without capabilities. */
  private rpcState(conversation: Conversation): RendererState {
    if (!conversation.state) {
      const active = this.catalogs.get(VERSIONS.at(-1)!)!.map(c => c.transformedCatalog);
      conversation.registry = buildRegistry(active);
      conversation.state = new RendererState(active, {agentFunctions: conversation.registry});
    }
    return conversation.state;
  }

  private systemPrompt({processor}: Negotiation): string {
    if (!processor) return ROLE;
    // The scripted model reads the protocol version from these ids, which the Express snippet
    // does not name on its own.
    const ids = processor.catalogs.map(catalog => catalog.id).join(', ');
    return `${ROLE}\n\nActive A2UI catalogs: ${ids}\n\n${processor.promptSnippet}`;
  }
}

function buildAgentCard(port: number, format: string, executor: ScriptedExecutor): AgentCard {
  return {
    name: AGENT_NAME,
    description:
      `Replays the conformance/e2e scenarios over A2A, in ${format}, for the live-pair ` +
      'end-to-end tests.',
    protocolVersion: '0.3.0',
    version: '0.1.0',
    url: `http://localhost:${port}/`,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'replay_scenario',
        name: 'Replay a scenario',
        description:
          "Answers the opening text of a conformance/e2e scenario with that scenario's " +
          'scripted turns.',
        tags: ['a2ui', 'test'],
      },
    ],
    capabilities: {
      streaming: true,
      extensions: VERSIONS.map(profile => ({
        uri: `https://a2ui.org/a2a-extension/a2ui/v${profile.wireVersion.replace(/^v/, '')}`,
        description: `A2UI v${profile.wireVersion.replace(/^v/, '')}`,
        params: {supportedCatalogIds: executor.catalogIds(profile)},
      })),
    },
  };
}

/**
 * Builds the Express app of the test agent.
 *
 * The app answers A2A JSON-RPC at `/`, serves the agent card at
 * `/.well-known/agent-card.json`, and returns the model's request log at `/e2e/log`.
 */
export function createServer(config: ServerConfig = {}): A2uiE2eServer {
  const port = config.port ?? 10011;
  const format = config.format ?? 'direct_json';
  const factory = formatFactory(format);
  const scenarios = config.scenarios ?? loadScenarios(config.scenarioDir ?? DEFAULT_SCENARIO_DIR);
  const log = new RequestLog();
  const model = new ScriptedModel(scenarios, {format, chunkDelayMs: config.chunkDelayMs, log});
  const executor = new ScriptedExecutor(model, factory, config.rpcDelayMs ?? 0);
  const agentCard = buildAgentCard(port, format, executor);
  const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);

  const app = express();
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || '*',
      );
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json());
  app.get('/e2e/log', (_req, res) => {
    res.json(log.records);
  });
  app.delete('/e2e/log', (_req, res) => {
    log.clear();
    res.json({cleared: true});
  });
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({agentCardProvider: async () => agentCard}),
  );
  app.use('/', jsonRpcHandler({requestHandler, userBuilder: UserBuilder.noAuthentication}));
  return {app, agentCard, log, format};
}

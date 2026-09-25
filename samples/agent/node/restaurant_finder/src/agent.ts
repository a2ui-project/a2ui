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

import fs from 'fs';
import path from 'path';
import * as crypto from 'crypto';
import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  Message,
  Part,
  TextPart,
  DataPart,
} from '@a2a-js/sdk';
import {AgentExecutor, RequestContext, ExecutionEventBus} from '@a2a-js/sdk/server';
import {GoogleGenAI, FunctionCall, PartListUnion, Chat} from '@google/genai';
import {
  A2uiGenerator,
  type AgentToRendererMessage,
  A2uiRequestProcessor,
  basicCatalog,
  CatalogConfig,
  DirectJsonStreamProcessorImpl,
  ExpressDecompiler,
  ExpressFormatFactory,
  ResponsePart,
} from '@a2ui/agent';
import {ROLE_DESCRIPTION, getUiDescription} from './prompt.js';
import {
  executeGetRestaurants,
  getPackageRootDir,
  getRestaurantsDeclaration,
  resolvePythonSampleDir,
  verifyPythonSampleAssets,
} from './tools.js';

export interface SampleConfig {
  version: 'v0.9' | 'v1.0';
  format: 'direct_json' | 'express';
}

/**
 * Resolves the A2UI version and format from environment variables.
 * Fails fast if any variable is set to an unsupported value.
 */
export function resolveSampleConfig(env: NodeJS.ProcessEnv = process.env): SampleConfig {
  const rawVersion = env.A2UI_VERSION?.trim();
  let version: 'v0.9' | 'v1.0' = 'v1.0';
  if (rawVersion !== undefined && rawVersion !== '') {
    if (rawVersion !== 'v0.9' && rawVersion !== 'v1.0') {
      throw new Error(
        `A2UI_VERSION must be "v0.9" or "v1.0", but it is "${env.A2UI_VERSION}". Allowed values are "v0.9", "v1.0".`,
      );
    }
    version = rawVersion;
  }

  const rawFormat = env.A2UI_FORMAT?.trim();
  let format: 'direct_json' | 'express' = 'direct_json';
  if (rawFormat !== undefined && rawFormat !== '') {
    if (rawFormat !== 'direct_json' && rawFormat !== 'express') {
      throw new Error(
        `A2UI_FORMAT must be "direct_json" or "express", but it is "${env.A2UI_FORMAT}". Allowed values are "direct_json", "express".`,
      );
    }
    format = rawFormat;
  }

  return {version, format};
}

/** Which backend serves a turn: a real model, or the canned response. */
export type LlmMode = 'live' | 'stub';

/**
 * Decides how to answer requests, and rejects any configuration that is
 * ambiguous about it.
 */
export function resolveLlmMode(env: NodeJS.ProcessEnv = process.env): LlmMode {
  const stubFlag = env.STUB_LLM?.trim();
  if (stubFlag !== undefined && stubFlag !== '' && stubFlag !== 'true' && stubFlag !== 'false') {
    throw new Error(
      `STUB_LLM must be "true" or "false", but it is "${env.STUB_LLM}". ` +
        'Use STUB_LLM=true to serve the canned response without calling a model.',
    );
  }

  if (stubFlag === 'true') {
    return 'stub';
  }

  if (env.GEMINI_API_KEY?.trim()) {
    return 'live';
  }

  const named = env.GEMINI_API_KEY !== undefined;
  throw new Error(
    (named
      ? 'GEMINI_API_KEY is set but empty.'
      : 'GEMINI_API_KEY is not set, and it is required to reach a model.') +
      '\nEither provide a key:\n' +
      '  GEMINI_API_KEY=... yarn workspace @a2ui/agent-restaurant-node run start\n' +
      'or ask for the canned response explicitly:\n' +
      '  STUB_LLM=true yarn workspace @a2ui/agent-restaurant-node run start',
  );
}

/** Builds the AgentCard matching the Python sample and configured A2UI version. */
export function buildAgentCard(config: SampleConfig, port = 10002): AgentCard {
  const catalogId = basicCatalog(config.version).id;

  const extension =
    config.version === 'v0.9'
      ? {
          uri: 'https://a2ui.org/a2a-extension/a2ui/v0.9',
          description: 'Provides agent driven UI using the A2UI JSON format.',
          params: {
            supportedCatalogIds: [catalogId],
          },
        }
      : {
          uri: 'https://a2ui.org/a2a-extension/a2ui/v1.0',
          params: {
            version: '1.0.0',
            capabilities: {
              supportedCatalogIds: [catalogId],
            },
          },
        };

  return {
    name: 'Restaurant Agent',
    description: 'This agent helps find restaurants based on user criteria.',
    protocolVersion: '0.3.0',
    version: '1.0.0',
    url: `http://localhost:${port}/a2a/json-rpc`,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'find_restaurants',
        name: 'Find Restaurants Tool',
        description: 'Helps find restaurants based on user criteria (e.g., cuisine, location).',
        tags: ['restaurant', 'finder'],
        examples: ['Find me the top 10 chinese restaurants in the US'],
      },
    ],
    capabilities: {
      streaming: true,
      extensions: [extension],
    },
  };
}

export interface LoadedExamples {
  exampleBlocks: Record<string, string>;
  catalogExamplesString: string;
}

/**
 * Loads, decompiles (if Express), and validates examples at startup.
 */
export function loadAndValidateExamples(
  config: SampleConfig,
  packageRoot: string = getPackageRootDir(),
): LoadedExamples {
  const examplesDir = path.join(packageRoot, 'examples', config.version);
  if (!fs.existsSync(examplesDir)) {
    throw new Error(`Examples directory not found at ${examplesDir}`);
  }

  const catalog = basicCatalog(config.version);
  const files = fs
    .readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No example files found in ${examplesDir}`);
  }

  const exampleBlocks: Record<string, string> = {};
  const decompiler =
    config.format === 'express' ? new ExpressDecompiler(catalog, config.version) : null;

  const tempGen = new A2uiGenerator([new CatalogConfig(catalog)]);

  for (const file of files) {
    const basename = path.parse(file).name;
    const fullPath = path.join(examplesDir, file);
    const rawContent = fs.readFileSync(fullPath, 'utf-8');

    if (config.format === 'direct_json') {
      try {
        const proc = tempGen.createProcessor({supportedCatalogIds: [catalog.id]});
        proc.parseResponse(`<a2ui-json>\n${rawContent}\n</a2ui-json>`);
      } catch (e) {
        throw new Error(`Failed to validate example ${file} (direct_json): ${e}`);
      }
      exampleBlocks[basename] = rawContent;
    } else {
      const messages = JSON.parse(rawContent) as AgentToRendererMessage[];
      const decompiled = decompiler!.decompile(messages);
      const wrapped = decompiler!.wrapDecompiledBlocks([decompiled]);

      try {
        const proc = tempGen.createProcessor(
          {supportedCatalogIds: [catalog.id]},
          new ExpressFormatFactory({surfaceId: 'default'}),
        );
        proc.parseResponse(wrapped);
      } catch (e) {
        throw new Error(`Failed to validate example ${file} (express): ${e}`);
      }
      exampleBlocks[basename] = wrapped;
    }
  }

  const formattedBlocks = files.map(f => {
    const basename = path.parse(f).name;
    const content = exampleBlocks[basename];
    return `---BEGIN ${basename}---\n${content}\n---END ${basename}---`;
  });

  const catalogExamplesString = formattedBlocks.join('\n\n');
  return {exampleBlocks, catalogExamplesString};
}

/** Converts a ResponsePart to A2A Parts wrapping each A2UI message in a DataPart. */
export function convertResponsePartToA2aParts(part: ResponsePart, mimeType: string): Part[] {
  if (part.type === 'text') {
    const tp: TextPart = {kind: 'text', text: part.text};
    return [tp];
  }
  return part.a2ui.map(
    (msg): DataPart => ({
      kind: 'data',
      data: msg as unknown as Record<string, unknown>,
      metadata: {mimeType},
    }),
  );
}

/**
 * LRU cache for DirectJsonStreamProcessorImpl instances keyed by contextId.
 */
class ParserLruCache {
  private readonly map = new Map<string, DirectJsonStreamProcessorImpl>();
  constructor(private readonly maxEntries = 1000) {}

  getOrCreate(
    contextId: string,
    factory: () => DirectJsonStreamProcessorImpl,
  ): DirectJsonStreamProcessorImpl {
    const existing = this.map.get(contextId);
    if (existing) {
      this.map.delete(contextId);
      this.map.set(contextId, existing);
      return existing;
    }
    const created = factory();
    this.map.set(contextId, created);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    return created;
  }
}

export class RestaurantExecutor implements AgentExecutor {
  private readonly catalog = basicCatalog(this.config.version);
  private readonly generator: A2uiGenerator;
  private readonly loadedExamples: LoadedExamples;
  private readonly parserCache = new ParserLruCache(1000);
  private readonly sessionChats = new Map<string, Chat>();
  private readonly mimeType: string;

  constructor(
    public readonly config: SampleConfig = resolveSampleConfig(),
    public readonly port: number = 10002,
    private readonly pythonSampleDir: string = resolvePythonSampleDir(),
  ) {
    verifyPythonSampleAssets(this.pythonSampleDir);
    this.loadedExamples = loadAndValidateExamples(this.config);

    this.mimeType =
      this.config.version === 'v0.9' ? 'application/json+a2ui' : 'application/a2ui+json';

    const basicConf = new CatalogConfig(this.catalog);
    const examplesMap = {[this.catalog.id]: this.loadedExamples.catalogExamplesString};

    if (this.config.format === 'express') {
      this.generator = new A2uiGenerator(
        [basicConf],
        examplesMap,
        new ExpressFormatFactory({surfaceId: 'default'}),
      );
    } else {
      this.generator = new A2uiGenerator([basicConf], examplesMap);
    }
  }

  private createProcessor(): A2uiRequestProcessor {
    if (this.config.format === 'express') {
      return this.generator.createProcessor(
        {supportedCatalogIds: [this.catalog.id]},
        new ExpressFormatFactory({surfaceId: 'default'}),
      );
    }
    return this.generator.createProcessor({supportedCatalogIds: [this.catalog.id]});
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const {taskId, contextId, userMessage, task} = requestContext;

    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {state: 'submitted', timestamp: new Date().toISOString()},
        history: [userMessage],
      };
      eventBus.publish(initialTask);
    }

    // --- Extension Negotiation ---
    const configuredUri = `https://a2ui.org/a2a-extension/a2ui/${this.config.version}`;
    const requestedA2uiUris: string[] = [];

    const callContext = requestContext.context;
    if (callContext?.requestedExtensions) {
      for (const ext of callContext.requestedExtensions) {
        if (typeof ext === 'string' && ext.startsWith('https://a2ui.org/a2a-extension/a2ui')) {
          requestedA2uiUris.push(ext);
        }
      }
    }
    if (userMessage.extensions) {
      for (const ext of userMessage.extensions) {
        if (typeof ext === 'string' && ext.startsWith('https://a2ui.org/a2a-extension/a2ui')) {
          if (!requestedA2uiUris.includes(ext)) {
            requestedA2uiUris.push(ext);
          }
        }
      }
    }

    if (requestedA2uiUris.length > 0) {
      if (requestedA2uiUris.includes(configuredUri)) {
        callContext?.addActivatedExtension(configuredUri);
      } else {
        console.warn(
          `Client requested A2UI extensions [${requestedA2uiUris.join(', ')}], but this agent is configured for ${configuredUri}. Failing task.`,
        );
        const failMessage: Message = {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          taskId,
          contextId,
          parts: [
            {
              kind: 'text',
              text: `This agent serves A2UI ${this.config.version} (format: ${this.config.format}). The client requested [${requestedA2uiUris.join(', ')}]. Start the agent with A2UI_VERSION=${requestedA2uiUris[0].split('/').pop()} to serve that version.`,
            },
          ],
        };
        const failEvent: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
            message: failMessage,
          },
          final: true,
        };
        eventBus.publish(failEvent);
        return;
      }
    } else {
      console.warn(
        `Warning: No A2UI extension requested by client; defaulting to configured A2UI version ${this.config.version}.`,
      );
    }

    // --- Inbound Message Parsing ---
    let useStreaming = true;
    let uiEventPart: Record<string, unknown> | undefined;

    if (userMessage.parts) {
      for (const part of userMessage.parts) {
        if ('data' in part && typeof part.data === 'object' && part.data !== null) {
          const dataMap = part.data as Record<string, unknown>;
          if (typeof dataMap.useStreaming === 'boolean') {
            useStreaming = dataMap.useStreaming;
          }
          if (
            dataMap.version === this.config.version &&
            dataMap.action &&
            typeof dataMap.action === 'object'
          ) {
            uiEventPart = dataMap.action as Record<string, unknown>;
          } else if (dataMap.userAction && typeof dataMap.userAction === 'object') {
            uiEventPart = dataMap.userAction as Record<string, unknown>;
          }
        }
      }
    }

    let query = '';
    let actionName: string | undefined;

    if (uiEventPart) {
      actionName = typeof uiEventPart.name === 'string' ? uiEventPart.name : undefined;
      const ctx =
        typeof uiEventPart.context === 'object' && uiEventPart.context !== null
          ? (uiEventPart.context as Record<string, unknown>)
          : {};

      if (actionName === 'book_restaurant') {
        const restaurantName = (ctx.restaurantName as string) ?? 'Unknown Restaurant';
        const address = (ctx.address as string) ?? 'Address not provided';
        const imageUrl = (ctx.imageUrl as string) ?? '';
        query = `USER_WANTS_TO_BOOK: ${restaurantName}, Address: ${address}, ImageURL: ${imageUrl}`;
      } else if (actionName === 'submit_booking') {
        const restaurantName = (ctx.restaurantName as string) ?? 'Unknown Restaurant';
        const partySize = ctx.partySize !== undefined ? String(ctx.partySize) : 'Unknown Size';
        const reservationTime = (ctx.reservationTime as string) ?? 'Unknown Time';
        const dietary = (ctx.dietary as string) ?? 'None';
        const imageUrl = (ctx.imageUrl as string) ?? '';
        query = `User submitted a booking for ${restaurantName} for ${partySize} people at ${reservationTime} with dietary requirements: ${dietary}. The image URL is ${imageUrl}`;
      } else {
        query = `User submitted an event: ${actionName} with data: ${JSON.stringify(ctx)}`;
      }
    } else {
      const texts: string[] = [];
      if (userMessage.parts) {
        for (const part of userMessage.parts) {
          if ('text' in part && typeof part.text === 'string' && part.text) {
            texts.push(part.text);
          }
        }
      }
      query = texts.join('') || 'Hello!';
    }

    // Publish initial working status-update
    const workingEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {state: 'working', timestamp: new Date().toISOString()},
      final: false,
    };
    eventBus.publish(workingEvent);

    const publishWorkingBatch = (parts: Part[]) => {
      if (parts.length === 0) return;
      const intermediateEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'working',
          timestamp: new Date().toISOString(),
          message: {
            kind: 'message',
            role: 'agent',
            messageId: crypto.randomUUID(),
            taskId,
            contextId,
            parts,
          },
        },
        final: false,
      };
      eventBus.publish(intermediateEvent);
    };

    const isStub = resolveLlmMode() === 'stub';
    let partsStreamed = false;
    let finalParts: Part[] = [];

    if (isStub) {
      console.log('Using stub LLM response...');
      const stubKey =
        actionName === 'book_restaurant'
          ? 'booking_form'
          : actionName === 'submit_booking'
            ? 'confirmation'
            : 'single_column_list';

      const stubContent = this.loadedExamples.exampleBlocks[stubKey];

      if (this.config.format === 'direct_json') {
        const streamProcessor = this.parserCache.getOrCreate(
          contextId,
          () =>
            new DirectJsonStreamProcessorImpl(this.catalog, {
              progressiveKeys: ['text', 'literalString'],
            }),
        );
        const stubResponse = `<a2ui-json>\n${stubContent}\n</a2ui-json>`;
        const chunkSize = Math.ceil(stubResponse.length / 4);
        const chunks = [
          stubResponse.substring(0, chunkSize),
          stubResponse.substring(chunkSize, chunkSize * 2),
          stubResponse.substring(chunkSize * 2, chunkSize * 3),
          stubResponse.substring(chunkSize * 3),
        ];

        for (const chunk of chunks) {
          const parts = streamProcessor.processChunk(chunk);
          if (parts.length > 0) {
            const a2aParts = parts.flatMap(p => convertResponsePartToA2aParts(p, this.mimeType));
            if (a2aParts.length > 0) {
              partsStreamed = true;
              if (useStreaming) {
                publishWorkingBatch(a2aParts);
              }
            }
          }
        }
        const freshProcessor = this.createProcessor();
        const validated = freshProcessor.parseResponse(stubResponse);
        finalParts = validated.flatMap(p => convertResponsePartToA2aParts(p, this.mimeType));
      } else {
        const freshProcessor = this.createProcessor();
        const validated = freshProcessor.parseResponse(stubContent);
        const a2aParts = validated.flatMap(p => convertResponsePartToA2aParts(p, this.mimeType));
        if (useStreaming) {
          partsStreamed = true;
          publishWorkingBatch(a2aParts);
        }
        finalParts = a2aParts;
      }
    } else {
      // Live model execution
      const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
      const modelName = process.env.MODEL_NAME?.trim() || 'gemini-2.5-flash';

      const initialProcessor = this.createProcessor();
      const systemInstruction = initialProcessor.generatePrompt({
        roleDescription: ROLE_DESCRIPTION,
        uiDescription: getUiDescription(this.config.format),
        includeSchema: true,
        includeExamples: true,
      });

      let chat = this.sessionChats.get(contextId);
      if (!chat) {
        chat = ai.chats.create({
          model: modelName,
          config: {
            systemInstruction,
            tools: [{functionDeclarations: [getRestaurantsDeclaration]}],
          },
        });
        this.sessionChats.set(contextId, chat);
      }

      const streamProcessor =
        this.config.format === 'direct_json'
          ? this.parserCache.getOrCreate(
              contextId,
              () =>
                new DirectJsonStreamProcessorImpl(this.catalog, {
                  progressiveKeys: ['text', 'literalString'],
                }),
            )
          : null;

      const maxRetries = 1;
      let attempt = 0;
      let currentQueryText = query;
      let isValid = false;

      while (attempt <= maxRetries) {
        attempt++;
        console.log(`--- RestaurantExecutor: Attempt ${attempt}/${maxRetries + 1} ---`);

        let currentTurnInput: PartListUnion = currentQueryText;
        let turnComplete = false;
        const fullContentList: string[] = [];

        while (!turnComplete) {
          const responseStream = await chat.sendMessageStream({message: currentTurnInput});
          const pendingToolCalls: FunctionCall[] = [];

          for await (const chunk of responseStream) {
            if (chunk.text) {
              fullContentList.push(chunk.text);
              if (streamProcessor && this.config.format === 'direct_json') {
                const parts = streamProcessor.processChunk(chunk.text);
                if (parts.length > 0) {
                  const a2aParts = parts.flatMap(p =>
                    convertResponsePartToA2aParts(p, this.mimeType),
                  );
                  if (a2aParts.length > 0) {
                    partsStreamed = true;
                    if (useStreaming) {
                      publishWorkingBatch(a2aParts);
                    }
                  }
                }
              }
            }
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              pendingToolCalls.push(...chunk.functionCalls);
            }
          }

          if (pendingToolCalls.length > 0) {
            const baseUrl = `http://localhost:${this.port}`;
            currentTurnInput = pendingToolCalls.map(fc => {
              const args = (fc.args ?? {}) as Record<string, unknown>;
              const result = executeGetRestaurants(args, baseUrl, this.pythonSampleDir);
              return {
                functionResponse: {
                  name: fc.name ?? 'get_restaurants',
                  response: {result},
                },
              };
            });
          } else {
            turnComplete = true;
          }
        }

        const fullText = fullContentList.join('');

        // Validation using a fresh processor
        const freshProc = this.createProcessor();
        try {
          const validated = freshProc.parseResponse(fullText);
          const a2aParts = validated.flatMap(p => convertResponsePartToA2aParts(p, this.mimeType));
          if (this.config.format === 'express' && useStreaming) {
            publishWorkingBatch(a2aParts);
            partsStreamed = true;
          }
          finalParts = a2aParts;
          isValid = true;
          break;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.warn(`--- A2UI validation failed: ${errMsg} (Attempt ${attempt}) ---`);
          if (attempt <= maxRetries) {
            currentQueryText =
              this.config.format === 'direct_json'
                ? `Your previous response was invalid. Validation failed: ${errMsg}. You MUST generate a valid response that strictly follows the A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI messages. Ensure each JSON part is wrapped in '<a2ui-json>' and '</a2ui-json>' tags. Please retry the original request: '${query}'`
                : `Your previous response was invalid. Validation failed: ${errMsg}. You MUST generate a valid response that is valid A2UI Express wrapped in the '<a2ui-express>' and '</a2ui-express>' tags. Please retry the original request: '${query}'`;
          }
        }
      }

      if (!isValid) {
        console.error('--- Max retries exhausted. Sending text-only error. ---');
        finalParts = [
          {
            kind: 'text',
            text: "I'm sorry, I'm having trouble generating the interface for that request right now. Please try again in a moment.",
          },
        ];
        partsStreamed = false;
      }
    }

    // Terminal status-update
    const finalState = actionName === 'submit_booking' ? 'completed' : 'input-required';
    const omitParts = useStreaming && partsStreamed;

    const finalStatus: TaskStatusUpdateEvent['status'] = {
      state: finalState,
      timestamp: new Date().toISOString(),
      ...(omitParts
        ? {}
        : {
            message: {
              kind: 'message',
              role: 'agent',
              messageId: crypto.randomUUID(),
              taskId,
              contextId,
              parts: finalParts,
            },
          }),
    };

    const finalEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: finalStatus,
      final: true,
    };
    eventBus.publish(finalEvent);
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log('Cancellation requested for', taskId);
  }
}

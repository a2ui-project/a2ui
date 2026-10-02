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

import type {Part} from '@a2a-js/sdk';
import type {AgentExecutor, ExecutionEventBus, RequestContext} from '@a2a-js/sdk/server';
import {
  A2uiGenerator,
  A2uiRequestProcessor,
  CatalogConfig,
  DirectJsonStreamProcessorImpl,
  ExpressFormatFactory,
} from '@a2ui/agent';

import {TaskEvents, toA2aParts} from './a2a.js';
import type {BasicCatalogs} from './catalogs.js';
import type {A2uiFormat} from './config.js';
import {loadExamples} from './examples.js';
import {LruCache} from './lru_cache.js';
import type {ModelBackend, TurnInput} from './model.js';
import {pickA2ui} from './pick_a2ui.js';
import {buildSystemPrompt, FALLBACK_TEXT, retryQuery} from './prompt.js';
import {parseUserQuery} from './user_query.js';
import {VERSIONS, type VersionProfile} from './versions.js';

/** How many times a turn is tried: once, plus one retry after a validation failure, as in Python. */
const MAX_ATTEMPTS = 2;

/**
 * Answers restaurant requests with A2UI, in the version the renderer asks for.
 *
 * The A2A SDK calls `execute` once per incoming message. `run` holds the steps of one
 * turn, so start reading there; the private methods after it do the work of each step.
 */
export class RestaurantExecutor implements AgentExecutor {
  /** One generator per served version, holding its basic catalog and examples. */
  private readonly generators = new Map<string, A2uiGenerator>();
  /**
   * Direct JSON stream processors per conversation and version. A processor remembers
   * which surfaces, components and data it has already streamed, and skips them in later
   * turns, so it has to live as long as the conversation, as in the Python sample.
   */
  private readonly streamProcessors = new LruCache<DirectJsonStreamProcessorImpl>(1000);

  constructor(
    private readonly format: A2uiFormat,
    private readonly backend: ModelBackend,
    private readonly catalogs: BasicCatalogs,
  ) {
    for (const profile of VERSIONS) {
      const catalog = catalogs.get(profile.version)!;
      const examples = loadExamples(profile, catalog, format);
      this.generators.set(
        profile.version,
        new A2uiGenerator([new CatalogConfig(catalog)], {
          [catalog.id]: examples.catalogExamplesString,
        }),
      );
    }
  }

  /** Entry point for each incoming message; reports any error as a failed task. */
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

  /** The steps of one turn: the part of this sample to read first. */
  private async run({contextId, userMessage}: RequestContext, events: TaskEvents): Promise<void> {
    events.start();

    // 1. Pick the version and catalogs from the renderer's capabilities.
    const {profile, catalogIds} = pickA2ui(userMessage);
    // 2. Turn the message, or the UI action it carries, into a query.
    const {query, actionName, useStreaming} = parseUserQuery(userMessage, profile);
    const systemPrompt = this.buildSystemPrompt(profile, catalogIds);
    events.status('working', false);

    // 3-5. Generate the UI, publishing parts as they arrive when the client streams.
    const publish = useStreaming
      ? (parts: Part[]) => events.status('working', false, parts)
      : undefined;
    const turn = {contextId, query, actionName, profile, systemPrompt};
    const {parts, published} = await this.generateUi(turn, catalogIds, publish);

    // 6. End the turn. Published parts are not repeated in the final status.
    const finalState = actionName === 'submit_booking' ? 'completed' : 'input-required';
    events.status(finalState, true, published ? [] : parts);
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log('Cancellation requested for', taskId);
  }

  /** Builds the system prompt. Creating the processor also rejects unknown catalogs. */
  private buildSystemPrompt(profile: VersionProfile, catalogIds: string[]): string {
    const {promptSnippet} = this.createProcessor(profile, catalogIds);
    return buildSystemPrompt(this.format, promptSnippet);
  }

  /**
   * Asks the backend for A2UI and validates it, retrying once with the validation error,
   * as the Python sample does. Answers with a text apology when every attempt fails.
   */
  private async generateUi(
    turn: TurnInput,
    catalogIds: string[],
    publish?: (parts: Part[]) => void,
  ): Promise<{parts: Part[]; published: boolean}> {
    let published = false;
    const track = publish
      ? (parts: Part[]) => {
          published = true;
          publish(parts);
        }
      : undefined;

    let query = turn.query;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      console.log(`--- RestaurantExecutor: Attempt ${attempt + 1}/${MAX_ATTEMPTS} ---`);
      const fullText = await this.streamText({...turn, query}, track);
      try {
        const parts = this.validate(fullText, turn.profile, catalogIds);
        // Express is parsed only once the whole response is in, so its parts go out now.
        if (this.format === 'express') {
          track?.(parts);
        }
        return {parts, published};
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn(`--- A2UI validation failed: ${error} (Attempt ${attempt + 1}) ---`);
        query = retryQuery(this.format, error, turn.query);
      }
    }

    console.error('--- Max retries exhausted. Sending text-only error. ---');
    return {parts: [{kind: 'text', text: FALLBACK_TEXT}], published: false};
  }

  /** Streams one attempt's text. In Direct JSON, parts are published as they arrive. */
  private async streamText(turn: TurnInput, publish?: (parts: Part[]) => void): Promise<string> {
    const processor = this.streamProcessorFor(turn.contextId, turn.profile);
    let fullText = '';
    for await (const chunk of this.backend.streamTurn(turn)) {
      fullText += chunk;
      const parts = (processor?.processChunk(chunk) ?? []).flatMap(toA2aParts);
      if (parts.length > 0) {
        publish?.(parts);
      }
    }
    return fullText;
  }

  /** Returns the conversation's Direct JSON stream processor; Express does not stream. */
  private streamProcessorFor(
    contextId: string,
    profile: VersionProfile,
  ): DirectJsonStreamProcessorImpl | undefined {
    if (this.format !== 'direct_json') {
      return undefined;
    }
    return this.streamProcessors.getOrCreate(
      `${contextId}:${profile.version}`,
      () =>
        new DirectJsonStreamProcessorImpl([this.catalogs.get(profile.version)!], {
          progressiveKeys: ['text', 'literalString'],
        }),
    );
  }

  /**
   * Validates the full text with a fresh processor and returns its A2A parts.
   *
   * A reply with no A2UI fails too, so it is retried like an invalid one, as in the
   * Python sample. The Direct JSON parser already rejects a reply without its tags, but
   * the Express parser returns it as a text part.
   */
  private validate(fullText: string, profile: VersionProfile, catalogIds: string[]): Part[] {
    const parts = this.createProcessor(profile, catalogIds)
      .parseResponse(fullText)
      .flatMap(toA2aParts);
    if (!parts.some(part => part.kind === 'data')) {
      throw new Error('The response contains no A2UI messages');
    }
    return parts;
  }

  /** Creates a processor for one parse; it keeps state, so it is not reused. */
  private createProcessor(profile: VersionProfile, catalogIds: string[]): A2uiRequestProcessor {
    const formatFactory =
      this.format === 'express' ? new ExpressFormatFactory({surfaceId: 'default'}) : undefined;
    return this.generators
      .get(profile.version)!
      .createProcessor({supportedCatalogIds: catalogIds}, formatFactory);
  }
}

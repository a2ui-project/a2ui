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
  basicCatalog,
  CatalogConfig,
  DirectJsonStreamProcessorImpl,
  ExpressFormatFactory,
} from '@a2ui/agent';

import {TaskEvents, toA2aParts} from './a2a.js';
import type {A2uiFormat} from './config.js';
import {loadExamples} from './examples.js';
import {LruCache} from './lru_cache.js';
import type {ModelBackend, TurnInput} from './model.js';
import {pickA2ui} from './pick_a2ui.js';
import {getUiDescription, ROLE_DESCRIPTION} from './prompt.js';
import {parseUserQuery} from './user_query.js';
import {VERSIONS, type VersionProfile} from './versions.js';

/** How many times a turn is retried after its A2UI fails validation, as in Python. */
const MAX_RETRIES = 1;

/** The answer when no attempt produced valid A2UI. */
const FALLBACK_TEXT =
  "I'm sorry, I'm having trouble generating the interface for that request right now. Please try again in a moment.";

/** The follow-up query sent after a response failed validation. */
function retryQuery(format: A2uiFormat, error: string, query: string): string {
  return format === 'direct_json'
    ? `Your previous response was invalid. Validation failed: ${error}. You MUST generate a valid response that strictly follows the A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI messages. Ensure each JSON part is wrapped in '<a2ui-json>' and '</a2ui-json>' tags. Please retry the original request: '${query}'`
    : `Your previous response was invalid. Validation failed: ${error}. You MUST generate a valid response that is valid A2UI Express wrapped in the '<a2ui>' and '</a2ui>' tags. Please retry the original request: '${query}'`;
}

/** Answers restaurant requests with A2UI, in the version the renderer asks for. */
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
  ) {
    for (const profile of VERSIONS) {
      const catalog = basicCatalog(profile.version);
      const examples = loadExamples(profile, format);
      this.generators.set(
        profile.version,
        new A2uiGenerator([new CatalogConfig(catalog)], {
          [catalog.id]: examples.catalogExamplesString,
        }),
      );
    }
  }

  /** Creates a processor for one parse; it keeps state, so it is not reused. */
  private createProcessor(profile: VersionProfile, catalogIds: string[]): A2uiRequestProcessor {
    const formatFactory =
      this.format === 'express' ? new ExpressFormatFactory({surfaceId: 'default'}) : undefined;
    return this.generators
      .get(profile.version)!
      .createProcessor({supportedCatalogIds: catalogIds}, formatFactory);
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

  /** Builds the system prompt. Creating the processor also rejects unknown catalogs. */
  private buildSystemPrompt(profile: VersionProfile, catalogIds: string[]): string {
    return this.createProcessor(profile, catalogIds).generatePrompt({
      roleDescription: ROLE_DESCRIPTION,
      uiDescription: getUiDescription(this.format),
      includeSchema: true,
      includeExamples: true,
    });
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
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      console.log(`--- RestaurantExecutor: Attempt ${attempt}/${MAX_RETRIES + 1} ---`);
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
        console.warn(`--- A2UI validation failed: ${error} (Attempt ${attempt}) ---`);
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
        new DirectJsonStreamProcessorImpl(basicCatalog(profile.version), {
          progressiveKeys: ['text', 'literalString'],
        }),
    );
  }

  /** Validates the full text with a fresh processor and returns its A2A parts. */
  private validate(fullText: string, profile: VersionProfile, catalogIds: string[]): Part[] {
    return this.createProcessor(profile, catalogIds).parseResponse(fullText).flatMap(toA2aParts);
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log('Cancellation requested for', taskId);
  }
}

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
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  type ResponsePart,
} from '@a2ui/agent';

import {readInboundMessage, TaskEvents, toA2aParts} from './a2a.js';
import type {BasicCatalogs} from './catalogs.js';
import type {A2uiFormat} from './config.js';
import {loadExamples} from './examples.js';
import type {ModelBackend, TurnInput} from './model.js';
import {pickA2ui} from './pick-a2ui.js';
import {buildSystemPrompt, FALLBACK_TEXT, retryQuery} from './prompt.js';
import {buildUserQuery} from './user-query.js';
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
    const inbound = readInboundMessage(userMessage, profile.version);
    const {query, actionName, useStreaming} = buildUserQuery(inbound);
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
    let query = turn.query;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      console.log(`--- RestaurantExecutor: Attempt ${attempt + 1}/${MAX_ATTEMPTS} ---`);
      // Tracked per attempt: the final status must carry the parts of the attempt that
      // succeeded unless that attempt published them itself.
      let published = false;
      const track = publish
        ? (parts: Part[]) => {
            published = true;
            publish(parts);
          }
        : undefined;

      try {
        const parts = await this.answer({...turn, query}, catalogIds, track);
        if (!parts.some(part => part.kind === 'data')) {
          throw new Error('The response contains no A2UI messages');
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

  /**
   * Generates one attempt's reply and returns its A2A parts.
   *
   * Each reply shows new UI, so it is checked on its own, against a new renderer state. When
   * the client streams a Direct JSON reply, `openStream` checks each message before it is
   * published, and closing the stream checks the end of the reply. Otherwise, and for
   * Express, which does not stream, `parseResponse` checks the whole reply, and its parts
   * are published at once.
   */
  private async answer(
    turn: TurnInput,
    catalogIds: string[],
    publish?: (parts: Part[]) => void,
  ): Promise<Part[]> {
    const processor = this.createProcessor(turn.profile, catalogIds);
    if (publish && processor.parser.supportsStreaming) {
      const stream = processor.openStream();
      const parts: Part[] = [];
      const send = (ready: ResponsePart[]) => {
        const a2aParts = ready.flatMap(toA2aParts);
        if (a2aParts.length > 0) {
          parts.push(...a2aParts);
          publish(a2aParts);
        }
      };
      for await (const chunk of this.backend.streamTurn(turn)) {
        send(stream.feed(chunk));
      }
      send(stream.close());
      return parts;
    }

    let fullText = '';
    for await (const chunk of this.backend.streamTurn(turn)) {
      fullText += chunk;
    }
    const parts = processor.parseResponse(fullText).flatMap(toA2aParts);
    if (parts.some(part => part.kind === 'data')) {
      publish?.(parts);
    }
    return parts;
  }

  /** Creates a processor negotiated for the request's catalogs. */
  private createProcessor(profile: VersionProfile, catalogIds: string[]): A2uiRequestProcessor {
    const formatFactory =
      this.format === 'express'
        ? new ExpressFormatFactory({surfaceId: 'default'})
        : new DirectJsonFormatFactory();
    return this.generators
      .get(profile.version)!
      .createProcessor({supportedCatalogIds: catalogIds}, formatFactory);
  }
}

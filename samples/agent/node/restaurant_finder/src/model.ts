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

import path from 'path';

import {Chat, FunctionCall, GoogleGenAI, PartListUnion} from '@google/genai';

import type {BasicCatalogs} from './catalogs.js';
import type {A2uiFormat} from './config.js';
import {readMessages, toResponseText} from './examples.js';
import {LruCache} from './lru_cache.js';
import {executeGetRestaurants, getPackageRootDir, getRestaurantsDeclaration} from './tools.js';
import {VERSIONS, type VersionProfile} from './versions.js';

/** One model turn, as the executor asks for it. */
export interface TurnInput {
  contextId: string;
  query: string;
  actionName?: string;
  profile: VersionProfile;
  systemPrompt: string;
}

/** Where the text of a turn comes from: a real model or the canned response. */
export interface ModelBackend {
  /** Streams the model's text for one turn. Tool calls are handled inside. */
  streamTurn(input: TurnInput): AsyncIterable<string>;
}

/** Calls Gemini, keeping one chat per conversation and answering its tool calls. */
export class GeminiBackend implements ModelBackend {
  private readonly client: GoogleGenAI;
  private readonly chats = new LruCache<Chat>(1000);

  constructor(
    private readonly options: {
      apiKey: string;
      modelName: string;
      /** Base URL the restaurant image links should point at. */
      baseUrl: string;
      pythonSampleDir: string;
    },
  ) {
    this.client = new GoogleGenAI({apiKey: options.apiKey});
  }

  async *streamTurn({contextId, query, profile, systemPrompt}: TurnInput): AsyncIterable<string> {
    // The system prompt differs by version, so a conversation gets one chat per version.
    const chat = this.chats.getOrCreate(`${contextId}:${profile.version}`, () =>
      this.client.chats.create({
        model: this.options.modelName,
        config: {
          systemInstruction: systemPrompt,
          tools: [{functionDeclarations: [getRestaurantsDeclaration]}],
        },
      }),
    );

    let input: PartListUnion = query;
    while (true) {
      const responseStream = await chat.sendMessageStream({message: input});
      const toolCalls: FunctionCall[] = [];
      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield chunk.text;
        }
        toolCalls.push(...(chunk.functionCalls ?? []));
      }
      if (toolCalls.length === 0) {
        return;
      }
      input = toolCalls.map(fc => ({
        functionResponse: {
          name: fc.name ?? 'get_restaurants',
          response: {
            result: executeGetRestaurants(
              (fc.args ?? {}) as Record<string, unknown>,
              this.options.baseUrl,
              this.options.pythonSampleDir,
            ),
          },
        },
      }));
    }
  }
}

/**
 * Answers without a model. Each turn is the stub notice (a separate `stub-notice`
 * surface saying no model was called) followed by the example that matches the action,
 * written in the configured format and cut into four chunks like a model stream.
 */
export class StubBackend implements ModelBackend {
  /** Response text by version, then by example name. */
  private readonly responses = new Map<string, Record<string, string>>();

  constructor(
    format: A2uiFormat,
    catalogs: BasicCatalogs,
    packageRoot: string = getPackageRootDir(),
  ) {
    for (const profile of VERSIONS) {
      const catalog = catalogs.get(profile.version)!;
      const notice = readMessages(path.join(packageRoot, 'stub_notice', `${profile.version}.json`));
      const byExample: Record<string, string> = {};
      for (const name of ['single_column_list', 'booking_form', 'confirmation']) {
        const example = readMessages(
          path.join(packageRoot, 'examples', profile.version, `${name}.json`),
        );
        byExample[name] = toResponseText(profile, catalog, format, [...notice, ...example]);
      }
      this.responses.set(profile.version, byExample);
    }
  }

  async *streamTurn({actionName, profile}: TurnInput): AsyncIterable<string> {
    console.log('Using stub LLM response...');
    const exampleName =
      actionName === 'book_restaurant'
        ? 'booking_form'
        : actionName === 'submit_booking'
          ? 'confirmation'
          : 'single_column_list';
    const text = this.responses.get(profile.version)![exampleName];
    const chunkSize = Math.ceil(text.length / 4);
    for (let start = 0; start < text.length; start += chunkSize) {
      yield text.substring(start, start + chunkSize);
    }
  }
}

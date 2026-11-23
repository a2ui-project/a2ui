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

/** The language model behind the recommendations, behind an interface tests can fake. */

import {GoogleGenAI} from '@google/genai';

import {parseModelJson} from './lenient_json.js';

/** A request for a JSON answer. */
export interface JsonRequest {
  readonly system: string;
  readonly prompt: string;
  /** JSON schema of the answer, for structured output. */
  readonly schema?: Record<string, unknown>;
  /** Aborts the request when the server's time budget runs out. */
  readonly signal?: AbortSignal;
}

/** A model that answers a prompt with a JSON value. */
export interface JsonModel {
  generateJson(request: JsonRequest): Promise<unknown>;
}

/** Default Gemini model; `gemini-2.5-flash` is not available to every key. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

/** Thinking budget: enough to weigh calendar conflicts, fast enough for a 40 s budget. */
export const THINKING_BUDGET = 1024;

/** Whether `error` is a temporary overload (HTTP 429 or 503), worth retrying. */
export function isTransient(error: unknown): boolean {
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(String(error));
}

/** Runs `request`, retrying after 1 s and 3 s on temporary overloads, unless aborted. */
export async function withRetries<T>(
  request: () => Promise<T>,
  signal?: AbortSignal,
  delays: readonly number[] = [1000, 3000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isTransient(error) || signal?.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/** A {@link JsonModel} backed by Gemini through `@google/genai`. */
export class GeminiJsonModel implements JsonModel {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model = DEFAULT_GEMINI_MODEL,
  ) {
    this.client = new GoogleGenAI({apiKey});
  }

  async generateJson({system, prompt, schema, signal}: JsonRequest): Promise<unknown> {
    const response = await withRetries(
      () =>
        this.client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            ...(schema ? {responseJsonSchema: schema} : {}),
            temperature: 0.2,
            thinkingConfig: {thinkingBudget: THINKING_BUDGET},
            ...(signal ? {abortSignal: signal} : {}),
          },
        }),
      signal,
    );
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return parseModelJson(text);
  }
}

/** A Gemini model when `GEMINI_API_KEY` is set (with `GEMINI_MODEL` when set), else `undefined`. */
export function geminiModelFromEnv(env: NodeJS.ProcessEnv = process.env): JsonModel | undefined {
  const apiKey = env['GEMINI_API_KEY']?.trim();
  if (!apiKey) return undefined;
  return new GeminiJsonModel(apiKey, env['GEMINI_MODEL']?.trim() || DEFAULT_GEMINI_MODEL);
}

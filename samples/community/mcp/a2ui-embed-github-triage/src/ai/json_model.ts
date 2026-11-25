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

/** The language model `suggest_triage` uses, behind an interface tests can fake. */

import {GoogleGenAI} from '@google/genai';

/** A request for a JSON answer. */
export interface JsonRequest {
  readonly system: string;
  readonly prompt: string;
}

/** A model that answers a prompt with a JSON value. */
export interface JsonModel {
  generateJson(request: JsonRequest): Promise<unknown>;
}

/** Default Gemini model; `gemini-2.5-flash` is not available to every key. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

/** Whether `error` is a temporary overload (HTTP 429 or 503), worth retrying. */
export function isTransient(error: unknown): boolean {
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(String(error));
}

/** Runs `request`, retrying twice after 1 s and 3 s on temporary overloads. */
export async function withRetries<T>(
  request: () => Promise<T>,
  delays: readonly number[] = [1000, 3000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isTransient(error)) throw error;
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

  async generateJson({system, prompt}: JsonRequest): Promise<unknown> {
    const response = await withRetries(() =>
      this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {systemInstruction: system, responseMimeType: 'application/json', temperature: 0},
      }),
    );
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return JSON.parse(text) as unknown;
  }
}

/** A Gemini model when `GEMINI_API_KEY` is set (with `GEMINI_MODEL` when set), else `undefined`. */
export function geminiModelFromEnv(env: NodeJS.ProcessEnv = process.env): JsonModel | undefined {
  const apiKey = env['GEMINI_API_KEY']?.trim();
  if (!apiKey) return undefined;
  return new GeminiJsonModel(apiKey, env['GEMINI_MODEL']?.trim() || DEFAULT_GEMINI_MODEL);
}

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

/** The language model `explain` uses, behind an interface tests can fake. */

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

/** Default Gemini model for `explain`. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

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
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {systemInstruction: system, responseMimeType: 'application/json', temperature: 0},
    });
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return JSON.parse(text) as unknown;
  }
}

/**
 * Returns a Gemini model when `GEMINI_API_KEY` is set, using `GEMINI_MODEL`
 * when set, or `undefined` without a key.
 */
export function geminiModelFromEnv(env: NodeJS.ProcessEnv = process.env): JsonModel | undefined {
  const apiKey = env['GEMINI_API_KEY']?.trim();
  if (!apiKey) return undefined;
  return new GeminiJsonModel(apiKey, env['GEMINI_MODEL']?.trim() || DEFAULT_GEMINI_MODEL);
}

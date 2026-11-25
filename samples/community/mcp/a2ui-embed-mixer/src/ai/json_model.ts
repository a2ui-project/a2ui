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

/** Gemini JSON model wrapper (`gemini-flash-latest`) with timeout and transient retry support. */

import {GoogleGenAI} from '@google/genai';

import {parseModelJson} from './lenient_json.js';

export interface JsonRequest {
  readonly system: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
}

export interface JsonModel {
  generateJson(request: JsonRequest): Promise<unknown>;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const THINKING_BUDGET = 1024;

function isTransientError(error: unknown): boolean {
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(String(error));
}

async function withRetries<T>(
  op: () => Promise<T>,
  signal?: AbortSignal,
  delays: readonly number[] = [800, 2000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isTransientError(error) || signal?.aborted) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export class GeminiJsonModel implements JsonModel {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly modelName = DEFAULT_GEMINI_MODEL,
  ) {
    this.client = new GoogleGenAI({apiKey});
  }

  async generateJson({system, prompt, signal}: JsonRequest): Promise<unknown> {
    const response = await withRetries(
      () =>
        this.client.models.generateContent({
          model: this.modelName,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            temperature: 0.2,
            thinkingConfig: {thinkingBudget: THINKING_BUDGET},
            ...(signal ? {abortSignal: signal} : {}),
          },
        }),
      signal,
    );
    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return parseModelJson(text);
  }
}

export function geminiModelFromEnv(env: NodeJS.ProcessEnv = process.env): JsonModel | undefined {
  if (env['A2UI_E2E_NO_AI'] === '1') return undefined;
  const apiKey = env['GEMINI_API_KEY']?.trim();
  if (!apiKey) return undefined;
  return new GeminiJsonModel(apiKey, env['GEMINI_MODEL']?.trim() || DEFAULT_GEMINI_MODEL);
}

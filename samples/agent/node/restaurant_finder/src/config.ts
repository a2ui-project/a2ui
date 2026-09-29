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

/** The text format the model writes A2UI in. */
export type A2uiFormat = 'direct_json' | 'express';

/**
 * Resolves the A2UI format from `A2UI_FORMAT`.
 * Fails fast if the variable is set to an unsupported value.
 */
export function resolveSampleConfig(env: NodeJS.ProcessEnv = process.env): {format: A2uiFormat} {
  const rawFormat = env.A2UI_FORMAT?.trim();
  let format: A2uiFormat = 'direct_json';
  if (rawFormat !== undefined && rawFormat !== '') {
    if (rawFormat !== 'direct_json' && rawFormat !== 'express') {
      throw new Error(
        `A2UI_FORMAT must be "direct_json" or "express", but it is "${env.A2UI_FORMAT}". Allowed values are "direct_json", "express".`,
      );
    }
    format = rawFormat;
  }
  return {format};
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

/** Returns the Gemini model to call, from `MODEL_NAME` or the sample's default. */
export function resolveModelName(env: NodeJS.ProcessEnv = process.env): string {
  return env.MODEL_NAME?.trim() || 'gemini-3.6-flash';
}

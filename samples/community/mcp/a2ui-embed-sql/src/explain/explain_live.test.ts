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

/**
 * Live test against Gemini and the Chinook database. Skipped unless
 * GEMINI_API_KEY is set (in the environment or .env) and `yarn fetch-data`
 * has run.
 */

import {existsSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {createSqlTools, databasePath} from '../app.js';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env file: rely on the environment.
}
const enabled = Boolean(process.env['GEMINI_API_KEY']) && existsSync(databasePath());

describe.skipIf(!enabled)('explain (live Gemini)', () => {
  it('answers a question with a validated view', {timeout: 120_000}, async () => {
    const tools = createSqlTools();
    const output = await tools.explain('What are the top 5 genres by revenue?');
    expect(output.text).toContain('Query returned');
    expect(output.a2ui.length).toBe(3);
  });
});

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

/** Calls Gemini for real; skipped without GEMINI_API_KEY (in the environment or .env). */

import {describe, expect, it} from 'vitest';

import {loadEnvFile} from '../config.js';
import {FixtureGitHub} from '../github/fixture.js';
import {LABELS, syntheticSnapshot, USERS} from '../testing/synthetic_snapshot.js';
import {geminiModelFromEnv} from './json_model.js';
import {suggestTriage} from './suggest.js';

const env = {...process.env};
loadEnvFile(env);
const model = geminiModelFromEnv(env);

describe.skipIf(!model)('suggestTriage with Gemini', () => {
  it('suggests a priority for a crash report', async () => {
    const github = new FixtureGitHub(syntheticSnapshot());
    const issue = await github.getIssue(110);
    const comments = await github.listComments(110);
    const [suggestion] = await suggestTriage(model!, [{issue, comments}], {
      labels: LABELS,
      assignees: [USERS.alice, USERS.bob],
    });
    expect(suggestion?.number).toBe(110);
    expect(['P0', 'P1', 'P2', 'P3']).toContain(suggestion?.priority);
    expect(suggestion?.rationale.length).toBeGreaterThan(0);
  }, 60_000);
});

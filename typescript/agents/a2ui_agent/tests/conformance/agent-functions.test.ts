/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, expect, test} from 'vitest';

import {classify, loadCases} from './loader.js';
import {conformancePath} from './suite-helpers.js';

/**
 * `agent_functions.yaml` covers agent functions and the agent's calls to renderer functions,
 * which this SDK does not implement yet. Every case is registered as skipped with the reason
 * `classify` gives, so the gap shows in the test report, and a case with an action that has
 * no reason fails instead of passing without running.
 */
describe('Conformance: agent_functions.yaml', () => {
  const cases = loadCases([conformancePath('agent/agent_functions.yaml')]);

  test('suite is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    const title = `${testCase.action} · ${testCase.name}`;
    const verdict = classify(testCase);
    const run = () => {
      throw new Error(`Unhandled conformance action: ${testCase.action}`);
    };
    if (verdict.runnable) {
      test(title, run);
    } else {
      test.skip(`${title} (${verdict.reason})`, run);
    }
  }
});

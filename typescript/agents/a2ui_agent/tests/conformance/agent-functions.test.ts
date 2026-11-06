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

import {expect, test} from 'vitest';

import {classify, loadCases} from './loader.js';
import {conformancePath, describeSuite} from './suite-helpers.js';

/**
 * `agent_functions.yaml` covers agent functions and the routing of renderer messages,
 * which this SDK does not implement yet. Every case is registered as skipped with the reason
 * `classify` gives, and recorded so in the executed-case manifest, so the gap shows in the
 * test report. A case with an action that has no reason fails instead of passing without
 * running.
 */
const cases = loadCases([conformancePath('agent/agent_functions.yaml')]);

test('agent_functions.yaml is not empty', () => {
  expect(cases.length).toBeGreaterThan(0);
});

describeSuite(
  'Conformance: agent_functions.yaml',
  cases,
  testCase => {
    throw new Error(`Unhandled conformance action: ${testCase.action}`);
  },
  {
    skipReason: testCase => {
      const verdict = classify(testCase);
      return verdict.runnable ? undefined : verdict.reason;
    },
  },
);

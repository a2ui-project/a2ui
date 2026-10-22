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

import {describe, test} from 'vitest';

import {classify, KNOWN_FAILURES, loadCases, LoadedCase} from './loader.js';
import {conformancePath} from './suite-helpers.js';

const SKILL_ACTION_HANDLERS: Record<string, (testCase: LoadedCase) => void | Promise<void>> = {};

describe('Conformance: skill.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/skill.yaml')])) {
    const verdict = classify(testCase);
    const {action, name} = testCase;
    const testName = `${action} · ${name}`;

    const testFn = async () => {
      const handler = SKILL_ACTION_HANDLERS[action];
      if (!handler) {
        throw new Error(`Unhandled conformance action: ${action}`);
      }
      await handler(testCase);
    };

    if (!verdict.runnable) {
      test.skip(`${testName} (${verdict.reason})`, testFn);
    } else if (KNOWN_FAILURES.has(name)) {
      test.fails(`${testName} (known gap: ${KNOWN_FAILURES.get(name)})`, testFn);
    } else {
      test(testName, testFn);
    }
  }
});

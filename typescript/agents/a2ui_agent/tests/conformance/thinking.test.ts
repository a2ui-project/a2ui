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

import {describe, expect} from 'vitest';

import {removeA2uiThinking} from '../../src/index.js';
import {loadCases} from './loader.js';
import {conformancePath, registerCase} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>([]);

describe('Conformance: thinking.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/thinking.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, () => {
      expect(testCase.action).toBe('remove_a2ui_thinking');
      expect(removeA2uiThinking(testCase.input as string)).toBe(testCase.expect);
    });
  }
});

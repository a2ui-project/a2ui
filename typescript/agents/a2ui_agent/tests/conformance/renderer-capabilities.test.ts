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

import {expect} from 'vitest';

import {readRendererCapabilities} from '../../src/index.js';
import {loadCases} from './loader.js';
import {conformancePath, describeSuite, errorClassFor} from './suite-helpers.js';

describeSuite(
  'Conformance: renderer_capabilities.yaml',
  loadCases([conformancePath('agent/renderer_capabilities.yaml')]),
  async testCase => {
    const args = testCase.args as {
      version: string;
      metadata?: unknown;
    };

    const read = () => readRendererCapabilities(args.metadata ?? null, args.version);

    if (testCase.expect_error) {
      expect(read).toThrow(errorClassFor(testCase));
      return;
    }

    const result = read() ?? null;
    expect(result).toEqual(testCase.expect);
  },
);

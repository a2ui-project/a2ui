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

import {
  formatInboundForModel,
  getInboundMessageKind,
  parseInboundMessage,
  type ProtocolVersion,
} from '../../src/index.js';
import {loadCases} from './loader.js';
import {conformancePath, describeSuite, errorClassFor} from './suite-helpers.js';

interface ParseInboundMessageExpect {
  kind: 'action' | 'error' | 'callAgentFunction' | 'rendererFunctionResponse';
  model_input?: string | null;
  model_input_contains?: string[];
}

describeSuite(
  'Conformance: inbound_messages.yaml',
  loadCases([conformancePath('agent/inbound_messages.yaml')]),
  async testCase => {
    const args = testCase.args as {
      version: string;
      message: unknown;
    };

    const run = () => parseInboundMessage(args.message, args.version as ProtocolVersion);

    if (testCase.expect_error) {
      expect(run).toThrow(errorClassFor(testCase));
      return;
    }

    const parsed = run();
    const expected = testCase.expect as ParseInboundMessageExpect;
    expect(getInboundMessageKind(parsed)).toBe(expected.kind);

    const formatted = formatInboundForModel(parsed);
    if ('model_input' in expected) {
      expect(formatted ?? null).toBe(expected.model_input);
    }
    if (expected.model_input_contains) {
      expect(formatted).toBeDefined();
      for (const substring of expected.model_input_contains) {
        expect(formatted).toContain(substring);
      }
    }
  },
);

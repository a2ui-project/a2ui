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

import {readFileSync} from 'fs';

import {expect} from 'vitest';

import {AgentToRendererMessage, DirectJsonPromptGenerator} from '../../src/index.js';
import {loadCases} from './loader.js';
import {
  assertExpectedError,
  assertKnownKeys,
  CASE_METADATA_KEYS,
  CatalogRegistration,
  conformancePath,
  describeSuite,
  KNOWN_FAILURES,
  loadRegistrations,
} from './suite-helpers.js';

const PROMPT_GENERATOR_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expect_file',
  'expect_contains',
  'expect_absent',
  'expect_deterministic',
  'expect_error',
]);
const PROMPT_GENERATOR_ARGS_KEYS = new Set(['format', 'catalogs', 'examples', 'allowed_messages']);

describeSuite(
  'Conformance: direct_json/prompt_generator.yaml',
  loadCases([conformancePath('agent/direct_json/prompt_generator.yaml')]),
  async testCase => {
    assertKnownKeys(testCase, PROMPT_GENERATOR_CASE_KEYS, 'generate_prompt_snippet case');
    const args = testCase.args as {
      format: string;
      catalogs: CatalogRegistration[];
      examples?: string[];
      allowed_messages?: string[];
    };
    assertKnownKeys(
      args as Record<string, unknown>,
      PROMPT_GENERATOR_ARGS_KEYS,
      'generate_prompt_snippet args',
    );
    if (args.format !== 'direct_json') {
      throw new Error(`Unexpected format '${args.format}'`);
    }

    const catalogs = loadRegistrations(args.catalogs).map(c => c.transformedCatalog);
    const turns = (args.examples ?? []).map(
      file => JSON.parse(readFileSync(conformancePath(file), 'utf8')) as AgentToRendererMessage[],
    );
    const examples = turns.length > 0 ? turns : undefined;
    const generate = () =>
      new DirectJsonPromptGenerator(catalogs, examples, args.allowed_messages).generate();

    if (testCase.expect_error) {
      assertExpectedError(generate, testCase);
      return;
    }

    const snippet = generate();
    if (typeof testCase.expect_file === 'string') {
      const expectedText = readFileSync(conformancePath(testCase.expect_file), 'utf8');
      expect(snippet).toBe(expectedText);
    }
    for (const needle of (testCase.expect_contains as string[] | undefined) ?? []) {
      expect(snippet, `snippet should contain '${needle}'`).toContain(needle);
    }
    for (const needle of (testCase.expect_absent as string[] | undefined) ?? []) {
      expect(snippet, `snippet should not contain '${needle}'`).not.toContain(needle);
    }
    if (testCase.expect_deterministic) {
      expect(generate()).toBe(snippet);
    }
  },
  {knownFailures: KNOWN_FAILURES},
);

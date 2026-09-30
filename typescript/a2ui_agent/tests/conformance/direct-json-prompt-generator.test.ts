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

import * as fs from 'fs';
import {describe, expect} from 'vitest';

import {AgentToRendererMessage, DirectJsonPromptGenerator} from '../../src/index.js';
import {loadCases} from './loader.js';
import {
  CatalogRegistration,
  conformancePath,
  errorClassFor,
  loadRegistrations,
  registerCase,
} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>([
  [
    'test_snippet_describes_only_the_allowed_envelopes',
    'the generator takes no allowlist of envelopes',
  ],
  ['test_no_active_catalogs_is_an_error', 'the generator accepts an empty catalog list'],
]);

describe('Conformance: direct_json/prompt_generator.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/direct_json/prompt_generator.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, async () => {
      const args = testCase.args as {
        format: string;
        catalogs: CatalogRegistration[];
        examples?: string[];
        allowed_messages?: string[];
      };
      if (args.format !== 'direct_json') {
        throw new Error(`Unexpected format '${args.format}'`);
      }
      if (args.allowed_messages) {
        throw new Error('allowed_messages is not implemented by DirectJsonPromptGenerator');
      }

      const catalogs = (await loadRegistrations(args.catalogs)).map(c => c.transformedCatalog);
      const turns = (args.examples ?? []).map(
        file =>
          JSON.parse(fs.readFileSync(conformancePath(file), 'utf8')) as AgentToRendererMessage[],
      );
      // The generator keys examples by catalog id; the suite's examples are not tied to one.
      const examples =
        turns.length > 0 && catalogs.length > 0 ? {[catalogs[0].id]: turns.flat()} : undefined;
      const generate = () =>
        new DirectJsonPromptGenerator(catalogs, examples).generate({includeExamples: true});

      if (testCase.expect_error) {
        expect(generate).toThrow(errorClassFor(testCase));
        return;
      }

      const snippet = generate();
      for (const needle of (testCase.expect_contains as string[] | undefined) ?? []) {
        expect(snippet, `snippet should contain '${needle}'`).toContain(needle);
      }
      for (const needle of (testCase.expect_absent as string[] | undefined) ?? []) {
        expect(snippet, `snippet should not contain '${needle}'`).not.toContain(needle);
      }
      if (testCase.expect_deterministic) {
        expect(generate()).toBe(snippet);
      }
    });
  }
});

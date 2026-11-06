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

import {
  A2UI_RENDERER_CAPABILITIES_KEY,
  CatalogConfig,
  readRendererCapabilities,
  resolveCatalogs,
} from '../../src/index.js';
import {loadCases} from './loader.js';
import {
  assertExpectedError,
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  describeSuite,
} from './suite-helpers.js';

const CASE_KEYS: ReadonlySet<string> = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expect',
  'expect_error',
]);

const ARGS_KEYS: ReadonlySet<string> = new Set(['metadata', 'version']);

const cases = loadCases([conformancePath('agent/renderer_capabilities.yaml')]);

describe('renderer_capabilities.yaml invariants', () => {
  test('suite is not empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test('passes extracted capabilities directly to resolveCatalogs', () => {
    const config = CatalogConfig.fromPath(
      conformancePath('test_data/catalogs/simplified_catalog_v1_0.json'),
    );
    const capabilities = readRendererCapabilities(
      {
        [A2UI_RENDERER_CAPABILITIES_KEY]: {
          '1.0': {supportedCatalogIds: ['conformance/simplified']},
        },
      },
      '1.0',
    );
    const resolved = resolveCatalogs([config], capabilities);
    expect(resolved.map(c => c.id)).toEqual(['conformance/simplified']);
  });
});

describeSuite('Conformance: renderer_capabilities.yaml', cases, testCase => {
  expect(testCase.action).toBe('read_renderer_capabilities');
  assertKnownKeys(
    testCase as unknown as Record<string, unknown>,
    CASE_KEYS,
    'read_renderer_capabilities case',
  );
  const args = testCase.args as Record<string, unknown>;
  assertKnownKeys(args, ARGS_KEYS, 'read_renderer_capabilities args');

  const version = args.version as string;
  const read = () => readRendererCapabilities(args.metadata ?? null, version);

  if (testCase.expect_error) {
    assertExpectedError(read, testCase);
    return;
  }

  const result = read() ?? null;
  expect(result).toEqual(testCase.expect);
});

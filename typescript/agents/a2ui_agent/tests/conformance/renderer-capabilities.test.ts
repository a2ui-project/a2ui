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
  A2UI_CLIENT_CAPABILITIES_KEY,
  A2UI_RENDERER_CAPABILITIES_KEY,
  A2uiCatalogError,
  CatalogConfig,
  readRendererCapabilities,
  resolveCatalogs,
} from '../../src/index.js';
import {classify, loadCases} from './loader.js';
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

  test('canonicalizes patch-zero SemVer strings and supports v0.9.1', () => {
    expect(
      readRendererCapabilities(
        {
          [A2UI_RENDERER_CAPABILITIES_KEY]: {
            '1.0': {supportedCatalogIds: ['cat-v10']},
          },
        },
        '1.0.0',
      ),
    ).toEqual({'1.0': {supportedCatalogIds: ['cat-v10']}});

    expect(
      readRendererCapabilities(
        {
          [A2UI_CLIENT_CAPABILITIES_KEY]: {
            'v0.9': {supportedCatalogIds: ['cat-v09']},
          },
        },
        '0.9.1',
      ),
    ).toEqual({'v0.9': {supportedCatalogIds: ['cat-v09']}});
  });

  test('throws A2uiCatalogError for unsupported or invalid version strings', () => {
    for (const badVersion of ['v0.8', '0.8', '2.0', 'banana', '']) {
      expect(() => readRendererCapabilities({}, badVersion)).toThrow(A2uiCatalogError);
    }
  });

  test('throws A2uiCatalogError for non-plain object instances', () => {
    expect(() => readRendererCapabilities(new Date(), '1.0')).toThrow(A2uiCatalogError);
    expect(() =>
      readRendererCapabilities({[A2UI_RENDERER_CAPABILITIES_KEY]: new Map()}, '1.0'),
    ).toThrow(A2uiCatalogError);
    expect(() =>
      readRendererCapabilities({[A2UI_RENDERER_CAPABILITIES_KEY]: {'1.0': new Date()}}, '1.0'),
    ).toThrow(A2uiCatalogError);
  });
});

describeSuite(
  'Conformance: renderer_capabilities.yaml',
  cases,
  testCase => {
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
  },
  {
    skipReason: testCase => {
      const verdict = classify(testCase);
      return verdict.runnable ? undefined : verdict.reason;
    },
  },
);

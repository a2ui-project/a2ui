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

import {resolveCatalogs} from '../../src/index.js';
import {RendererCapabilities} from '../../src/internal/web-core.js';
import {loadCases} from './loader.js';
import {
  assertExpectedError,
  assertKnownKeys,
  CASE_METADATA_KEYS,
  CatalogRegistration,
  conformancePath,
  describeSuite,
  expectCatalogContents,
  KNOWN_FAILURES,
  loadRegistrations,
} from './suite-helpers.js';

const RESOLVE_CATALOGS_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expect',
  'expect_error',
]);
const RESOLVE_CATALOGS_ARGS_KEYS = new Set([
  'catalogs',
  'renderer_capabilities',
  'accepts_inline_catalogs',
]);
const RESOLVE_CATALOGS_EXPECT_KEYS = new Set(['active_catalog_ids', 'catalogs']);

describeSuite(
  'Conformance: catalog_resolution.yaml',
  loadCases([conformancePath('agent/catalog_resolution.yaml')]),
  async testCase => {
    assertKnownKeys(testCase, RESOLVE_CATALOGS_CASE_KEYS, 'resolve_catalogs case');
    const args = testCase.args as {
      catalogs: CatalogRegistration[];
      renderer_capabilities?: Record<string, RendererCapabilities>;
      accepts_inline_catalogs?: boolean;
    };
    assertKnownKeys(
      args as Record<string, unknown>,
      RESOLVE_CATALOGS_ARGS_KEYS,
      'resolve_catalogs args',
    );
    const configs = loadRegistrations(args.catalogs);

    const resolve = () =>
      resolveCatalogs(configs, args.renderer_capabilities, args.accepts_inline_catalogs ?? false);

    if (testCase.expect_error) {
      assertExpectedError(resolve, testCase);
      return;
    }

    const expected = testCase.expect as {
      active_catalog_ids: string[];
      catalogs?: Array<{
        catalog_id: string;
        protocol_version?: string;
        components?: string[];
        functions?: string[];
      }>;
    };
    assertKnownKeys(
      expected as Record<string, unknown>,
      RESOLVE_CATALOGS_EXPECT_KEYS,
      'resolve_catalogs expect',
    );
    const active = resolve();
    // Order carries no meaning in the protocol, so the suite compares ids as a set.
    expect(active.map(c => c.id).sort()).toEqual([...expected.active_catalog_ids].sort());
    for (const expectedCatalog of expected.catalogs ?? []) {
      const catalog = active.find(c => c.id === expectedCatalog.catalog_id);
      expect(catalog, `active catalog ${expectedCatalog.catalog_id}`).toBeDefined();
      expectCatalogContents(catalog!, expectedCatalog);
    }
  },
  {knownFailures: KNOWN_FAILURES},
);

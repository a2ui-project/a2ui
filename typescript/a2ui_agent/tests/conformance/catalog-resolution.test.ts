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

import {resolveCatalogs} from '../../src/index.js';
import {RendererCapabilities} from '../../src/internal/web_core.js';
import {loadCases} from './loader.js';
import {
  CatalogRegistration,
  conformancePath,
  errorClassFor,
  expectCatalogContents,
  loadRegistrations,
  registerCase,
} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>([
  [
    'test_capabilities_without_the_catalogs_version_are_invalid',
    'resolveCatalogs takes the capabilities entry for one version, not the version-keyed object',
  ],
]);

describe('Conformance: catalog_resolution.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/catalog_resolution.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, async () => {
      const args = testCase.args as {
        catalogs: CatalogRegistration[];
        renderer_capabilities?: Record<string, RendererCapabilities>;
        accepts_inline_catalogs?: boolean;
      };
      const configs = await loadRegistrations(args.catalogs);

      // Capabilities arrive keyed by protocol version. Every case sends one version.
      const byVersion = Object.values(args.renderer_capabilities ?? {});
      if (byVersion.length > 1) {
        throw new Error(`Case ${testCase.name} sends capabilities for more than one version`);
      }
      const capabilities = byVersion[0];
      const resolve = () =>
        resolveCatalogs(configs, capabilities, args.accepts_inline_catalogs ?? false);

      if (testCase.expect_error) {
        expect(resolve).toThrow(errorClassFor(testCase));
        return;
      }

      const expected = testCase.expect as {
        active_catalog_ids: string[];
        catalogs?: Array<{catalog_id: string; components?: string[]; functions?: string[]}>;
      };
      const active = resolve();
      // Order carries no meaning in the protocol, so the suite compares ids as a set.
      expect(active.map(c => c.id).sort()).toEqual([...expected.active_catalog_ids].sort());
      for (const expectedCatalog of expected.catalogs ?? []) {
        const catalog = active.find(c => c.id === expectedCatalog.catalog_id);
        expect(catalog, `active catalog ${expectedCatalog.catalog_id}`).toBeDefined();
        expectCatalogContents(catalog!, expectedCatalog);
      }
    });
  }
});

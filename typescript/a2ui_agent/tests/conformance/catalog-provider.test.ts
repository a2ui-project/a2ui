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

import {FileSystemCatalogProvider, ProtocolVersion} from '../../src/index.js';
import {loadCases} from './loader.js';
import {
  conformancePath,
  errorClassFor,
  expectCatalogContents,
  registerCase,
} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>([]);

describe('Conformance: catalog_provider.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/catalog_provider.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, async () => {
      const args = testCase.args as {
        provider: string;
        path: string;
        catalog_id?: string;
        protocol_version?: ProtocolVersion;
      };
      if (args.provider !== 'file_system') {
        throw new Error(`Unknown provider '${args.provider}'`);
      }
      const provider = new FileSystemCatalogProvider(
        conformancePath(args.path),
        args.protocol_version,
        args.catalog_id,
      );

      if (testCase.expect_error) {
        expect(() => provider.load()).toThrow(errorClassFor(testCase));
        return;
      }

      const expected = testCase.expect as {
        catalog_id?: string;
        protocol_version?: string;
        components?: string[];
        functions?: string[];
      };
      const catalog = provider.load();
      if (expected.catalog_id !== undefined) {
        expect(catalog.id).toBe(expected.catalog_id);
      }
      if (expected.protocol_version !== undefined) {
        expect(catalog.protocolVersion).toBe(expected.protocol_version);
      }
      expectCatalogContents(catalog, expected);
    });
  }
});

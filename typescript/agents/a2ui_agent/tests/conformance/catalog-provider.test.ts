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

import {FileSystemCatalogProvider, ProtocolVersion} from '../../src/index.js';
import {loadCases} from './loader.js';
import {
  assertExpectedError,
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  describeSuite,
  expectCatalogContents,
  KNOWN_FAILURES,
} from './suite-helpers.js';

const PROVIDE_CATALOG_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expect',
  'expect_error',
]);
const PROVIDE_CATALOG_ARGS_KEYS = new Set([
  'provider',
  'path',
  'catalog',
  'catalog_id',
  'protocol_version',
]);

describeSuite(
  'Conformance: catalog_provider.yaml',
  loadCases([conformancePath('agent/catalog_provider.yaml')]),
  async testCase => {
    assertKnownKeys(testCase, PROVIDE_CATALOG_CASE_KEYS, 'provide_catalog case');
    const args = testCase.args as {
      provider: string;
      path: string;
      catalog_id?: string;
      protocol_version?: ProtocolVersion;
    };
    assertKnownKeys(
      args as Record<string, unknown>,
      PROVIDE_CATALOG_ARGS_KEYS,
      'provide_catalog args',
    );
    if (args.provider !== 'file_system') {
      throw new Error(`Unknown provider '${args.provider}'`);
    }
    const provider = new FileSystemCatalogProvider(
      conformancePath(args.path),
      args.protocol_version,
      args.catalog_id,
    );

    if (testCase.expect_error) {
      assertExpectedError(() => provider.load(), testCase);
      return;
    }

    const expected = testCase.expect as {
      catalog_id?: string;
      protocol_version?: string;
      components?: string[];
      functions?: string[];
    };
    const catalog = provider.load();
    expectCatalogContents(catalog, expected);
  },
  {knownFailures: KNOWN_FAILURES},
);

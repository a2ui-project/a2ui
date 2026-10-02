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

/**
 * Loads the basic catalogs from the repository for tests.
 *
 * The SDK does not bundle any catalog. Tests load the published basic catalog documents
 * through a catalog provider, the same way an agent loads its own catalogs.
 */

import * as path from 'path';
import {fileURLToPath} from 'url';

import {FileSystemCatalogProvider, SchemaCatalog} from '../../src/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Published basic catalog ids, by protocol version. */
export const BASIC_CATALOG_IDS = {
  'v0.9': 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  'v1.0': 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
} as const;

/**
 * Loads the basic catalog for a protocol version.
 *
 * The v0.9 document states neither `catalogId` nor `protocolVersion` (its id is only its
 * `$id`), so both are passed to the provider.
 */
export function loadBasicCatalog(version: 'v0.9' | 'v1.0'): Promise<SchemaCatalog> {
  if (version === 'v0.9') {
    return new FileSystemCatalogProvider(
      path.join(REPO_ROOT, 'specification/v0_9/catalogs/basic/catalog.json'),
      'v0.9',
      BASIC_CATALOG_IDS['v0.9'],
    ).load();
  }
  return new FileSystemCatalogProvider(
    path.join(REPO_ROOT, 'catalogs/basic/v1/catalog.json'),
  ).load();
}

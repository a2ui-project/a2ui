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
 * Loads the catalogs of the shared conformance suite (`conformance/test_data/catalogs/`)
 * for unit tests, so the tests use the same catalogs as every other SDK.
 */

import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

import {Catalog, CatalogApi} from '../../src/internal/web_core.js';
import {registerCatalogDocument} from '../../src/utils/catalog-document.js';

/** A catalog document, with the two maps tests most often reach into. */
export interface CatalogDocument extends Record<string, unknown> {
  components: Record<string, unknown>;
  functions: Record<string, unknown>;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The directory holding the conformance suite's catalogs. */
export const CONFORMANCE_CATALOGS_DIR = path.join(REPO_ROOT, 'conformance/test_data/catalogs');

/**
 * Reads a conformance catalog document.
 *
 * @param fileName The file name inside `conformance/test_data/catalogs/`.
 * @returns A fresh copy of the parsed document, safe to modify.
 */
export function readConformanceCatalog(fileName: string): CatalogDocument {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_CATALOGS_DIR, fileName), 'utf8'));
}

/**
 * Builds a catalog from a document and registers the document, as the SDK's catalog
 * providers do, so Express can read its source JSON.
 *
 * @param doc The catalog document.
 */
export function catalogFromTestDocument(doc: Record<string, unknown>): CatalogApi {
  const catalog = Catalog.fromSchema(doc);
  registerCatalogDocument(catalog, doc);
  return catalog;
}

/**
 * Loads a conformance catalog.
 *
 * @param fileName The file name inside `conformance/test_data/catalogs/`.
 */
export function loadConformanceCatalog(fileName: string): CatalogApi {
  return catalogFromTestDocument(readConformanceCatalog(fileName));
}

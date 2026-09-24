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

import {SchemaCatalog} from '../types.js';
import {A2uiCatalogError} from '../errors.js';

const catalogDocuments = new WeakMap<SchemaCatalog, Record<string, unknown>>();

/**
 * Registers the raw JSON document that a SchemaCatalog was loaded from.
 *
 * @param catalog The catalog instance.
 * @param document The raw parsed JSON document.
 */
export function registerCatalogDocument(
  catalog: SchemaCatalog,
  document: Record<string, unknown>,
): void {
  catalogDocuments.set(catalog, document);
}

/**
 * Returns whether the catalog instance has a registered source JSON document.
 *
 * @param catalog The catalog instance.
 * @returns True if a document is registered, false otherwise.
 */
export function hasCatalogDocument(catalog: SchemaCatalog): boolean {
  return catalogDocuments.has(catalog);
}

/**
 * Retrieves the raw source JSON document for a SchemaCatalog.
 *
 * @param catalog The catalog instance.
 * @returns The registered raw JSON document.
 * @throws {A2uiCatalogError} If no document is registered for this catalog.
 */
export function getCatalogDocument(catalog: SchemaCatalog): Record<string, unknown> {
  const doc = catalogDocuments.get(catalog);
  if (!doc) {
    throw new A2uiCatalogError(
      `Catalog '${catalog.id}' has no source JSON document registered. Express reads component schemas from the catalog JSON, so the catalog must be loaded through @a2ui/agent (basicCatalog, a catalog provider, or CatalogConfig).`,
    );
  }
  return doc;
}

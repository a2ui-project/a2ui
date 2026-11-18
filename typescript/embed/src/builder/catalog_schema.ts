/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {toSemVer} from '@a2ui/web_core/semver';

import {CONTRACT_VERSION, type CatalogSchemaFile} from '../contract/index.js';
import type {EmbedCatalog} from './config.js';

/**
 * Builds the catalog schema file of an app from its catalogs, keyed by catalog ID.
 *
 * @throws {Error} If a catalog is not a v1.x catalog or two catalogs share an ID.
 */
export function createCatalogSchemaFile(catalogs: readonly EmbedCatalog[]): CatalogSchemaFile {
  const schemas: CatalogSchemaFile['catalogs'] = {};
  for (const catalog of catalogs) {
    if (toSemVer(catalog.protocolVersion)?.major !== 1) {
      throw new Error(
        `Catalog "${catalog.id}" targets A2UI ${catalog.protocolVersion}; @a2ui/embed renders A2UI v1.x catalogs only.`,
      );
    }
    if (Object.hasOwn(schemas, catalog.id)) {
      throw new Error(`Two catalogs share the ID "${catalog.id}"; catalog IDs must be unique.`);
    }
    schemas[catalog.id] = {
      ...catalog.validationSchema,
      protocolVersion: catalog.protocolVersion,
      ...(catalog.instructions !== undefined ? {instructions: catalog.instructions} : {}),
    };
  }
  return {contractVersion: CONTRACT_VERSION, catalogs: schemas};
}

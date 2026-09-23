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
import {CatalogConfig} from '../processor/catalog_config.js';
import {A2uiCatalogError} from '../errors.js';
import {Catalog, RendererCapabilities} from '../internal/web_core.js';

/**
 * Matches renderer capabilities against registered catalogs and returns the active,
 * transformed set for this session.
 *
 * @param catalogs Registered catalog configurations supported by the agent.
 * @param rendererCapabilities Capabilities sent by the client renderer.
 * @param acceptsInlineCatalogs Whether the agent accepts inline catalogs from the client.
 * @returns Array of active, transformed SchemaCatalog instances.
 * @throws {A2uiCatalogError} If no supported catalog matches and no fallback applies,
 *                            or if inline catalogs are provided but not accepted.
 */
export function resolveCatalogs(
  catalogs: CatalogConfig[],
  rendererCapabilities: RendererCapabilities,
  acceptsInlineCatalogs?: boolean,
): SchemaCatalog[] {
  if (catalogs.length === 0) {
    throw new A2uiCatalogError('Agent has no configured catalogs');
  }

  const agentCatalogs = catalogs.map(c => c.transformedCatalog);
  let baseCatalog: SchemaCatalog | undefined;

  const supportedIds = rendererCapabilities.supportedCatalogIds;
  const inlineCatalogs = rendererCapabilities.inlineCatalogs;

  if (supportedIds && supportedIds.length > 0) {
    // Priority is determined by the order in supportedCatalogIds.
    for (const id of supportedIds) {
      const match = agentCatalogs.find(c => c.id === id);
      if (match) {
        baseCatalog = match;
        break;
      }
    }

    if (!baseCatalog) {
      // Fallback to default catalog when no match in supported list but inline is present.
      if (inlineCatalogs && inlineCatalogs.length > 0) {
        baseCatalog = agentCatalogs[0];
      } else {
        throw new A2uiCatalogError('No client-supported catalog found');
      }
    }
  } else {
    // If supported_catalog_ids is not provided or empty, return the first supported catalog.
    baseCatalog = agentCatalogs[0];
  }

  const activeCatalogs: SchemaCatalog[] = [baseCatalog];

  if (inlineCatalogs && inlineCatalogs.length > 0) {
    if (!acceptsInlineCatalogs) {
      throw new A2uiCatalogError('the agent does not accept inline catalogs');
    }

    for (const inlineSchema of inlineCatalogs) {
      let inlineCatalog: SchemaCatalog;
      try {
        inlineCatalog = Catalog.fromSchema(inlineSchema);
      } catch (e: unknown) {
        throw new A2uiCatalogError(`Failed to parse inline catalog: ${(e as Error).message}`);
      }
      activeCatalogs.push(inlineCatalog);
    }
  }

  return activeCatalogs;
}

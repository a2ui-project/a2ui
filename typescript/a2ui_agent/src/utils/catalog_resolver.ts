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

import {A2uiCatalogError} from '../errors.js';
import {CatalogApi, RendererCapabilities} from '../internal/web_core.js';
import {CatalogConfig} from '../processor/catalog_config.js';
import {catalogFromDocument} from '../processor/catalog_providers.js';

/**
 * Matches renderer capabilities against registered catalogs and returns the active,
 * transformed set for this session.
 *
 * Every registered catalog the renderer names becomes active, in the renderer's preference
 * order, so its first choice is the first catalog the model reads about. An id the agent
 * does not hold is ignored. Each inline catalog the renderer declares becomes an active
 * catalog of its own when the agent accepts inline catalogs, and is dropped otherwise.
 * Inline catalogs are not transformed, since transformers belong to a registration.
 *
 * @param catalogs Registered catalog configurations supported by the agent.
 * @param rendererCapabilities Capabilities sent by the client renderer, or `undefined` when
 *     the request carried none. With no capabilities the renderer stated no preference, so
 *     every registered catalog is active.
 * @param acceptsInlineCatalogs Whether the agent accepts inline catalogs from the client.
 * @returns Array of active CatalogApi instances.
 * @throws {A2uiCatalogError} If the agent has no catalogs, if an inline catalog cannot be
 *     built, or if negotiation leaves no active catalog.
 */
export function resolveCatalogs(
  catalogs: CatalogConfig[],
  rendererCapabilities: RendererCapabilities | undefined,
  acceptsInlineCatalogs = false,
): CatalogApi[] {
  if (catalogs.length === 0) {
    throw new A2uiCatalogError('Agent has no configured catalogs');
  }

  const agentCatalogs = catalogs.map(c => c.transformedCatalog);
  if (!rendererCapabilities) {
    return agentCatalogs;
  }

  const active: CatalogApi[] = [];
  for (const id of rendererCapabilities.supportedCatalogIds ?? []) {
    const match = agentCatalogs.find(c => c.id === id);
    if (match && !active.includes(match)) {
      active.push(match);
    }
  }

  if (acceptsInlineCatalogs) {
    for (const inlineSchema of rendererCapabilities.inlineCatalogs ?? []) {
      active.push(catalogFromDocument(inlineSchema as Record<string, unknown>, 'inline catalog'));
    }
  }

  if (active.length === 0) {
    throw new A2uiCatalogError(
      'No catalog in common with the renderer: it names no catalog the agent holds and ' +
        'declares no inline catalog the agent accepts.',
    );
  }
  return active;
}

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

/**
 * Resolves the catalog an item on a surface uses; the implementation behind
 * `SurfaceModel.resolveCatalog`.
 *
 * Internal to the package: it is not exported from any barrel. It is a free
 * function so that `DataContext`, which tests and integrations often construct
 * over a partial surface stand-in, applies the same rule without requiring the
 * method. `availableCatalogs` is therefore read defensively.
 *
 * @param surface Surface, or a stand-in carrying the fields read here.
 * @param catalogId Catalog the item names, or `undefined` when it names none.
 * @param subject Description of the item for error messages.
 * @returns The catalog the item resolves to.
 * @throws {A2uiCatalogError} If the named catalog is not available on the
 *   surface, or if the item names none and the surface has no default catalog.
 */
export function resolveSurfaceCatalog<C>(
  surface: {
    readonly id: string;
    readonly defaultCatalog: C | undefined;
    readonly availableCatalogs?: ReadonlyMap<string, C>;
  },
  catalogId: string | undefined,
  subject: string,
): C {
  if (catalogId !== undefined) {
    const found = surface.availableCatalogs?.get(catalogId);
    if (!found) {
      throw new A2uiCatalogError(`Catalog not found: ${catalogId}`);
    }
    return found;
  }
  if (!surface.defaultCatalog) {
    throw new A2uiCatalogError(
      `${subject} names no catalogId and surface '${surface.id}' has no default catalogId.`,
    );
  }
  return surface.defaultCatalog;
}

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

import type {Catalog, SurfaceModel} from '@a2ui/web_core/v0_9';
import {isWebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import type {ReactCatalogComponent} from '../react_component_implementation';
import {toWebComponent} from './to_web_component';

const prepared = new WeakSet<Catalog<ReactCatalogComponent>>();

function prepare(catalog: Catalog<ReactCatalogComponent>): void {
  if (prepared.has(catalog)) return;

  prepared.add(catalog);
  const components = catalog.components as Map<string, ReactCatalogComponent>;
  for (const [name, implementation] of components) {
    if (!isWebComponentImplementation(implementation)) {
      components.set(name, toWebComponent(implementation));
    }
  }
}

/**
 * Replaces every entry of the surface's catalogs (`defaultCatalog` and
 * `availableCatalogs`, which is where a component's own catalog comes from)
 * with its web component form, once per catalog, so every node the surface
 * resolves has an `impl` with a `tagName` and `element`. Must run before the
 * surface's resolver exists.
 *
 * `Catalog.components` is typed read-only to discourage extension by
 * mutation; this is the one place the React renderer writes to it, because
 * catalogs reach a surface through web_core, before React sees them.
 */
export function prepareCatalogs(surface: SurfaceModel<ReactCatalogComponent>): void {
  prepare(surface.defaultCatalog);
  for (const catalog of surface.availableCatalogs.values()) prepare(catalog);
}

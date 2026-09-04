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

import {type Catalog, isWebComponentImplementation} from '@a2ui/web_core/v0_9';
import {toWebComponent} from './to_web_component';
import {type ReactCatalogComponent, isReactComponentImplementation} from '../adapter';

const preparedUniversalCatalogs = new WeakSet<Catalog<ReactCatalogComponent>>();

/**
 * Prepares a React catalog for universal Web Component rendering by ensuring every
 * native React component has an associated W3C Custom Element `tagName`.
 *
 * This function is catalog-agnostic and does not depend on any specific catalog definitions.
 *
 * @param catalog The catalog to adapt.
 */
export function prepareUniversalCatalog(catalog: Catalog<ReactCatalogComponent>): void {
  if (preparedUniversalCatalogs.has(catalog)) {
    return;
  }

  const compMap = catalog.components as Map<string, ReactCatalogComponent>;
  for (const [key, api] of catalog.components.entries()) {
    if (!isWebComponentImplementation(api) && isReactComponentImplementation(api)) {
      const wcImpl = toWebComponent(api);
      compMap.set(key, {
        ...api,
        tagName: wcImpl.tagName,
      });
    }
  }

  preparedUniversalCatalogs.add(catalog);
}

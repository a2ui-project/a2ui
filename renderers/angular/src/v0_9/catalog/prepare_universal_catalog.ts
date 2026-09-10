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

import {Injector} from '@angular/core';
import {isWebComponentImplementation} from '@a2ui/web_core/v0_9';
import {toWebComponent} from './to_web_component';
import {
  AngularCatalog,
  CatalogComponentImplementation,
  getUniversalTagName,
  isAngularComponentImplementation,
} from './types';

const preparedUniversalCatalogs = new WeakMap<AngularCatalog, Injector>();

/**
 * Prepares an Angular catalog for universal Web Component rendering by ensuring
 * all registered components have their `tagName` populated and their active
 * Angular Injector registered.
 *
 * For Angular component declarations (`.component`) that do not already define a
 * Web Component `tagName`, they are bridged into W3C Custom Elements using the
 * provided Angular `Injector`.
 *
 * This operation is cached per injector and is idempotent.
 *
 * @param catalog The catalog to prepare.
 * @param injector The Angular Injector or EnvironmentInjector.
 */
export function prepareUniversalCatalog(catalog: AngularCatalog, injector: Injector): void {
  if (typeof customElements === 'undefined') {
    return;
  }

  if (preparedUniversalCatalogs.get(catalog) === injector) {
    return;
  }

  const compMap = catalog.components as Map<string, CatalogComponentImplementation>;
  for (const [key, componentImpl] of catalog.components.entries()) {
    if (isAngularComponentImplementation(componentImpl)) {
      const universalTag = getUniversalTagName(componentImpl);
      if (universalTag) {
        if (!isWebComponentImplementation(componentImpl)) {
          compMap.set(key, {
            ...componentImpl,
            tagName: universalTag,
          });
        }
      } else {
        const wcImpl = toWebComponent(componentImpl, injector);
        if (!isWebComponentImplementation(componentImpl)) {
          compMap.set(key, {
            ...componentImpl,
            tagName: wcImpl.tagName,
          });
        }
      }
    }
  }

  preparedUniversalCatalogs.set(catalog, injector);
}

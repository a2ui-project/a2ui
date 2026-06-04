/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Type} from '@angular/core';
import {Catalog, ComponentApi} from '@a2ui/web_core/v0_9';
import {CatalogComponentInstance} from '../core/catalog_component_instance';

/**
 * Temporary type used during basic catalog schema alignment to bypass strict type checking.
 *
 * To be removed once all properties implemented in Angular basic catalog components conform
 * to the basic catalog schema.
 * @see https://github.com/a2ui-project/a2ui/issues/1303
 */
export type AnyDuringSchemaAlignment = any;

/**
 * Extends the generic {@link ComponentApi} to include Angular-specific component metadata.
 */
export interface AngularComponentImplementation extends ComponentApi {
  /**
   * The Angular component class used to render this component.
   *
   * This class must be an Angular {@link Type} (e.g., a standalone component class)
   * that accepts `props`, `surfaceId`, and `dataContextPath` as inputs.
   */
  readonly component: Type<CatalogComponentInstance>;
}

/**
 * A collection of Angular component and function implementations mapped to
 * A2UI protocol types.
 *
 * Catalogs are used by the {@link MessageProcessor} to resolve component
 * definitions and by {@link ComponentHostComponent} to instantiate the
 * correct Angular components.
 */
export class AngularCatalog extends Catalog<AngularComponentImplementation> {}

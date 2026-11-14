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
 * The built-in basic catalogs, built with the shared test validator, and
 * lookups of their entries by name, for tests.
 */

import type {Catalog, ComponentApi, FunctionApi} from '../catalog/types.js';
import {createBasicCatalog as createV1BasicCatalog} from '../catalogs/basic/v1/catalog.js';
import {createBasicCatalog as createV08BasicCatalog} from '../v0_8/basic_catalog/catalog.js';
import {createBasicCatalog as createV09BasicCatalog} from '../v0_9/basic_catalog/catalog.js';
import {testValidator} from './validator.js';

/** The v0.8 basic catalog. */
export const v08BasicCatalog = createV08BasicCatalog(testValidator);
/** The v0.9 basic catalog. */
export const v09BasicCatalog = createV09BasicCatalog(testValidator);
/** The v1 basic catalog. */
export const v1BasicCatalog = createV1BasicCatalog(testValidator);

/** The component of a catalog named `name`; throws if it has none. */
export function componentOf<T extends ComponentApi>(catalog: Catalog<T, any>, name: string): T {
  const component = catalog.components.get(name);
  if (!component) throw new Error(`Catalog '${catalog.id}' has no component '${name}'.`);
  return component;
}

/** The function of a catalog named `name`; throws if it has none. */
export function functionOf<F extends FunctionApi>(catalog: Catalog<any, F>, name: string): F {
  const fn = catalog.functions.get(name);
  if (!fn) throw new Error(`Catalog '${catalog.id}' has no function '${name}'.`);
  return fn;
}

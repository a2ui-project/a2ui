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

import {memoizeByValidator} from '../../catalog/basic_catalog_factory.js';
import type {Catalog, FunctionImplementation} from '../../catalog/types.js';
import {implementComponents} from '../../catalogs/basic/elements.js';
import type {JsonSchemaValidator} from '../../schema-engine/types.js';
import type {WebComponentImplementation} from '../../universal/web_component_implementation.js';
import {BASIC_CATALOG_ID, loadBasicCatalogApi} from './document.js';
import {createV09SpecFunctions} from './functions/basic_functions.js';

export {BASIC_CATALOG_ID, BASIC_CATALOG_DOCUMENT, loadBasicCatalogApi} from './document.js';

/** The v0.9 basic catalog with its Web Component elements and function implementations. */
export type BasicCatalog = Catalog<WebComponentImplementation, FunctionImplementation>;

/**
 * Returns the v0.9 basic catalog of A2UI components implemented via Web
 * Components (Custom Elements).
 *
 * The catalog is the published v0.9 basic catalog document
 * (`catalogs/basic/v0_9/catalog.json`) loaded with
 * `Catalog.fromJson`: its components and functions validate against the
 * document with `validator`, and `toJson` returns the document. Each
 * component is paired with its element and each function with its
 * implementation.
 *
 * Nothing is built when the module is imported; the catalog is built the
 * first time it is asked for with a validator, and later calls with the same
 * validator return the same catalog.
 *
 * @param validator The JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const createBasicCatalog: (validator: JsonSchemaValidator) => BasicCatalog =
  memoizeByValidator(validator => {
    const api = loadBasicCatalogApi(validator);
    return api.withEntries(
      implementComponents(api.components.values(), BASIC_CATALOG_ID),
      createV09SpecFunctions(validator),
    );
  });

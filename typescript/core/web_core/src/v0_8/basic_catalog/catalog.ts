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
import {Catalog, type CatalogApi} from '../../catalog/types.js';
import type {JsonSchemaValidator} from '../../schema-engine/types.js';
import V08StandardCatalogDocument from '../schemas/standard_catalog_definition.json' with {type: 'json'};

/**
 * The ID of the v0.8 basic (standard) catalog. The published v0.8 catalog
 * document declares no `catalogId`, so this is the ID v0.8 messages use for it.
 */
export const BASIC_CATALOG_ID =
  'https://a2ui.org/specification/v0_8/standard_catalog_definition.json';

/**
 * The published v0.8 standard catalog document
 * (`specification/v0_8/json/standard_catalog_definition.json`).
 */
export const BASIC_CATALOG_DOCUMENT: Readonly<Record<string, unknown>> = V08StandardCatalogDocument;

/**
 * Returns the v0.8 basic catalog: the component APIs of the published v0.8
 * standard catalog and its `styles` theme, without implementations.
 *
 * The catalog is the published document loaded with `Catalog.fromJson`, so
 * its components validate against the document with `validator`, and
 * `toJson` returns the document. Nothing is built when the module is
 * imported; the catalog is built the first time it is asked for with a
 * validator, and later calls with the same validator return the same catalog.
 *
 * @param validator The JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const createBasicCatalog: (validator: JsonSchemaValidator) => CatalogApi =
  memoizeByValidator(validator =>
    Catalog.fromJson(V08StandardCatalogDocument, '0.8', BASIC_CATALOG_ID, {validator}),
  );

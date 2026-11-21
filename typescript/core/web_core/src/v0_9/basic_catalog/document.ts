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
import V09BasicCatalogDocument from '../schemas/catalogs/basic/catalog.json' with {type: 'json'};

/** The ID of the v0.9 basic catalog, as its published document declares it. */
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/**
 * The published v0.9 basic catalog document
 * (`catalogs/basic/v0_9/catalog.json`).
 */
export const BASIC_CATALOG_DOCUMENT: Readonly<Record<string, unknown>> = V09BasicCatalogDocument;

/**
 * Loads the published v0.9 basic catalog document with `Catalog.fromJson`:
 * its component and function APIs, schemas only. Loaded once per validator.
 *
 * @param validator The JSON Schema validator the entries validate with.
 */
export const loadBasicCatalogApi: (validator: JsonSchemaValidator) => CatalogApi =
  memoizeByValidator(validator =>
    Catalog.fromJson(V09BasicCatalogDocument, '0.9', BASIC_CATALOG_ID, {validator}),
  );

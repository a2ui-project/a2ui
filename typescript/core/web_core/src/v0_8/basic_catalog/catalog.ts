/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Catalog, type ComponentApi, type FunctionApi} from '../../catalog/types.js';
import {
  BASIC_CATALOG_DOCUMENT_OPTIONS,
  BASIC_COMPONENTS,
  ThemeSchema,
} from './components/basic_components.js';

/**
 * The ID of the v0.8 basic (standard) catalog. The published v0.8 catalog
 * document declares no `catalogId`, so this is the ID v0.8 messages use for it.
 */
export const BASIC_CATALOG_ID =
  'https://a2ui.org/specification/v0_8/standard_catalog_definition.json';

/**
 * The v0.8 basic catalog: the component APIs of the published v0.8 standard
 * catalog and its `styles` theme, without implementations.
 *
 * Its components and theme are the models generated from the published
 * catalog document by src/v0_8/scripts/generate-catalog.mjs, and its
 * document-level fields are those the generated models carry, so `toJson`
 * computes the published document from the models and `validationSchema` is
 * built from it.
 */
export const basicCatalog = new Catalog<ComponentApi, FunctionApi>(
  BASIC_CATALOG_ID,
  '0.8',
  BASIC_COMPONENTS,
  [],
  {themeSchema: ThemeSchema, ...BASIC_CATALOG_DOCUMENT_OPTIONS},
);

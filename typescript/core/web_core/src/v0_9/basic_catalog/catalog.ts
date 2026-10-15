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

import {Catalog} from '../../catalog/types.js';
import {BasicCatalogThemeSchema} from '../../universal/basic_catalog/theme.js';
import type {WebComponentImplementation} from '../../universal/index.js';
import {BASIC_CATALOG_DOCUMENT_OPTIONS} from './components/basic_components.js';
import {
  A2uiAudioPlayer,
  A2uiButton,
  A2uiCard,
  A2uiCheckBox,
  A2uiChoicePicker,
  A2uiColumn,
  A2uiDateTimeInput,
  A2uiDivider,
  A2uiIcon,
  A2uiImage,
  A2uiList,
  A2uiModal,
  A2uiRow,
  A2uiSlider,
  A2uiTabs,
  A2uiText,
  A2uiTextField,
  A2uiVideo,
} from './components/index.js';
import {BASIC_FUNCTIONS} from './functions/basic_functions.js';

/**
 * The single canonical basic catalog of A2UI components implemented via Web Components (Custom Elements).
 *
 * Its components and functions are the models generated from the published
 * catalog document (see scripts/generate-catalog-schemas.mjs), listed in the
 * document's order, and its document-level fields are those the generated
 * models carry, so `toJson` computes the published document from the models
 * and `validationSchema` is built from it.
 */
export const basicCatalog = new Catalog<WebComponentImplementation>(
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  '0.9',
  [
    A2uiText,
    A2uiImage,
    A2uiIcon,
    A2uiVideo,
    A2uiAudioPlayer,
    A2uiRow,
    A2uiColumn,
    A2uiList,
    A2uiCard,
    A2uiTabs,
    A2uiModal,
    A2uiDivider,
    A2uiButton,
    A2uiTextField,
    A2uiCheckBox,
    A2uiChoicePicker,
    A2uiSlider,
    A2uiDateTimeInput,
  ],
  BASIC_FUNCTIONS,
  {
    themeSchema: BasicCatalogThemeSchema,
    ...BASIC_CATALOG_DOCUMENT_OPTIONS,
  },
);

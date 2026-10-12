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

import {attachSourceJson, catalogDocumentOptions} from '../../../catalog/source_document.js';
import {Catalog} from '../../../catalog/types.js';
import {BasicCatalogThemeSchema} from '../../../universal/basic_catalog/theme.js';
import type {WebComponentImplementation} from '../../../universal/index.js';
import BASIC_CATALOG_DOCUMENT from '../../../v1_0/schemas/catalogs/basic/catalog.json' with {type: 'json'};
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
 * The v1 basic catalog of A2UI components implemented via Web Components
 * (Custom Elements).
 *
 * Its components and functions carry their definitions from the published
 * catalog document, so `toJson` returns that document and `validationSchema`
 * is built from it.
 */
export const basicCatalog = new Catalog<WebComponentImplementation>(
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  '1.0',
  attachSourceJson(
    [
      A2uiText,
      A2uiButton,
      A2uiTextField,
      A2uiRow,
      A2uiColumn,
      A2uiList,
      A2uiImage,
      A2uiIcon,
      A2uiVideo,
      A2uiAudioPlayer,
      A2uiCard,
      A2uiDivider,
      A2uiCheckBox,
      A2uiSlider,
      A2uiDateTimeInput,
      A2uiChoicePicker,
      A2uiTabs,
      A2uiModal,
    ],
    BASIC_CATALOG_DOCUMENT,
    'components',
  ),
  attachSourceJson(BASIC_FUNCTIONS, BASIC_CATALOG_DOCUMENT, 'functions'),
  {
    themeSchema: BasicCatalogThemeSchema,
    ...catalogDocumentOptions(BASIC_CATALOG_DOCUMENT),
  },
);

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

import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateCatalogApi} from '../../../../../scripts/generate-catalog-schemas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const v1CatalogDir = join(__dirname, '..');
const rootDir = resolve(__dirname, '../../../../../../..');

console.log('Generating Basic Catalog v1 APIs...');

generateCatalogApi({
  version: 'v1_0',
  catalogPath: join(rootDir, 'catalogs', 'basic', 'v1', 'catalog.json'),
  commonTypesPath: join(rootDir, 'specification', 'v1_0', 'json', 'common_types.json'),
  componentsOutPath: join(v1CatalogDir, 'components', 'basic_components.ts'),
  functionsOutPath: join(v1CatalogDir, 'functions', 'basic_functions_api.ts'),
  commonTypesImportPath: '../../../../v1_0/schema/common-types.js',
  typesImportPath: '../../../../catalog/types.js',
});

console.log('Successfully generated Basic Catalog v1 APIs.');

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

import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateCatalogApi} from '../../../scripts/generate-catalog-schemas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const v10Dir = join(__dirname, '..');
const rootDir = join(v10Dir, '..', '..');

console.log('Generating v1.0 Basic Catalog APIs...');

generateCatalogApi({
  version: 'v1_0',
  catalogPath: join(
    rootDir,
    '..',
    '..',
    'specification',
    'v1_0',
    'catalogs',
    'basic',
    'catalog.json',
  ),
  commonTypesPath: join(rootDir, '..', '..', 'specification', 'v1_0', 'json', 'common_types.json'),
  componentsOutPath: join(v10Dir, 'basic_catalog', 'components', 'basic_components.ts'),
  functionsOutPath: join(v10Dir, 'basic_catalog', 'functions', 'basic_functions_api.ts'),
});

console.log('Successfully generated v1.0 Basic Catalog APIs.');

/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Builds dist/a2ui-app.html (the app, with the sample catalog inlined) and
// dist/a2ui-app.catalog.json (its schema, which the server validates against).
import {defineConfig} from '@a2ui/embed/build';

import {sqlCatalog} from './src/catalog/index.js';

export default defineConfig({
  catalogs: [sqlCatalog],
  output: 'dist/a2ui-app.html',
  title: 'SQL explorer',
});

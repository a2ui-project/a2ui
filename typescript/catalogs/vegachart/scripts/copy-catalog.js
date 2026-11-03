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
 * Copies the canonical VegaChart catalog schemas from the top-level
 * `catalogs/vegachart/` directory into `src/` before `tsc` runs, so the
 * published npm tarball bundles the exact schemas it implements (exposed as
 * `@a2ui/catalog-vegachart/v0_9/catalog.json` and `.../v1/catalog.json`).
 */

import {copyFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogsRoot = resolve(pkgRoot, '../../../catalogs/vegachart');

for (const version of ['v0_9', 'v1']) {
  const dest = resolve(pkgRoot, 'src', version, 'catalog.json');
  mkdirSync(dirname(dest), {recursive: true});
  copyFileSync(resolve(catalogsRoot, version, 'catalog.json'), dest);
}

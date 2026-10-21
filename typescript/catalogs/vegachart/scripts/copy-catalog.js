/*
 * Copyright 2026 Google LLC
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
 * Copies the canonical VegaChart catalog schema from the top-level `catalogs/`
 * directory into `src/catalog.json` before `tsc` runs, so the published npm
 * tarball stays self-contained and bundles the exact `catalog.json` it
 * implements (exposed as `@a2ui/catalog-vegachart/catalog.json`).
 */

(async () => {
  const {copyFileSync, mkdirSync} = await import('node:fs');
  const {dirname, resolve} = await import('node:path');
  const {fileURLToPath} = await import('node:url');

  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const src = resolve(pkgRoot, '../../../catalogs/vegachart/catalog.json');
  const dest = resolve(pkgRoot, 'src/catalog.json');

  mkdirSync(dirname(dest), {recursive: true});
  copyFileSync(src, dest);
})();

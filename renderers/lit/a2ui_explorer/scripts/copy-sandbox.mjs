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

import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

/**
 * Copies the sandbox proxy asset of `@a2ui/catalog-iframe` into `public/a2ui-sandbox/`.
 *
 * The frame components of the iframe and MCP catalogs load the proxy from `/a2ui-sandbox/` on the
 * host's origin. Vite serves `public/` as is, so the copy makes the proxy available at that path in
 * `vite` (dev server), `vite build` (copied into `dist/`) and `vite preview`; `karma.conf.cjs`
 * serves the same directory at the same path for the tests. This is the setup the catalog package
 * READMEs describe for Vite applications. `@a2ui/catalog-mcp` ships the identical asset, so one
 * copy serves both catalogs.
 *
 * The copy is git-ignored (see `.gitignore`). `yarn dev`, `yarn build` and `yarn test` run this
 * script through the `copy-sandbox` wireit script, which builds `@a2ui/catalog-iframe` first.
 */
function copySandbox() {
  const require = createRequire(import.meta.url);
  let catalogJsonPath;
  try {
    // `dist/catalog.json` is the package's only exported file; the asset sits next to it.
    catalogJsonPath = require.resolve('@a2ui/catalog-iframe/catalog.json');
  } catch {
    console.error(
      '@a2ui/catalog-iframe is not built. Run `yarn workspace @a2ui/catalog-iframe build` first.',
    );
    process.exit(1);
  }
  const sourceDir = path.join(path.dirname(catalogJsonPath), 'sandbox');
  const targetDir = path.resolve(import.meta.dirname, '../public/a2ui-sandbox');

  rmSync(targetDir, {recursive: true, force: true});
  mkdirSync(path.dirname(targetDir), {recursive: true});
  cpSync(sourceDir, targetDir, {recursive: true});
  console.log(`Copied the sandbox proxy from ${sourceDir} to ${targetDir}`);
}

copySandbox();

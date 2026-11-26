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

/**
 * Bundles the test apps, `tests/fixtures/*.ts`, into self-contained scripts under
 * `tests/fixtures/generated/`. Karma serves that directory; the browser tests inline a script
 * into the HTML of an iframe, the way the build command ships an app.
 */
import {build} from 'esbuild';
import {mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(packageDir, 'tests', 'fixtures');
const outDir = join(sourceDir, 'generated');

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});

await build({
  entryPoints: readdirSync(sourceDir)
    .filter(name => name.endsWith('.ts'))
    .map(name => join(sourceDir, name)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outdir: outDir,
  legalComments: 'none',
  logLevel: 'warning',
});

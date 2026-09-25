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
 * Bundles the fixture application of the real-frame scenarios, `tests/fixtures/apps/*.ts`, which
 * is written against the MCP Apps App SDK, into self-contained scripts under
 * `tests/fixtures/generated/`. Karma serves that directory; the scenarios inline a script into
 * the `htmlContent` of a `McpApp` component, the way a real MCP App ships.
 */
import {build} from 'esbuild';
import {mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(packageDir, 'tests', 'fixtures', 'apps');
const outDir = join(packageDir, 'tests', 'fixtures', 'generated');

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});

const entryPoints = readdirSync(sourceDir)
  .filter(name => name.endsWith('.ts'))
  .map(name => join(sourceDir, name));

await build({
  entryPoints,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outdir: outDir,
  legalComments: 'none',
  logLevel: 'warning',
});

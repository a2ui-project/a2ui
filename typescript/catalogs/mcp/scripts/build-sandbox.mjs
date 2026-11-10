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
 * Builds the sandbox proxy asset into `dist/sandbox/`: the proxy pages copied as they are, and
 * `sandbox.js`, the proxy script bundled into one self-contained file. Host apps serve this
 * directory as static files (see the README).
 */
import {build} from 'esbuild';
import {copyFileSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(packageDir, 'src', 'shared', 'sandbox');
const outDir = join(packageDir, 'dist', 'sandbox');
const entryPoint = join(sourceDir, 'sandbox_main.ts');

// The bundle keeps the license header of its entry point; esbuild drops it otherwise.
const licenseHeader = readFileSync(entryPoint, 'utf8').match(/^\/\*[\s\S]*?\*\//)?.[0] ?? '';

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(outDir, 'sandbox.js'),
  banner: {js: licenseHeader},
  legalComments: 'none',
  logLevel: 'warning',
});

for (const page of ['sandbox.html', 'sandbox-url.html']) {
  copyFileSync(join(sourceDir, page), join(outDir, page));
}

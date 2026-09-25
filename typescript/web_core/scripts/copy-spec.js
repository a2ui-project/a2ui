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
 * Cross-platform script to copy JSON schemas.
 * Uses Node.js fs/path modules for Windows/Unix compatibility.
 */
import {mkdirSync, cpSync, readdirSync, existsSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const repoRoot = join(rootDir, '..', '..');

/**
 * Copies the JSON schemas for a protocol version into `src/<version>/schemas`.
 *
 * @param version The protocol version directory name (e.g. `v1_0`).
 * @param catalogs A map from catalog name to the directory holding that
 *   catalog, or `undefined` when the version ships no standalone catalogs.
 *   Each catalog is copied to `src/<version>/schemas/catalogs/<name>`.
 */
function copySchemas(version, catalogs) {
  const srcJsonDir = join(repoRoot, 'specification', version, 'json');
  const destDir = join(rootDir, 'src', version, 'schemas');

  mkdirSync(destDir, {recursive: true});

  if (existsSync(srcJsonDir)) {
    readdirSync(srcJsonDir)
      .filter(file => file.endsWith('.json'))
      .forEach(file => cpSync(join(srcJsonDir, file), join(destDir, file)));
  }

  for (const [name, srcDir] of Object.entries(catalogs ?? {})) {
    cpSync(srcDir, join(destDir, 'catalogs', name), {
      recursive: true,
      // Catalog directories may also hold documentation; only the JSON is a
      // build input.
      filter: src => statSync(src).isDirectory() || src.endsWith('.json'),
    });
  }
}

const v0_9Catalogs = join(repoRoot, 'specification', 'v0_9', 'catalogs');

copySchemas('v0_8');
copySchemas(
  'v0_9',
  Object.fromEntries(
    readdirSync(v0_9Catalogs, {withFileTypes: true})
      .filter(entry => entry.isDirectory())
      .map(entry => [entry.name, join(v0_9Catalogs, entry.name)]),
  ),
);
// Catalogs are versioned independently of the protocol and live under the
// top-level catalogs/ directory (see catalogs/README.md).
copySchemas('v1_0', {basic: join(repoRoot, 'catalogs', 'basic', 'v1')});

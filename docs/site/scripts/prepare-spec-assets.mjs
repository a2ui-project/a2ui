#!/usr/bin/env node
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

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '../..');
const publicDir = path.join(siteRoot, 'public');

function copyRecursive(src, dest, {required = true} = {}) {
  if (!fs.existsSync(src)) {
    if (required) {
      throw new Error(`[prepare-spec-assets] Required source path not found: ${src}`);
    }
    return;
  }
  fs.cpSync(src, dest, {recursive: true, force: true});
}

// 0. Clear Astro content layer cache so external --8<-- specification edits are always picked up
fs.rmSync(path.join(siteRoot, 'node_modules/.astro'), {recursive: true, force: true});
fs.rmSync(path.join(siteRoot, '.astro'), {recursive: true, force: true});

// 1. Ensure public/ exists
fs.mkdirSync(publicDir, {recursive: true});

// 2. Copy static assets from docs/public/assets, CNAME, and llms.txt
copyRecursive(path.join(repoRoot, 'docs/public/assets'), path.join(publicDir, 'assets'));
if (fs.existsSync(path.join(repoRoot, 'docs/public/CNAME'))) {
  fs.copyFileSync(path.join(repoRoot, 'docs/public/CNAME'), path.join(publicDir, 'CNAME'));
}
if (fs.existsSync(path.join(repoRoot, 'docs/public/llms.txt'))) {
  fs.copyFileSync(path.join(repoRoot, 'docs/public/llms.txt'), path.join(publicDir, 'llms.txt'));
}
fs.writeFileSync(path.join(publicDir, '.nojekyll'), '');

// 3. Copy specification/* and catalogs/* so canonical JSON Schema $id URLs resolve on a2ui.org
const specDest = path.join(publicDir, 'specification');
fs.mkdirSync(specDest, {recursive: true});
copyRecursive(path.join(repoRoot, 'specification'), specDest);

// Copy basic & mcp catalogs under specification/v1_0/catalogs/
const basicCatalogDest = path.join(specDest, 'v1_0/catalogs/basic');
fs.mkdirSync(basicCatalogDest, {recursive: true});
copyRecursive(
  path.join(repoRoot, 'catalogs/basic/v1/catalog.json'),
  path.join(basicCatalogDest, 'catalog.json'),
);
copyRecursive(
  path.join(repoRoot, 'catalogs/basic/v1/examples'),
  path.join(basicCatalogDest, 'examples'),
);

const mcpCatalogDest = path.join(specDest, 'v1_0/catalogs/mcp');
fs.mkdirSync(mcpCatalogDest, {recursive: true});
copyRecursive(
  path.join(repoRoot, 'catalogs/mcp/v1/catalog.json'),
  path.join(mcpCatalogDest, 'catalog.json'),
);
copyRecursive(
  path.join(repoRoot, 'catalogs/mcp/v1/examples'),
  path.join(mcpCatalogDest, 'examples'),
);

// Flatten JSON files to version roots (e.g. v0_8, v0_9, v0_9_1, v1_0, v1_1)
const specVersions = fs.existsSync(specDest)
  ? fs
      .readdirSync(specDest)
      .filter(f => fs.statSync(path.join(specDest, f)).isDirectory() && /^v\d+_\d+(_\d+)?$/.test(f))
  : [];

for (const version of specVersions) {
  const jsonDir = path.join(specDest, version, 'json');
  if (fs.existsSync(jsonDir)) {
    for (const file of fs.readdirSync(jsonDir)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(jsonDir, file), path.join(specDest, version, file));
      }
    }
  }
}

console.log(
  '[prepare-spec-assets] Staged assets, CNAME, llms.txt, and specification JSON schemas into public/.',
);

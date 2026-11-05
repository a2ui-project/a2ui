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

// 2. Copy static assets from docs/public/assets and CNAME, and render llms.txt
copyRecursive(path.join(repoRoot, 'docs/public/assets'), path.join(publicDir, 'assets'));
if (fs.existsSync(path.join(repoRoot, 'docs/public/CNAME'))) {
  fs.copyFileSync(path.join(repoRoot, 'docs/public/CNAME'), path.join(publicDir, 'CNAME'));
}
// Render llms.txt from docs/site/llms.txt, filling version info from specification/versions.json
// (the single source of truth for protocol version status).
{
  const {versions} = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'specification/versions.json'), 'utf8'),
  );
  const placeholders = {
    '{{A2UI_PROTOCOL_VERSIONS}}': versions.map(v => `${v.version} (${v.status})`).join(', '),
    '{{A2UI_SPEC_LINKS}}': versions
      .filter(v => v.status !== 'legacy')
      .map(v => `- [Specification ${v.version} (${v.status})](${v.spec})`)
      .join('\n'),
  };
  let llms = fs.readFileSync(path.join(siteRoot, 'llms.txt'), 'utf8');
  for (const [placeholder, value] of Object.entries(placeholders)) {
    if (!llms.includes(placeholder)) {
      throw new Error(`[prepare-spec-assets] Missing ${placeholder} in llms.txt`);
    }
    llms = llms.replaceAll(placeholder, value);
  }
  const unresolved = llms.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) {
    throw new Error(`[prepare-spec-assets] Unresolved placeholders in llms.txt: ${unresolved}`);
  }
  fs.writeFileSync(path.join(publicDir, 'llms.txt'), llms);
}
fs.writeFileSync(path.join(publicDir, '.nojekyll'), '');

// 3. Copy specification/* and catalogs/* so canonical JSON Schema $id URLs resolve on a2ui.org
const specDest = path.join(publicDir, 'specification');
fs.mkdirSync(specDest, {recursive: true});
copyRecursive(path.join(repoRoot, 'specification'), specDest);

// Copy v1.0 basic, mcp, and vegachart catalogs under specification/v1_0/catalogs/
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

const mcpCatalogV1Dest = path.join(specDest, 'v1_0/catalogs/mcp');
fs.mkdirSync(mcpCatalogV1Dest, {recursive: true});
copyRecursive(
  path.join(repoRoot, 'catalogs/mcp/v1/catalog.json'),
  path.join(mcpCatalogV1Dest, 'catalog.json'),
);
copyRecursive(
  path.join(repoRoot, 'catalogs/mcp/v1/examples'),
  path.join(mcpCatalogV1Dest, 'examples'),
);

const vegaCatalogV1Src = path.join(repoRoot, 'catalogs/vegachart/v1/catalog.json');
if (fs.existsSync(vegaCatalogV1Src)) {
  const vegaCatalogV1Dest = path.join(specDest, 'v1_0/catalogs/vegachart');
  fs.mkdirSync(vegaCatalogV1Dest, {recursive: true});
  copyRecursive(vegaCatalogV1Src, path.join(vegaCatalogV1Dest, 'catalog.json'), {required: false});
}

// Copy v0.9 / v0.9.1 mcp and vegachart catalogs so $id URIs resolve cleanly
for (const verDir of ['v0_9', 'v0_9_1']) {
  const mcpCatalogV09Dest = path.join(specDest, `${verDir}/catalogs/mcp`);
  fs.mkdirSync(mcpCatalogV09Dest, {recursive: true});
  copyRecursive(
    path.join(repoRoot, 'catalogs/mcp/catalog.json'),
    path.join(mcpCatalogV09Dest, 'mcp_catalog.json'),
  );
  copyRecursive(
    path.join(repoRoot, 'catalogs/mcp/catalog.json'),
    path.join(mcpCatalogV09Dest, 'catalog.json'),
  );

  const vegaCatalogV09Src = path.join(repoRoot, 'catalogs/vegachart/v0_9/catalog.json');
  if (fs.existsSync(vegaCatalogV09Src)) {
    const vegaCatalogV09Dest = path.join(specDest, `${verDir}/catalogs/vegachart`);
    fs.mkdirSync(vegaCatalogV09Dest, {recursive: true});
    copyRecursive(vegaCatalogV09Src, path.join(vegaCatalogV09Dest, 'catalog.json'), {
      required: false,
    });
  }
}

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

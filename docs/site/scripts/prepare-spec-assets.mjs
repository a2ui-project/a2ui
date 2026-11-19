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
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSiteRoot = path.resolve(__dirname, '..');
const defaultRepoRoot = path.resolve(defaultSiteRoot, '../..');

const SPEC_VERSION_DIR_RE = /^v\d+_\d+(?:_\d+)?$/;
const SKIPPED_SPEC_VERSION_SUBDIRS = new Set(['docs', 'scripts', 'test']);

function copyRecursive(src, dest, {required = true} = {}) {
  if (!fs.existsSync(src)) {
    if (required) {
      throw new Error(`[prepare-spec-assets] Required source path not found: ${src}`);
    }
    return;
  }
  fs.cpSync(src, dest, {recursive: true, force: true});
}

function copyJsonTree(srcDir, destDir, {required = true, skipDirs = new Set()} = {}) {
  if (!fs.existsSync(srcDir)) {
    if (required) {
      throw new Error(`[prepare-spec-assets] Required source path not found: ${srcDir}`);
    }
    return;
  }

  for (const entry of fs.readdirSync(srcDir, {withFileTypes: true})) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      copyJsonTree(srcPath, destPath, {required: false, skipDirs});
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      fs.mkdirSync(destDir, {recursive: true});
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function stageCname(siteRoot, publicDir) {
  const cnameSrc = path.join(siteRoot, 'CNAME');
  if (!fs.existsSync(cnameSrc) || !fs.statSync(cnameSrc).isFile()) {
    throw new Error(`[prepare-spec-assets] Required CNAME file not found: ${cnameSrc}`);
  }
  const cnameValue = fs.readFileSync(cnameSrc, 'utf8').trim();
  if (!cnameValue) {
    throw new Error(`[prepare-spec-assets] CNAME file must not be empty: ${cnameSrc}`);
  }
  fs.copyFileSync(cnameSrc, path.join(publicDir, 'CNAME'));
}

export function prepareSpecAssets({
  siteRoot = defaultSiteRoot,
  repoRoot = defaultRepoRoot,
  publicDir = path.join(siteRoot, 'public'),
  clearAstroCache = true,
  log = console.log,
} = {}) {
  // 0. Clear Astro content layer cache so external --8<-- specification edits are always picked up
  if (clearAstroCache) {
    fs.rmSync(path.join(siteRoot, 'node_modules/.astro'), {recursive: true, force: true});
    fs.rmSync(path.join(siteRoot, '.astro'), {recursive: true, force: true});
  }

  // 1. Ensure public/ exists
  fs.mkdirSync(publicDir, {recursive: true});

  // 2. Copy static assets from docs/assets and docs/site/CNAME (fail-closed), and render llms.txt
  copyRecursive(path.join(repoRoot, 'docs/assets'), path.join(publicDir, 'assets'));
  stageCname(siteRoot, publicDir);

  // Render llms.txt from docs/site/llms.txt, filling version info from specification/versions.json
  // (the single source of truth for protocol version status).
  {
    const {versions} = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'specification/versions.json'), 'utf8'),
    );
    const placeholders = {
      '{{A2UI_PROTOCOL_VERSIONS}}': versions.map(v => `${v.version} (${v.status})`).join(', '),
      '{{A2UI_SPEC_LINKS}}': versions
        .filter(v => v.status !== 'deprecated')
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

  // 3. Stage specification JSON schemas, versions.json, and catalogs so canonical $id URLs resolve
  // without publishing internal scripts, proposals, grammars, Markdown docs, or test harnesses.
  const specSrcRoot = path.join(repoRoot, 'specification');
  if (!fs.existsSync(specSrcRoot)) {
    throw new Error(`[prepare-spec-assets] Required source path not found: ${specSrcRoot}`);
  }
  const specDest = path.join(publicDir, 'specification');
  fs.rmSync(specDest, {recursive: true, force: true});
  fs.mkdirSync(specDest, {recursive: true});

  copyRecursive(path.join(specSrcRoot, 'versions.json'), path.join(specDest, 'versions.json'));

  for (const entry of fs.readdirSync(specSrcRoot, {withFileTypes: true})) {
    if (entry.isDirectory() && SPEC_VERSION_DIR_RE.test(entry.name)) {
      copyJsonTree(path.join(specSrcRoot, entry.name), path.join(specDest, entry.name), {
        skipDirs: SKIPPED_SPEC_VERSION_SUBDIRS,
      });
    }
  }

  // Copy v1.0 basic, mcp, and vegachart catalogs under specification/v1_0/catalogs/
  const basicCatalogDest = path.join(specDest, 'v1_0/catalogs/basic');
  fs.mkdirSync(basicCatalogDest, {recursive: true});
  copyRecursive(
    path.join(repoRoot, 'catalogs/basic/v1/catalog.json'),
    path.join(basicCatalogDest, 'catalog.json'),
  );
  copyJsonTree(
    path.join(repoRoot, 'catalogs/basic/v1/examples'),
    path.join(basicCatalogDest, 'examples'),
  );

  const mcpCatalogV1Dest = path.join(specDest, 'v1_0/catalogs/mcp');
  fs.mkdirSync(mcpCatalogV1Dest, {recursive: true});
  copyRecursive(
    path.join(repoRoot, 'catalogs/mcp/v1/catalog.json'),
    path.join(mcpCatalogV1Dest, 'catalog.json'),
  );
  copyJsonTree(
    path.join(repoRoot, 'catalogs/mcp/v1/examples'),
    path.join(mcpCatalogV1Dest, 'examples'),
  );

  const vegaCatalogV1Src = path.join(repoRoot, 'catalogs/vegachart/v1/catalog.json');
  if (fs.existsSync(vegaCatalogV1Src)) {
    const vegaCatalogV1Dest = path.join(specDest, 'v1_0/catalogs/vegachart');
    fs.mkdirSync(vegaCatalogV1Dest, {recursive: true});
    copyRecursive(vegaCatalogV1Src, path.join(vegaCatalogV1Dest, 'catalog.json'), {
      required: false,
    });
  }

  // Copy v0.9 / v0.9.1 basic and minimal catalogs so $id URIs resolve cleanly
  for (const verDir of ['v0_9', 'v0_9_1']) {
    const basicDest = path.join(specDest, `${verDir}/catalogs/basic`);
    fs.mkdirSync(basicDest, {recursive: true});
    copyRecursive(
      path.join(repoRoot, `catalogs/basic/${verDir}/catalog.json`),
      path.join(basicDest, 'catalog.json'),
    );
    copyJsonTree(
      path.join(repoRoot, `catalogs/basic/${verDir}/examples`),
      path.join(basicDest, 'examples'),
    );
  }
  {
    const minimalDest = path.join(specDest, 'v0_9/catalogs/minimal');
    fs.mkdirSync(minimalDest, {recursive: true});
    copyRecursive(
      path.join(repoRoot, 'catalogs/minimal/v0_9/catalog.json'),
      path.join(minimalDest, 'catalog.json'),
    );
    copyJsonTree(
      path.join(repoRoot, 'catalogs/minimal/v0_9/examples'),
      path.join(minimalDest, 'examples'),
    );
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
  const specVersions = fs
    .readdirSync(specDest, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && SPEC_VERSION_DIR_RE.test(entry.name))
    .map(entry => entry.name);

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

  log(
    '[prepare-spec-assets] Staged assets, CNAME, llms.txt, and specification JSON schemas into public/.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareSpecAssets();
}

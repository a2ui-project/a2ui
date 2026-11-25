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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {prepareSpecAssets} from '../scripts/prepare-spec-assets.mjs';
import {SPEC_CATALOG_SCHEMAS, SPEC_SCHEMAS} from '../src/lib/spec-schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realSiteRoot = path.resolve(__dirname, '..');
const realRepoRoot = path.resolve(realSiteRoot, '../..');

function walkRelativeFiles(rootDir, currentDir = rootDir, out = []) {
  if (!fs.existsSync(currentDir)) return out;
  for (const entry of fs.readdirSync(currentDir, {withFileTypes: true})) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkRelativeFiles(rootDir, fullPath, out);
    } else if (entry.isFile()) {
      out.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

function createMinimalFixture(t, {cname = 'a2ui.org\n'} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-prepare-spec-fixture-'));
  t.after(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  const siteRoot = path.join(root, 'docs/site');
  const publicDir = path.join(siteRoot, 'public');

  const write = (relPath, content) => {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, content, 'utf8');
  };

  write('docs/assets/favicon.svg', '<svg></svg>');
  write(
    'docs/site/llms.txt',
    '# A2UI\nVersions: {{A2UI_PROTOCOL_VERSIONS}}\n{{A2UI_SPEC_LINKS}}\n',
  );
  if (cname === 'DIRECTORY') {
    fs.mkdirSync(path.join(siteRoot, 'CNAME'), {recursive: true});
  } else if (cname !== null) {
    write('docs/site/CNAME', cname);
  }

  write(
    'specification/versions.json',
    JSON.stringify({
      versions: [
        {version: 'v1.0', status: 'current', spec: 'https://a2ui.org/specification/v1.0-a2ui/'},
      ],
    }),
  );
  write(
    'specification/v1_0/json/common_types.json',
    '{"$id":"https://a2ui.org/specification/v1_0/common_types.json"}',
  );
  write('catalogs/basic/v1/catalog.json', '{"catalogId":"basic"}');
  write('catalogs/basic/v1/examples/01_sample.json', '{}');
  write('catalogs/mcp/v1/catalog.json', '{"catalogId":"mcp"}');
  write('catalogs/mcp/v1/examples/mcp-sample.json', '{}');
  write('catalogs/basic/v0_9/catalog.json', '{"catalogId":"basic-v0.9"}');
  write('catalogs/basic/v0_9/examples/sample.json', '{}');
  write('catalogs/basic/v0_9_1/catalog.json', '{"catalogId":"basic-v0.9.1"}');
  write('catalogs/basic/v0_9_1/examples/sample.json', '{}');
  write('catalogs/minimal/v0_9/catalog.json', '{"catalogId":"minimal-v0.9"}');
  write('catalogs/minimal/v0_9/examples/sample.json', '{}');
  write('catalogs/mcp/catalog.json', '{"catalogId":"mcp-v0.9"}');

  return {repoRoot: root, siteRoot, publicDir};
}

test('prepareSpecAssets fails closed when docs/site/CNAME is missing, empty, or not a file', t => {
  const missingFixture = createMinimalFixture(t, {cname: null});
  assert.throws(
    () =>
      prepareSpecAssets({
        repoRoot: missingFixture.repoRoot,
        siteRoot: missingFixture.siteRoot,
        publicDir: missingFixture.publicDir,
        clearAstroCache: false,
        log: () => {},
      }),
    /Required CNAME file not found/,
  );

  const emptyFixture = createMinimalFixture(t, {cname: '   \n\t '});
  assert.throws(
    () =>
      prepareSpecAssets({
        repoRoot: emptyFixture.repoRoot,
        siteRoot: emptyFixture.siteRoot,
        publicDir: emptyFixture.publicDir,
        clearAstroCache: false,
        log: () => {},
      }),
    /CNAME file must not be empty/,
  );

  const dirFixture = createMinimalFixture(t, {cname: 'DIRECTORY'});
  assert.throws(
    () =>
      prepareSpecAssets({
        repoRoot: dirFixture.repoRoot,
        siteRoot: dirFixture.siteRoot,
        publicDir: dirFixture.publicDir,
        clearAstroCache: false,
        log: () => {},
      }),
    /Required CNAME file not found/,
  );
});

test('prepareSpecAssets stages all required JSON schemas/catalogs from repo and excludes internal non-JSON files', t => {
  const tempPublicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-prepare-spec-public-'));
  t.after(() => {
    fs.rmSync(tempPublicDir, {recursive: true, force: true});
  });

  // Pre-seed stale internal artifacts to verify clean re-staging wipes them.
  const stalePath = path.join(tempPublicDir, 'specification/proposals/stale_proposal.md');
  fs.mkdirSync(path.dirname(stalePath), {recursive: true});
  fs.writeFileSync(stalePath, '# Stale', 'utf8');

  prepareSpecAssets({
    repoRoot: realRepoRoot,
    siteRoot: realSiteRoot,
    publicDir: tempPublicDir,
    clearAstroCache: false,
    log: () => {},
  });

  assert.equal(fs.readFileSync(path.join(tempPublicDir, 'CNAME'), 'utf8').trim(), 'a2ui.org');
  assert.equal(fs.existsSync(path.join(tempPublicDir, '.nojekyll')), true);
  assert.equal(fs.existsSync(path.join(tempPublicDir, 'llms.txt')), true);

  const specRoot = path.join(tempPublicDir, 'specification');
  const stagedSpecFiles = walkRelativeFiles(specRoot);
  assert.ok(stagedSpecFiles.length > 0, 'Expected staged specification files');

  // Every staged file under public/specification/ must be a .json asset.
  const nonJsonFiles = stagedSpecFiles.filter(rel => !rel.endsWith('.json'));
  assert.deepEqual(
    nonJsonFiles,
    [],
    `Unexpected non-JSON files staged in public/specification/: ${nonJsonFiles.join(', ')}`,
  );

  // Forbidden internal subdirectories must never be published.
  for (const forbiddenPrefix of [
    'proposals/',
    'scripts/',
    'inference_formats/',
    'v0_8/docs/',
    'v0_9/docs/',
    'v0_9/test/',
    'v0_9_1/docs/',
    'v0_9_1/test/',
    'v1_0/docs/',
    'v1_0/test/',
    'v1_0/extensions/a2a/docs/',
  ]) {
    assert.equal(
      stagedSpecFiles.some(rel => rel.startsWith(forbiddenPrefix)),
      false,
      `Forbidden internal path leaked into public/specification/: ${forbiddenPrefix}`,
    );
  }

  // Required versions.json, protocol schemas, catalog schemas, and examples must all resolve.
  assert.equal(stagedSpecFiles.includes('versions.json'), true);

  for (const schemas of Object.values(SPEC_SCHEMAS)) {
    for (const schema of schemas) {
      const stagedPath = path.join(tempPublicDir, schema.rawPublicPath.replace(/^\//, ''));
      assert.equal(
        fs.existsSync(stagedPath),
        true,
        `Missing staged schema: ${schema.rawPublicPath}`,
      );
    }
  }

  for (const catalogs of Object.values(SPEC_CATALOG_SCHEMAS)) {
    for (const catalog of catalogs) {
      const stagedPath = path.join(tempPublicDir, catalog.rawPublicPath.replace(/^\//, ''));
      assert.equal(
        fs.existsSync(stagedPath),
        true,
        `Missing staged catalog schema: ${catalog.rawPublicPath}`,
      );
    }
  }

  // Verify flattened legacy v0.8 / v0.9 schemas and catalog example bundles remain intact.
  for (const expectedRel of [
    'v0_8/server_to_client.json',
    'v0_8/json/catalogs/basic/examples/flight-status.json',
    'v0_9/server_to_client.json',
    'v0_9/catalogs/basic/catalog.json',
    'v0_9/catalogs/minimal/catalog.json',
    'v0_9/catalogs/mcp/mcp_catalog.json',
    'v0_9_1/catalogs/basic/examples/flight-status.json',
    'v1_0/catalogs/basic/examples/flight-status.json',
    'v1_0/catalogs/mcp/examples/mcp-app-3d-geometry.json',
  ]) {
    assert.equal(
      stagedSpecFiles.includes(expectedRel),
      true,
      `Expected staged JSON file missing: specification/${expectedRel}`,
    );
  }
});

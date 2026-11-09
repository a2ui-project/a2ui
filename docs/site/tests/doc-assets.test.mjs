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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {downloadVerified, fetchDocAssets} from '../scripts/fetch-doc-assets.mjs';
import {localDocAssetUrl, rehypeLocalDocAssets} from '../src/plugins/rehype-local-doc-assets.mjs';

const BYTES = Buffer.from('image bytes');
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const URL_A =
  'https://github.com/a2ui-project/a2ui/releases/download/docs-assets/page--shot.abcd1234.webp';
const MANIFEST = {
  assets: {
    'page/shot': {filename: 'page--shot.abcd1234.webp', url: URL_A, sha256: SHA},
  },
};

function fakeFetch(responses) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      arrayBuffer: async () => next.body ?? new ArrayBuffer(0),
    };
  };
  return {impl, calls};
}

const LOCAL = () => true;
const NOT_LOCAL = () => false;

test('localDocAssetUrl maps manifest release URLs to the local copy under the base path', () => {
  assert.equal(
    localDocAssetUrl(URL_A, MANIFEST, '', LOCAL),
    '/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(
    localDocAssetUrl(URL_A, MANIFEST, '/preview', LOCAL),
    '/preview/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(
    localDocAssetUrl('https://example.org/a.png', MANIFEST),
    'https://example.org/a.png',
  );
  assert.equal(localDocAssetUrl('../local.svg', MANIFEST), '../local.svg');
});

test('localDocAssetUrl keeps the release URL when the build has no local copy', () => {
  assert.equal(localDocAssetUrl(URL_A, MANIFEST, '/preview', NOT_LOCAL), URL_A);
});

test('localDocAssetUrl rejects release URLs that are not in the manifest', () => {
  assert.throws(
    () =>
      localDocAssetUrl(
        'https://github.com/a2ui-project/a2ui/releases/download/docs-assets/missing.webp',
        MANIFEST,
      ),
    /not listed in docs\/site\/assets-manifest\.json/,
  );
});

test('rehypeLocalDocAssets rewrites Markdown images and MDX <img> elements', () => {
  const tree = {
    type: 'root',
    children: [
      {type: 'element', tagName: 'img', properties: {src: URL_A, alt: 'shot'}, children: []},
      {
        type: 'mdxJsxFlowElement',
        name: 'img',
        attributes: [
          {type: 'mdxJsxAttribute', name: 'src', value: URL_A},
          {type: 'mdxJsxAttribute', name: 'alt', value: 'shot'},
        ],
        children: [],
      },
    ],
  };
  rehypeLocalDocAssets({manifest: MANIFEST, basePrefix: '/preview', isLocal: LOCAL})(tree);
  assert.equal(tree.children[0].properties.src, '/preview/docs-assets/page--shot.abcd1234.webp');
  assert.equal(
    tree.children[1].attributes[0].value,
    '/preview/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(tree.children[1].attributes[1].value, 'shot');
});

test('downloadVerified retries gateway timeouts and returns bytes that match the hash', async () => {
  const {impl, calls} = fakeFetch([
    {status: 504},
    new Error('socket hang up'),
    {status: 200, body: BYTES},
  ]);
  const buffer = await downloadVerified(URL_A, SHA, {fetchImpl: impl, baseDelayMs: 0});
  assert.deepEqual(buffer, BYTES);
  assert.equal(calls.length, 3);
});

test('downloadVerified fails after the last attempt when the bytes do not match the hash', async () => {
  const {impl} = fakeFetch([
    {status: 200, body: Buffer.from('other')},
    {status: 200, body: Buffer.from('other')},
  ]);
  await assert.rejects(
    downloadVerified(URL_A, SHA, {fetchImpl: impl, attempts: 2, baseDelayMs: 0}),
    /does not match manifest/,
  );
});

test('fetchDocAssets downloads missing files and reuses ones with the right hash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-assets-test-'));
  try {
    const manifestPath = path.join(dir, 'assets-manifest.json');
    const outDir = path.join(dir, 'out');
    fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST));

    const first = fakeFetch([{status: 200, body: BYTES}]);
    const result = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: first.impl,
      baseDelayMs: 0,
      log: () => {},
    });
    assert.deepEqual(result, {downloaded: 1, reused: 0, missing: []});
    assert.deepEqual(fs.readFileSync(path.join(outDir, 'page--shot.abcd1234.webp')), BYTES);

    const second = fakeFetch([]);
    const again = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: second.impl,
      baseDelayMs: 0,
      log: () => {},
    });
    assert.deepEqual(again, {downloaded: 0, reused: 1, missing: []});
    assert.equal(second.calls.length, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('fetchDocAssets warns and continues when a download keeps failing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-assets-test-'));
  try {
    const manifestPath = path.join(dir, 'assets-manifest.json');
    const outDir = path.join(dir, 'out');
    fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST));

    const warnings = [];
    const {impl} = fakeFetch([{status: 504}, {status: 504}]);
    const result = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: impl,
      attempts: 2,
      baseDelayMs: 0,
      log: () => {},
      warn: message => warnings.push(message),
    });
    assert.deepEqual(result, {downloaded: 0, reused: 0, missing: ['page/shot']});
    assert.equal(fs.existsSync(path.join(outDir, 'page--shot.abcd1234.webp')), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^::warning::.*HTTP 504.*release URL/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

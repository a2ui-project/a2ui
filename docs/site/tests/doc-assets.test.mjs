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
import {
  parseMp4Dimensions,
  prepareDocAsset,
  verifyManifestAndRepoAssets,
} from '../scripts/upload-doc-asset.mjs';
import {localDocAssetUrl, rehypeLocalDocAssets} from '../src/plugins/rehype-local-doc-assets.mjs';

const BYTES = Buffer.from('image bytes');
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const URL_A =
  'https://github.com/a2ui-project/a2ui/releases/download/docs-assets/page--shot.abcd1234.webp';
const MANIFEST = {
  repo: 'a2ui-project/a2ui',
  releaseTag: 'docs-assets',
  baseUrl: 'https://github.com/a2ui-project/a2ui/releases/download/docs-assets',
  assets: {
    'page/shot': {
      filename: 'page--shot.abcd1234.webp',
      url: URL_A,
      sha256: SHA,
      width: 800,
      height: 600,
    },
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

test('localDocAssetUrl maps manifest release URLs to the local copy under the base path', () => {
  assert.equal(localDocAssetUrl(URL_A, MANIFEST), '/docs-assets/page--shot.abcd1234.webp');
  assert.equal(
    localDocAssetUrl(URL_A, MANIFEST, '/preview'),
    '/preview/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(
    localDocAssetUrl(URL_A, MANIFEST, '/preview/'),
    '/preview/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(
    localDocAssetUrl('https://example.org/a.png', MANIFEST),
    'https://example.org/a.png',
  );
  assert.equal(
    localDocAssetUrl(
      'https://github.com/other-project/other-repo/releases/download/v1/image.png',
      MANIFEST,
    ),
    'https://github.com/other-project/other-repo/releases/download/v1/image.png',
  );
  assert.equal(localDocAssetUrl('../local.svg', MANIFEST), '../local.svg');
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
      {
        type: 'element',
        tagName: 'img',
        properties: {src: `${URL_A}?v=1#hash`, alt: 'shot'},
        children: [],
      },
      {
        type: 'raw',
        value: `<p><img src="${URL_A}" alt="raw shot"></p>`,
      },
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
  rehypeLocalDocAssets({manifest: MANIFEST, basePrefix: '/preview'})(tree);
  assert.equal(tree.children[0].properties.src, '/preview/docs-assets/page--shot.abcd1234.webp');
  assert.equal(tree.children[0].properties.width, 800);
  assert.equal(tree.children[0].properties.height, 600);
  assert.equal(
    tree.children[1].value,
    '<p><img src="/preview/docs-assets/page--shot.abcd1234.webp" alt="raw shot"></p>',
  );
  assert.equal(
    tree.children[2].attributes.find(a => a.name === 'src').value,
    '/preview/docs-assets/page--shot.abcd1234.webp',
  );
  assert.equal(tree.children[2].attributes.find(a => a.name === 'width').value, '800');
  assert.equal(tree.children[2].attributes.find(a => a.name === 'height').value, '600');
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

test('fetchDocAssets downloads missing files, prunes orphans, and reuses matching ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-assets-test-'));
  try {
    const manifestPath = path.join(dir, 'assets-manifest.json');
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(path.join(outDir, 'orphan.webp'), Buffer.from('old bytes'));
    fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST));

    const first = fakeFetch([{status: 200, body: BYTES}]);
    const result = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: first.impl,
      baseDelayMs: 0,
      log: () => {},
    });
    assert.deepEqual(result, {downloaded: 1, reused: 0, pruned: 1});
    assert.deepEqual(fs.readFileSync(path.join(outDir, 'page--shot.abcd1234.webp')), BYTES);
    assert.equal(fs.existsSync(path.join(outDir, 'orphan.webp')), false);

    const second = fakeFetch([]);
    const again = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: second.impl,
      baseDelayMs: 0,
      log: () => {},
    });
    assert.deepEqual(again, {downloaded: 0, reused: 1, pruned: 0});
    assert.equal(second.calls.length, 0);

    // Corrupted existing file is re-downloaded
    fs.writeFileSync(path.join(outDir, 'page--shot.abcd1234.webp'), Buffer.from('corrupted'));
    const third = fakeFetch([{status: 200, body: BYTES}]);
    const reDownload = await fetchDocAssets({
      manifestPath,
      outDir,
      fetchImpl: third.impl,
      baseDelayMs: 0,
      log: () => {},
    });
    assert.equal(reDownload.downloaded, 1);
    assert.deepEqual(fs.readFileSync(path.join(outDir, 'page--shot.abcd1234.webp')), BYTES);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

function buildMinimalMp4Buffer(width, height) {
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write('tkhd', 4, 'ascii');
  tkhd.writeUInt32BE(width * 65536, 84);
  tkhd.writeUInt32BE(height * 65536, 88);

  const trakLen = 8 + tkhd.length;
  const trak = Buffer.alloc(8);
  trak.writeUInt32BE(trakLen, 0);
  trak.write('trak', 4, 'ascii');

  const moovLen = 8 + trakLen;
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(moovLen, 0);
  moov.write('moov', 4, 'ascii');

  return Buffer.concat([moov, trak, tkhd]);
}

test('parseMp4Dimensions extracts tkhd visual dimensions and prepareDocAsset handles svg and mp4', async () => {
  const mp4Buf = buildMinimalMp4Buffer(1280, 800);
  assert.deepEqual(parseMp4Dimensions(mp4Buf), {width: 1280, height: 800});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-assets-prepare-'));
  try {
    const svgPath = path.join(dir, 'logo.svg');
    const svgXml =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 28"><rect width="120" height="28"/></svg>';
    fs.writeFileSync(svgPath, svgXml, 'utf8');
    const svgPrepared = await prepareDocAsset(svgPath);
    assert.equal(svgPrepared.ext, 'svg');
    assert.equal(svgPrepared.width, 120);
    assert.equal(svgPrepared.height, 28);
    assert.equal(svgPrepared.bytes, Buffer.byteLength(svgXml));

    const mp4Path = path.join(dir, 'clip.mp4');
    fs.writeFileSync(mp4Path, mp4Buf);
    const mp4Prepared = await prepareDocAsset(mp4Path);
    assert.equal(mp4Prepared.ext, 'mp4');
    assert.equal(mp4Prepared.width, 1280);
    assert.equal(mp4Prepared.height, 800);
    assert.equal(mp4Prepared.bytes, mp4Buf.length);

    const manifestPath = path.join(dir, 'assets-manifest.json');
    const emptyAssetsDir = path.join(dir, 'src-assets');
    fs.mkdirSync(emptyAssetsDir, {recursive: true});
    const svgName = `get-help--logo.${svgPrepared.sha256.slice(0, 8)}.svg`;
    const mp4Name = `get-help--clip.${mp4Prepared.sha256.slice(0, 8)}.mp4`;
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        repo: 'a2ui-project/a2ui',
        releaseTag: 'docs-assets',
        baseUrl: 'https://github.com/a2ui-project/a2ui/releases/download/docs-assets',
        assets: {
          'get-help/logo': {
            filename: svgName,
            url: `https://github.com/a2ui-project/a2ui/releases/download/docs-assets/${svgName}`,
            sha256: svgPrepared.sha256,
            ext: 'svg',
            width: svgPrepared.width,
            height: svgPrepared.height,
            bytes: svgPrepared.bytes,
          },
          'get-help/clip': {
            filename: mp4Name,
            url: `https://github.com/a2ui-project/a2ui/releases/download/docs-assets/${mp4Name}`,
            sha256: mp4Prepared.sha256,
            ext: 'mp4',
            width: mp4Prepared.width,
            height: mp4Prepared.height,
            bytes: mp4Prepared.bytes,
          },
        },
      }),
    );

    const verification = verifyManifestAndRepoAssets({
      manifestPath,
      srcAssetsDir: emptyAssetsDir,
    });
    assert.equal(verification.ok, true);
    assert.equal(verification.checkedAssets, 2);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

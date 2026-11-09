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

/**
 * Downloads every image listed in `docs/site/assets-manifest.json` from the
 * `docs-assets` GitHub Release into `public/docs-assets/`, so the built site
 * serves its own copies instead of linking to GitHub release downloads, which
 * time out intermittently.
 *
 * Each file is checked against the SHA-256 in the manifest. Files already
 * present with the right hash are not downloaded again. A file that still
 * fails after the retries is reported as a warning and left out; pages then use
 * its release URL, so a GitHub outage never fails the build.
 *
 * Usage:
 *   node scripts/fetch-doc-assets.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

export const DEFAULT_MANIFEST_PATH = path.join(siteRoot, 'assets-manifest.json');
export const DEFAULT_OUT_DIR = path.join(siteRoot, 'public/docs-assets');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Downloads `url` and returns its bytes once they match `expectedSha256`.
 * Retries with exponential backoff on network errors, non-2xx responses, and
 * hash mismatches.
 */
export async function downloadVerified(
  url,
  expectedSha256,
  {fetchImpl = fetch, attempts = 6, baseDelayMs = 1000} = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {redirect: 'follow'});
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const actual = sha256(buffer);
      if (actual !== expectedSha256) {
        throw new Error(`sha256 ${actual} does not match manifest ${expectedSha256}`);
      }
      return buffer;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`Could not download ${url} after ${attempts} attempts: ${lastError.message}`);
}

/**
 * Makes sure every manifest asset exists in `outDir` with the right hash.
 * Returns the number of files downloaded and reused, and the IDs of assets
 * that could not be downloaded.
 */
export async function fetchDocAssets({
  manifestPath = DEFAULT_MANIFEST_PATH,
  outDir = DEFAULT_OUT_DIR,
  fetchImpl = fetch,
  attempts = 5,
  baseDelayMs = 1000,
  log = console.log,
  warn = console.warn,
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.mkdirSync(outDir, {recursive: true});

  let downloaded = 0;
  let reused = 0;
  const missing = [];
  for (const [id, entry] of Object.entries(manifest.assets || {})) {
    const target = path.join(outDir, entry.filename);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === entry.sha256) {
      reused++;
      continue;
    }
    log(`[fetch-doc-assets] Downloading ${id} (${entry.filename})`);
    try {
      const buffer = await downloadVerified(entry.url, entry.sha256, {
        fetchImpl,
        attempts,
        baseDelayMs,
      });
      fs.writeFileSync(target, buffer);
      downloaded++;
    } catch (err) {
      fs.rmSync(target, {force: true});
      missing.push(id);
      // The `::warning::` prefix shows up as an annotation in GitHub Actions.
      warn(`::warning::[fetch-doc-assets] ${err.message}. Pages will link to the release URL.`);
    }
  }
  return {downloaded, reused, missing};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fetchDocAssets()
    .then(({downloaded, reused, missing}) => {
      console.log(
        `[fetch-doc-assets] ${downloaded} downloaded, ${reused} already present, ${missing.length} using the release URL.`,
      );
    })
    .catch(err => {
      console.error(`[fetch-doc-assets] Error: ${err.message}`);
      process.exit(1);
    });
}

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
 * Content-addressed GitHub Release asset uploader & manifest verifier for
 * `docs/site`.
 *
 * Why this exists:
 * - Prevents binary screenshots and videos from bloating Git commit history in
 *   `docs/site/src/assets/`.
 * - Converts raster screenshots (`.png`, `.jpg`, `.jpeg`, `.webp`) to optimized
 *   `.webp` files using `sharp`.
 * - Names every uploaded asset `<namespace--name>.<sha256_8>.webp` so uploads
 *   are immutable and idempotent: identical bytes keep the same filename and
 *   skip re-uploading, while updated screenshots receive a new hash without
 *   ever passing `--clobber` or overwriting live assets referenced by `main` or
 *   in-flight PRs.
 * - Tracks all published documentation assets in `docs/site/assets-manifest.json`
 *   so PR diffs clearly record added/updated URLs, dimensions, and checksums.
 *
 * Usage:
 *   # Upload a single image:
 *   node scripts/upload-doc-asset.mjs --id quickstart/travel-a2ui/chat --file temp_docs/assets/chat.png
 *
 *   # Upload all images in a directory under a namespace:
 *   node scripts/upload-doc-asset.mjs --namespace quickstart/travel-a2ui --dir temp_docs/assets/quickstart/travel-a2ui
 *
 *   # Verify manifest integrity and ensure no raster binaries exist in src/assets/:
 *   node scripts/upload-doc-asset.mjs --verify
 */

import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSiteRoot = path.resolve(__dirname, '..');
const defaultManifestPath = path.join(defaultSiteRoot, 'assets-manifest.json');
const defaultSrcAssetsDir = path.join(defaultSiteRoot, 'src/assets');

export const DEFAULT_REPO = 'a2ui-project/a2ui';
export const DEFAULT_RELEASE_TAG = 'docs-assets';

const BANNED_RASTER_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.mov',
  '.webm',
  '.avif',
]);

/**
 * Formats a logical asset ID (`quickstart/travel-a2ui/chat`) and SHA-256 hex
 * digest into a flat, content-addressed GitHub Release asset filename
 * (`quickstart--travel-a2ui--chat.8f3a19c2.webp`).
 */
export function formatAssetFilename(id, sha256, ext = 'webp') {
  const cleanId = String(id || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(cleanId)) {
    throw new Error(
      `Invalid asset id "${id}". Expected slash-separated alphanumeric segments (e.g. "quickstart/travel-a2ui/chat").`,
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(`Invalid sha256 digest "${sha256}". Expected 64-character hex string.`);
  }
  const cleanExt = String(ext || 'webp')
    .replace(/^\./, '')
    .toLowerCase();
  const flatName = cleanId.replace(/\//g, '--');
  const hash8 = sha256.slice(0, 8).toLowerCase();
  return `${flatName}.${hash8}.${cleanExt}`;
}

export function buildReleaseAssetUrl(repo, releaseTag, filename) {
  return `https://github.com/${repo}/releases/download/${releaseTag}/${filename}`;
}

/**
 * Converts a local raster image to WebP via `sharp` and computes its SHA-256
 * digest and dimensions.
 */
export async function optimizeImageToWebp(inputPath, {maxWidth = 1920, quality = 85} = {}) {
  const sharpMod = await import('sharp');
  const sharp = sharpMod.default || sharpMod;

  const inputBuffer = fs.readFileSync(inputPath);
  let pipeline = sharp(inputBuffer);
  const meta = await pipeline.metadata();

  if (meta.width && maxWidth && meta.width > maxWidth) {
    pipeline = pipeline.resize({width: maxWidth, withoutEnlargement: true});
  }

  const {data, info} = await pipeline.webp({quality}).toBuffer({resolveWithObject: true});
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    bytes: data.length,
    sha256,
    ext: 'webp',
  };
}

export function loadManifest(manifestPath = defaultManifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return {
      repo: DEFAULT_REPO,
      releaseTag: DEFAULT_RELEASE_TAG,
      baseUrl: `https://github.com/${DEFAULT_REPO}/releases/download/${DEFAULT_RELEASE_TAG}`,
      assets: {},
    };
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function saveManifest(manifest, manifestPath = defaultManifestPath) {
  const sortedAssets = {};
  for (const key of Object.keys(manifest.assets || {}).sort()) {
    sortedAssets[key] = manifest.assets[key];
  }
  const normalized = {
    repo: manifest.repo || DEFAULT_REPO,
    releaseTag: manifest.releaseTag || DEFAULT_RELEASE_TAG,
    baseUrl:
      manifest.baseUrl ||
      `https://github.com/${manifest.repo || DEFAULT_REPO}/releases/download/${manifest.releaseTag || DEFAULT_RELEASE_TAG}`,
    assets: sortedAssets,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * Verifies:
 * 1. No raster binary images/videos are checked into `docs/site/src/assets/`.
 * 2. Every entry in `docs/site/assets-manifest.json` is well-formed and its
 *    `filename` and `url` match its `id` and `sha256`.
 */
export function verifyManifestAndRepoAssets({
  manifestPath = defaultManifestPath,
  srcAssetsDir = defaultSrcAssetsDir,
} = {}) {
  const errors = [];

  // 1. Check src/assets/ for banned binary media files
  if (fs.existsSync(srcAssetsDir)) {
    for (const absFile of walkFiles(srcAssetsDir)) {
      const ext = path.extname(absFile).toLowerCase();
      if (BANNED_RASTER_EXTENSIONS.has(ext)) {
        const rel = path.relative(defaultSiteRoot, absFile).replace(/\\/g, '/');
        errors.push(
          `Binary media file "${rel}" checked into src/assets/. Upload raster images to the "${DEFAULT_RELEASE_TAG}" GitHub release via "node scripts/upload-doc-asset.mjs" instead.`,
        );
      }
    }
  }

  // 2. Validate assets-manifest.json
  if (!fs.existsSync(manifestPath)) {
    errors.push(`Manifest file not found at ${manifestPath}`);
    return {ok: false, errors, checkedAssets: 0};
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    errors.push(`Invalid JSON in ${manifestPath}: ${err.message}`);
    return {ok: false, errors, checkedAssets: 0};
  }

  const repo = manifest.repo || DEFAULT_REPO;
  const releaseTag = manifest.releaseTag || DEFAULT_RELEASE_TAG;
  const assets = manifest.assets || {};
  let checkedAssets = 0;

  for (const [id, entry] of Object.entries(assets)) {
    checkedAssets++;
    if (!entry || typeof entry !== 'object') {
      errors.push(`Asset "${id}": entry must be an object.`);
      continue;
    }
    try {
      const expectedFilename = formatAssetFilename(id, entry.sha256, entry.ext || 'webp');
      if (entry.filename !== expectedFilename) {
        errors.push(
          `Asset "${id}": filename "${entry.filename}" does not match content-addressed name "${expectedFilename}".`,
        );
      }
      const expectedUrl = buildReleaseAssetUrl(repo, releaseTag, expectedFilename);
      if (entry.url !== expectedUrl) {
        errors.push(`Asset "${id}": url "${entry.url}" does not match "${expectedUrl}".`);
      }
    } catch (err) {
      errors.push(`Asset "${id}": ${err.message}`);
    }

    if (
      !Number.isInteger(entry.width) ||
      entry.width <= 0 ||
      !Number.isInteger(entry.height) ||
      entry.height <= 0
    ) {
      errors.push(
        `Asset "${id}": width (${entry.width}) and height (${entry.height}) must be positive integers.`,
      );
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      errors.push(`Asset "${id}": bytes (${entry.bytes}) must be a positive integer.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checkedAssets,
  };
}

function resolveUpstreamToken() {
  if (process.env.A2UI_UPSTREAM_TOKEN) return process.env.A2UI_UPSTREAM_TOKEN;
  if (process.env.GITHUB_PERSONAL_ADMIN_TOKEN) return process.env.GITHUB_PERSONAL_ADMIN_TOKEN;
  const rcCommon = path.join(os.homedir(), '.config/shell/rc.common');
  if (fs.existsSync(rcCommon)) {
    try {
      const out = execFileSync(
        'bash',
        [
          '-c',
          'source ~/.config/shell/rc.common 2>/dev/null && printf "%s" "${A2UI_UPSTREAM_TOKEN:-${GITHUB_PERSONAL_ADMIN_TOKEN:-}}"',
        ],
        {encoding: 'utf8'},
      ).trim();
      if (out) return out;
    } catch {
      // Fall through to default gh auth
    }
  }
  return null;
}

function runGh(args) {
  const env = {
    ...process.env,
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:${os.homedir()}/homebrew/bin:${process.env.PATH || ''}`,
  };
  const upstreamToken = resolveUpstreamToken();
  if (upstreamToken) {
    env.GH_TOKEN = upstreamToken;
  }
  return execFileSync('gh', args, {env, encoding: 'utf8'});
}

function ensureReleaseAndListAssets(repo, releaseTag) {
  try {
    const out = runGh(['release', 'view', releaseTag, '-R', repo, '--json', 'assets']);
    const parsed = JSON.parse(out);
    return new Set((parsed.assets || []).map(a => a.name));
  } catch {
    console.log(
      `[upload-doc-asset] Release "${releaseTag}" not found on ${repo}; creating prerelease bucket...`,
    );
    runGh([
      'release',
      'create',
      releaseTag,
      '-R',
      repo,
      '--title',
      'Documentation Media Assets (Do Not Delete)',
      '--notes',
      'Immutable, content-addressed media assets referenced by docs/site/assets-manifest.json.',
      '--prerelease',
      '--latest=false',
    ]);
    return new Set();
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  let verifyOnly = false;
  let dryRun = false;
  let id = null;
  let file = null;
  let dir = null;
  let namespace = null;
  let maxWidth = 1920;
  let quality = 85;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verify') {
      verifyOnly = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--id' && args[i + 1]) {
      id = args[++i];
    } else if (arg === '--file' && args[i + 1]) {
      file = args[++i];
    } else if (arg === '--dir' && args[i + 1]) {
      dir = args[++i];
    } else if (arg === '--namespace' && args[i + 1]) {
      namespace = args[++i];
    } else if (arg === '--max-width' && args[i + 1]) {
      maxWidth = parseInt(args[++i], 10);
    } else if (arg === '--quality' && args[i + 1]) {
      quality = parseInt(args[++i], 10);
    }
  }

  if (verifyOnly) {
    const result = verifyManifestAndRepoAssets();
    if (!result.ok) {
      console.error(
        `\n[upload-doc-asset] Verification failed with ${result.errors.length} error(s):`,
      );
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log(
      `[upload-doc-asset] Verified ${result.checkedAssets} asset(s) in assets-manifest.json and 0 binary images in src/assets/.`,
    );
    return;
  }

  /** @type {Array<{id: string, filePath: string}>} */
  const items = [];
  if (id && file) {
    items.push({id, filePath: path.resolve(file)});
  } else if (dir && namespace) {
    const absDir = path.resolve(dir);
    for (const entry of fs.readdirSync(absDir).sort()) {
      const ext = path.extname(entry).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const baseName = path.basename(entry, ext);
        const cleanNs = namespace.replace(/^\/+|\/+$/g, '');
        items.push({
          id: `${cleanNs}/${baseName}`,
          filePath: path.join(absDir, entry),
        });
      }
    }
  } else {
    console.error(
      'Usage:\n  node scripts/upload-doc-asset.mjs --id <namespace/name> --file <path>\n  node scripts/upload-doc-asset.mjs --namespace <namespace> --dir <dir>\n  node scripts/upload-doc-asset.mjs --verify',
    );
    process.exit(1);
  }

  const manifest = loadManifest();
  const repo = manifest.repo || DEFAULT_REPO;
  const releaseTag = manifest.releaseTag || DEFAULT_RELEASE_TAG;
  const existingAssets = dryRun ? new Set() : ensureReleaseAndListAssets(repo, releaseTag);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-doc-assets-'));
  try {
    for (const item of items) {
      const optimized = await optimizeImageToWebp(item.filePath, {maxWidth, quality});
      const filename = formatAssetFilename(item.id, optimized.sha256, optimized.ext);
      const url = buildReleaseAssetUrl(repo, releaseTag, filename);
      const tmpOut = path.join(tmpDir, filename);
      fs.writeFileSync(tmpOut, optimized.buffer);

      if (dryRun) {
        console.log(
          `[upload-doc-asset] [DRY-RUN] ${item.id} -> ${filename} (${(optimized.bytes / 1024).toFixed(1)} KB, ${optimized.width}x${optimized.height})`,
        );
      } else if (existingAssets.has(filename)) {
        console.log(
          `[upload-doc-asset] ✓ Already exists on release "${releaseTag}": ${filename} (skipping upload)`,
        );
      } else {
        console.log(
          `[upload-doc-asset] ↑ Uploading ${filename} (${(optimized.bytes / 1024).toFixed(1)} KB, ${optimized.width}x${optimized.height}) to ${repo}@${releaseTag}...`,
        );
        // Never pass --clobber: content-addressed filenames are immutable.
        runGh(['release', 'upload', releaseTag, tmpOut, '-R', repo]);
        existingAssets.add(filename);
      }

      manifest.assets[item.id] = {
        filename,
        url,
        sha256: optimized.sha256,
        width: optimized.width,
        height: optimized.height,
        bytes: optimized.bytes,
      };
    }
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }

  saveManifest(manifest);
  console.log(`[upload-doc-asset] Updated ${path.relative(process.cwd(), defaultManifestPath)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch(err => {
    console.error(`[upload-doc-asset] Error: ${err.message}`);
    process.exit(1);
  });
}

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
 * Validates that all #fragment anchor references across built HTML pages in
 * docs/site/dist resolve to an existing id="..." or name="..." anchor on the
 * target page.
 *
 * Catches broken intra-page (#term) and cross-page (/path/#term) anchors
 * before publishing, without requiring third-party link checkers or network access.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

// CLI arguments
const args = process.argv.slice(2);
let customDist = null;
let customBase = null;
let checkPages = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dist' && args[i + 1]) {
    customDist = args[++i];
  } else if (args[i] === '--base' && args[i + 1]) {
    customBase = args[++i];
  } else if (args[i] === '--check-pages') {
    checkPages = true;
  }
}

const distDir = customDist ? path.resolve(customDist) : path.join(siteRoot, 'dist');
const basePrefix = (customBase !== null ? customBase : process.env.ASTRO_BASE || '')
  .replace(/\/+$/, '')
  .trim();

if (!fs.existsSync(distDir)) {
  console.error(
    `[check-anchors] Error: dist/ directory not found at ${distDir}.\nRun "npm run build" or "astro build" before running check-anchors.`,
  );
  process.exit(1);
}

/** Recursively collects all .html files under a directory. */
function walkHtmlFiles(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(full, list);
    } else if (entry.name.endsWith('.html')) {
      list.push(full);
    }
  }
  return list;
}

const allHtmlFiles = walkHtmlFiles(distDir);
if (allHtmlFiles.length === 0) {
  console.error(`[check-anchors] Error: No .html files found in ${distDir}.`);
  process.exit(1);
}

/** Cache of element IDs and anchor names per HTML file. */
const idCache = new Map();

function getPageIds(absHtmlPath) {
  if (idCache.has(absHtmlPath)) return idCache.get(absHtmlPath);
  const html = fs.readFileSync(absHtmlPath, 'utf8');
  const ids = new Set();

  // id="..." or id='...'
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) {
    ids.add(m[1]);
  }
  // <a ... name="..." or name='...'>
  for (const m of html.matchAll(/<a\s+[^>]*\bname=["']([^"']+)["']/gi)) {
    ids.add(m[1]);
  }

  idCache.set(absHtmlPath, ids);
  return ids;
}

/** Resolves an href path to a physical HTML file in distDir. */
function resolveHtmlTarget(sourceFile, urlPath) {
  let cleanPath = urlPath;

  // Strip ASTRO_BASE prefix if present (e.g. /preview/concepts/... -> /concepts/...)
  if (basePrefix && cleanPath.startsWith(`${basePrefix}/`)) {
    cleanPath = cleanPath.slice(basePrefix.length);
  } else if (basePrefix && cleanPath === basePrefix) {
    cleanPath = '/';
  }

  let candidate;
  if (cleanPath.startsWith('/')) {
    const relFromDist = cleanPath.replace(/^\/+/, '');
    candidate = path.join(distDir, relFromDist);
  } else {
    candidate = path.resolve(path.dirname(sourceFile), cleanPath);
  }

  // Check direct file (e.g. 404.html, index.html)
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate.endsWith('.html') ? candidate : null;
  }

  // Check directory index.html
  const asIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(asIndex) && fs.statSync(asIndex).isFile()) {
    return asIndex;
  }

  return null;
}

const errors = [];
let checkedAnchors = 0;
let checkedFiles = 0;

for (const htmlFile of allHtmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const relSource = path.relative(siteRoot, htmlFile);
  checkedFiles++;

  for (const m of html.matchAll(/\bhref=["']([^"']+)["']/g)) {
    const href = m[1];

    // Skip external protocols and protocol-relative links
    if (/^(?:https?:|mailto:|tel:|javascript:|\/\/)/.test(href)) {
      continue;
    }

    // Only process links with a #fragment anchor
    if (!href.includes('#')) {
      continue;
    }

    const [urlPath, rawFrag] = href.split('#');

    // Skip bare '#' and top-of-page markers
    if (!rawFrag || rawFrag === '_top' || rawFrag === 'top') {
      continue;
    }

    let targetHtml;
    if (!urlPath) {
      targetHtml = htmlFile;
    } else {
      targetHtml = resolveHtmlTarget(htmlFile, urlPath);
      if (!targetHtml) {
        if (checkPages) {
          errors.push(`${relSource}: Broken link "${href}" — target page does not exist in dist/`);
        }
        continue;
      }
    }

    checkedAnchors++;
    const targetIds = getPageIds(targetHtml);
    const decodedFrag = decodeURIComponent(rawFrag);

    // Support JSON pointer anchors used by the Schema Explorer
    // (e.g. #message.json/properties/root resolves to element id="message.json")
    const baseFrag = decodedFrag.replace(/^\/+/, '').split('/')[0];

    const hasMatch =
      targetIds.has(decodedFrag) ||
      targetIds.has(rawFrag) ||
      targetIds.has(baseFrag) ||
      targetIds.has(decodeURIComponent(baseFrag));

    if (!hasMatch) {
      const relTarget = path.relative(siteRoot, targetHtml);
      errors.push(
        `${relSource}: Broken anchor "${href}" — #${decodedFrag} not found in ${relTarget}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`\n[check-anchors] Found ${errors.length} broken anchor link(s):`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `[check-anchors] Verified ${checkedAnchors} #fragment anchor(s) across ${checkedFiles} HTML pages in ${path.relative(siteRoot, distDir)}. 0 broken anchors.`,
);

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
 * Post-build HTML link, route, ASTRO_BASE containment, and #fragment anchor
 * validator for docs/site/dist.
 *
 * Inspects rendered HTML output across docs/site/dist to verify:
 * 1. Internal <a href>, <area href>, <meta http-equiv="refresh"> redirects,
 *    and static asset references (<img src>, <script src>, <link href>) stay
 *    within ASTRO_BASE when configured and resolve to existing built files.
 * 2. Every internal link or redirect carrying a #fragment targeting a built
 *    HTML page resolves to an existing DOM id="..." or <a name="..."> (ignoring
 *    elements inside <template>, <script>, <style>, and HTML comments), or to a
 *    valid JSON Schema Explorer pointer (#<schema>.json/<pointer>).
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  findRepoRoot,
  loadVersionSchemas,
  normalizeBasePrefix,
  SPEC_CATALOG_SCHEMAS,
  SPEC_SCHEMAS,
} from '../src/lib/spec-schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSiteRoot = path.resolve(__dirname, '..');

const CHECKED_LINK_RELS = new Set([
  'icon',
  'shortcut',
  'apple-touch-icon',
  'stylesheet',
  'preload',
  'modulepreload',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

const NAMED_HTML_ENTITIES = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
};

function decodeHtmlAttrEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|quot|apos|lt|gt));/gi,
    (full, dec, hex, named) => {
      if (dec !== undefined || hex !== undefined) {
        const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
        if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff)) {
          return String.fromCodePoint(cp);
        }
        return full;
      }
      return NAMED_HTML_ENTITIES[named.toLowerCase()] ?? full;
    },
  );
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out.sort();
}

function parseTagAttributes(rawAttrs) {
  /** @type {Map<string, string>} */
  const attrs = new Map();
  const attrRegex =
    /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of rawAttrs.matchAll(attrRegex)) {
    const name = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    if (!attrs.has(name)) {
      attrs.set(name, decodeHtmlAttrEntities(val));
    }
  }
  return attrs;
}

/**
 * Quote-aware HTML scanner that extracts rendered element IDs (`id="..."`,
 * `<a name="...">`) and internal URL references while ignoring HTML comments,
 * text/code content, `<template>` subtrees, and `<script>` / `<style>` bodies.
 */
export function parseHtmlDocument(html) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Array<{kind: 'anchor' | 'redirect' | 'asset', tag: string, rawUrl: string}>} */
  const references = [];

  let templateDepth = 0;
  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // HTML comments: <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const commentEnd = html.indexOf('-->', lt + 4);
      i = commentEnd === -1 ? len : commentEnd + 3;
      continue;
    }

    // Inline SVG / XML CDATA sections: <![CDATA[ ... ]]>
    if (html.startsWith('<![CDATA[', lt)) {
      const cdataEnd = html.indexOf(']]>', lt + 9);
      i = cdataEnd === -1 ? len : cdataEnd + 3;
      continue;
    }

    const nextCh = html[lt + 1];
    if (!nextCh) break;

    // Declarations / processing instructions such as <!doctype html> or <?xml ...?>
    if (nextCh === '!' || nextCh === '?') {
      const declEnd = html.indexOf('>', lt + 2);
      i = declEnd === -1 ? len : declEnd + 1;
      continue;
    }

    // Closing tag: </tagName ...>
    if (nextCh === '/') {
      if (!/[a-zA-Z]/.test(html[lt + 2] || '')) {
        i = lt + 1;
        continue;
      }
      const closeEnd = html.indexOf('>', lt + 2);
      if (closeEnd === -1) break;
      const closeNameMatch = /^\/\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt + 1, closeEnd));
      if (closeNameMatch && closeNameMatch[1].toLowerCase() === 'template' && templateDepth > 0) {
        templateDepth--;
      }
      i = closeEnd + 1;
      continue;
    }

    // Bare '<' in prose (e.g. "mcp<2" or "latency < 50ms") — advance past '<' without eating '>'
    if (!/[a-zA-Z]/.test(nextCh)) {
      i = lt + 1;
      continue;
    }

    // Opening tag: scan until '>' outside single/double quotes
    let cursor = lt + 1;
    let quote = null;
    while (cursor < len) {
      const ch = html[cursor];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      cursor++;
    }
    if (cursor >= len) break;

    const tagInner = html.slice(lt + 1, cursor);
    // Treat trailing '/' as self-closing when it immediately follows the tag name (`<title/>`)
    // or follows whitespace / a closing quote (`<br />`, `<img src="x"/>`), while preserving
    // trailing slashes on unquoted attribute values such as `<a href=/foo/>`.
    const selfClosing = /^(?:[a-zA-Z][a-zA-Z0-9:-]*|[\s\S]*[\s"'])\/\s*$/.test(tagInner);
    const cleanedInner = selfClosing ? tagInner.replace(/\/\s*$/, '') : tagInner;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/.exec(cleanedInner);
    i = cursor + 1;
    if (!nameMatch) continue;

    const tagName = nameMatch[1].toLowerCase();
    const attrs = parseTagAttributes(nameMatch[2]);

    if (tagName === 'template') {
      if (!selfClosing) {
        templateDepth++;
      }
      continue;
    }

    if (templateDepth === 0) {
      const idVal = attrs.get('id');
      if (idVal) {
        ids.add(idVal);
      }

      if (tagName === 'a') {
        const nameVal = attrs.get('name');
        if (nameVal) {
          ids.add(nameVal);
        }
      }

      if (tagName === 'a' || tagName === 'area') {
        const href = attrs.get('href');
        if (href) {
          references.push({kind: 'anchor', tag: tagName, rawUrl: href});
        }
      } else if (tagName === 'meta') {
        if (attrs.get('http-equiv')?.toLowerCase() === 'refresh') {
          const content = attrs.get('content') || '';
          const refreshMatch = /^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(.+)$/i.exec(content);
          if (refreshMatch) {
            const refreshUrl = refreshMatch[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
            if (refreshUrl) {
              references.push({kind: 'redirect', tag: 'meta[refresh]', rawUrl: refreshUrl});
            }
          }
        }
      } else if (tagName === 'img') {
        const src = attrs.get('src');
        if (src) {
          references.push({kind: 'asset', tag: 'img', rawUrl: src});
        }
      } else if (tagName === 'script') {
        const src = attrs.get('src');
        if (src) {
          references.push({kind: 'asset', tag: 'script', rawUrl: src});
        }
      } else if (tagName === 'link') {
        const href = attrs.get('href');
        const relTokens = (attrs.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (href && relTokens.some(rel => CHECKED_LINK_RELS.has(rel))) {
          references.push({kind: 'asset', tag: 'link', rawUrl: href});
        }
      }
    }

    // Skip raw text content of <script>, <style>, <textarea>, and <title>
    if (RAW_TEXT_TAGS.has(tagName) && !selfClosing) {
      const closeRegex = new RegExp(`<\\/\\s*${tagName}\\b[^>]*>`, 'gi');
      closeRegex.lastIndex = i;
      const closeMatch = closeRegex.exec(html);
      i = closeMatch ? closeMatch.index + closeMatch[0].length : len;
    }
  }

  return {ids, references};
}

function buildSchemaHostRegistry(repoRoot, shouldLoadSchemas) {
  /** @type {Map<string, {version: string, guideRoute: string | null}>} */
  const hostRoutes = new Map();
  /** @type {Map<string, Map<string, ReturnType<typeof loadVersionSchemas>[number]>>} */
  const schemasByVersion = new Map();

  for (const version of Object.keys(SPEC_SCHEMAS)) {
    hostRoutes.set(`specification/${version}/schemas/index.html`, {version, guideRoute: null});
  }
  for (const [version, entries] of Object.entries(SPEC_CATALOG_SCHEMAS)) {
    for (const entry of entries) {
      if (entry.guideRoute) {
        hostRoutes.set(`${entry.guideRoute}/index.html`, {
          version,
          guideRoute: entry.guideRoute,
        });
      }
    }
  }

  const canLoad =
    shouldLoadSchemas &&
    repoRoot &&
    fs.existsSync(path.join(repoRoot, 'specification')) &&
    fs.existsSync(path.join(repoRoot, 'catalogs'));

  if (canLoad) {
    for (const version of Object.keys(SPEC_SCHEMAS)) {
      const byAlias = new Map();
      for (const schema of loadVersionSchemas(version, repoRoot)) {
        byAlias.set(schema.alias, schema);
      }
      schemasByVersion.set(version, byAlias);
    }
  }

  return {hostRoutes, schemasByVersion};
}

function getServedPageUrlPath(distDir, absHtmlFile, basePrefix) {
  const relFromDist = path.relative(distDir, absHtmlFile).replace(/\\/g, '/');
  if (relFromDist === 'index.html') {
    return `${basePrefix}/`;
  }
  if (relFromDist.endsWith('/index.html')) {
    const dirPart = relFromDist.slice(0, -'/index.html'.length);
    return `${basePrefix}/${dirPart}/`;
  }
  return `${basePrefix}/${relFromDist}`;
}

function resolveDistFile(distDir, siteRelPath) {
  const decodedRel = safeDecodeURIComponent(siteRelPath);
  const cleanRel = decodedRel.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, cleanRel);

  if (candidate !== distDir && !candidate.startsWith(distDir + path.sep)) {
    return {exists: false, filePath: null, isHtml: false};
  }

  if (siteRelPath.endsWith('/')) {
    const asIndex = path.join(candidate, 'index.html');
    if (fs.existsSync(asIndex) && fs.statSync(asIndex).isFile()) {
      return {exists: true, filePath: asIndex, isHtml: true};
    }
    return {exists: false, filePath: null, isHtml: false};
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return {exists: true, filePath: candidate, isHtml: candidate.endsWith('.html')};
  }

  const asIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(asIndex) && fs.statSync(asIndex).isFile()) {
    return {exists: true, filePath: asIndex, isHtml: true};
  }

  return {exists: false, filePath: null, isHtml: false};
}

/**
 * Validates all built HTML files inside `distDir`.
 */
export function checkDistLinks({
  distDir,
  base = '',
  repoRoot = findRepoRoot(),
  displayRoot = distDir,
  loadSchemas = true,
} = {}) {
  const resolvedDist = path.resolve(distDir);
  const basePrefix = normalizeBasePrefix(base);
  /** @type {string[]} */
  const errors = [];

  if (!fs.existsSync(resolvedDist)) {
    return {
      ok: false,
      errors: [`dist/ directory not found at ${resolvedDist}.`],
      checkedFiles: 0,
      checkedLinks: 0,
      checkedAnchors: 0,
    };
  }

  const htmlFiles = walkHtmlFiles(resolvedDist);
  if (htmlFiles.length === 0) {
    return {
      ok: false,
      errors: [`No .html files found in ${resolvedDist}.`],
      checkedFiles: 0,
      checkedLinks: 0,
      checkedAnchors: 0,
    };
  }

  /** @type {Map<string, ReturnType<typeof parseHtmlDocument>>} */
  const parsedCache = new Map();
  function getParsedHtml(absPath) {
    let cached = parsedCache.get(absPath);
    if (!cached) {
      cached = parseHtmlDocument(fs.readFileSync(absPath, 'utf8'));
      parsedCache.set(absPath, cached);
    }
    return cached;
  }

  const {hostRoutes, schemasByVersion} = buildSchemaHostRegistry(repoRoot, loadSchemas);

  let checkedLinks = 0;
  let checkedAnchors = 0;

  function validateFragmentOnHtmlTarget(sourceLabel, rawUrl, rawFrag, targetHtmlPath) {
    if (!rawFrag) return;
    checkedAnchors++;

    const decodedFrag = safeDecodeURIComponent(rawFrag);
    const {ids: targetIds} = getParsedHtml(targetHtmlPath);
    const relTargetDist = path.relative(resolvedDist, targetHtmlPath).replace(/\\/g, '/');
    const relTargetDisplay = path.relative(displayRoot, targetHtmlPath).replace(/\\/g, '/');

    // HTML standard: #top (case-insensitive) scrolls to top of document even without id="top"
    if (decodedFrag.toLowerCase() === 'top' && !targetIds.has(decodedFrag)) {
      return;
    }

    // Schema Explorer & Catalog Guide JSON pointer fragments (#<alias>.json or #<alias>.json/<ptr>)
    const normalizedSchemaFrag = rawFrag.replace(/\.json#\/?/, '.json/');
    const schemaHost = hostRoutes.get(relTargetDist);
    if (schemaHost && /\.json(?:\/|$)/.test(normalizedSchemaFrag)) {
      const slashIdx = normalizedSchemaFrag.indexOf('/');
      const rawAlias =
        slashIdx === -1 ? normalizedSchemaFrag : normalizedSchemaFrag.slice(0, slashIdx);
      const alias = safeDecodeURIComponent(rawAlias);
      const rawPointer =
        slashIdx === -1 ? '' : normalizedSchemaFrag.slice(slashIdx + 1).replace(/^\/+/, '');
      const decodedPointer = safeDecodeURIComponent(rawPointer);

      if (!targetIds.has(alias)) {
        errors.push(
          `${sourceLabel}: Broken schema anchor "${rawUrl}" — #${alias} not found in ${relTargetDisplay}`,
        );
        return;
      }

      const versionMap = schemasByVersion.get(schemaHost.version);
      if (versionMap) {
        const schema = versionMap.get(alias);
        if (!schema) {
          errors.push(
            `${sourceLabel}: Unknown schema alias "${alias}" in "${rawUrl}" for ${schemaHost.version}`,
          );
          return;
        }
        const actualGuideRoute = schema.guideRoute || null;
        if (actualGuideRoute !== schemaHost.guideRoute) {
          errors.push(
            `${sourceLabel}: Schema "${alias}" in "${rawUrl}" is not hosted on ${relTargetDisplay}`,
          );
          return;
        }
        if (rawPointer && !schema.pointers[rawPointer] && !schema.pointers[decodedPointer]) {
          errors.push(
            `${sourceLabel}: Broken schema JSON pointer "${rawPointer}" in "${rawUrl}" on ${schemaHost.version} ${alias}`,
          );
        }
      }
      return;
    }

    if (!targetIds.has(decodedFrag) && !targetIds.has(rawFrag)) {
      errors.push(
        `${sourceLabel}: Broken anchor "${rawUrl}" — #${decodedFrag} not found in ${relTargetDisplay}`,
      );
    }
  }

  for (const htmlFile of htmlFiles) {
    const sourceLabel = path.relative(displayRoot, htmlFile).replace(/\\/g, '/');
    const sourceUrlPath = getServedPageUrlPath(resolvedDist, htmlFile, basePrefix);
    const {references} = getParsedHtml(htmlFile);

    for (const ref of references) {
      const rawUrl = ref.rawUrl.trim();
      if (!rawUrl) continue;

      // Skip any external / non-document RFC 3986 URI scheme (https:, mailto:, vscode:, etc.)
      // and protocol-relative URLs (//...)
      if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]+:|\/\/)/.test(rawUrl)) {
        continue;
      }

      // Intra-page hash reference (#...)
      if (rawUrl.startsWith('#')) {
        const rawFrag = rawUrl.slice(1);
        if (!rawFrag) continue;
        validateFragmentOnHtmlTarget(sourceLabel, rawUrl, rawFrag, htmlFile);
        continue;
      }

      const hashIdx = rawUrl.indexOf('#');
      const pathAndQuery = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);
      const rawFrag = hashIdx === -1 ? '' : rawUrl.slice(hashIdx + 1);

      let resolvedUrl;
      try {
        resolvedUrl = new URL(pathAndQuery, `https://a2ui.local${sourceUrlPath}`);
      } catch {
        errors.push(`${sourceLabel}: Malformed URL "${rawUrl}"`);
        continue;
      }

      // Defense-in-depth: skip single-letter schemes (e.g. `c:/`) or non-local origins
      if (resolvedUrl.origin !== 'https://a2ui.local') {
        continue;
      }

      checkedLinks++;
      const pathname = resolvedUrl.pathname;

      // Enforce ASTRO_BASE containment when ASTRO_BASE is configured
      if (basePrefix && pathname !== basePrefix && !pathname.startsWith(`${basePrefix}/`)) {
        errors.push(
          `${sourceLabel}: Link "${rawUrl}" resolves to "${pathname}" which escapes ASTRO_BASE "${basePrefix}/"`,
        );
        continue;
      }

      const siteRelPath = basePrefix ? pathname.slice(basePrefix.length) || '/' : pathname;
      const target = resolveDistFile(resolvedDist, siteRelPath);

      if (!target.exists || !target.filePath) {
        errors.push(
          `${sourceLabel}: Broken ${ref.kind} "${rawUrl}" — target "${siteRelPath}" does not exist in dist/`,
        );
        continue;
      }

      if (rawFrag && target.isHtml && (ref.kind === 'anchor' || ref.kind === 'redirect')) {
        validateFragmentOnHtmlTarget(sourceLabel, rawUrl, rawFrag, target.filePath);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checkedFiles: htmlFiles.length,
    checkedLinks,
    checkedAnchors,
  };
}

export function verifyDistCname(distDir, expectedDomain = 'a2ui.org') {
  const cnamePath = path.join(path.resolve(distDir), 'CNAME');
  if (!fs.existsSync(cnamePath)) {
    return {ok: false, error: `Missing CNAME in ${distDir}`};
  }
  const actual = fs.readFileSync(cnamePath, 'utf8').trim();
  if (actual !== expectedDomain) {
    return {ok: false, error: `Expected CNAME "${expectedDomain}", found "${actual}"`};
  }
  return {ok: true, error: null};
}

function runCli() {
  const args = process.argv.slice(2);
  let customDist = null;
  let customBase = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dist' && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      customDist = args[++i];
    } else if (args[i] === '--base' && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      customBase = args[++i];
    }
  }

  const distDir = customDist ? path.resolve(customDist) : path.join(defaultSiteRoot, 'dist');
  const base = customBase !== null ? customBase : process.env.ASTRO_BASE || '';

  const cnameResult = verifyDistCname(distDir);
  if (!cnameResult.ok) {
    console.error(`\n[check-links] ${cnameResult.error}`);
    process.exit(1);
  }

  const result = checkDistLinks({
    distDir,
    base,
    displayRoot: defaultSiteRoot,
  });

  if (!result.ok) {
    console.error(`\n[check-links] Found ${result.errors.length} link/anchor error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const relDist = path.relative(defaultSiteRoot, distDir) || '.';
  console.log(
    `[check-links] Verified ${result.checkedLinks} internal link(s) and ${result.checkedAnchors} #fragment anchor(s) across ${result.checkedFiles} HTML page(s) in ${relDist}. 0 errors.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}

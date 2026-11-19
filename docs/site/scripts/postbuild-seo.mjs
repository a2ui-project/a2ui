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
 * Post-build Search Console & SEO normalizer for `docs/site/dist`:
 * 1. On root builds (`!ASTRO_BASE`), copies `dist/sitemap-index.xml` to `dist/sitemap.xml`
 *    so legacy `/sitemap.xml` submissions continue resolving as valid `<sitemapindex>` XML.
 * 2. Normalizes `<link rel="canonical" href="...">` on `<meta http-equiv="refresh">`
 *    redirect HTML stubs: strips `#fragment` anchors on root builds (while preserving
 *    `#fragment` in `meta[http-equiv="refresh"]` and `<a href="...">`), and removes
 *    `<link rel="canonical">` from redirect stubs on subpath (`ASTRO_BASE`) builds.
 * 3. On root builds, emits clean 1-hop redirect stubs under `dist/preview/<slug>/index.html`
 *    so previously indexed `/preview/<slug>/` routes redirect cleanly to their canonical
 *    destinations instead of returning HTTP 404.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {DEFAULT_SITE_ORIGIN, stripHashFromUrl} from '../src/lib/seo.mjs';
import {normalizeBasePrefix} from '../src/lib/spec-schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDir = path.resolve(__dirname, '../dist');

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

export function isMetaRefreshHtml(html) {
  return /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh(?=[\s/>]|$))/i.test(html);
}

export function extractMetaRefreshTarget(html) {
  const metaMatch = html.match(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh(?=[\s/>]|$))[^>]*>/i,
  );
  if (!metaMatch) return null;
  const contentMatch = metaMatch[0].match(
    /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
  );
  const content = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '';
  const urlMatch = content.match(/^\s*\d+\s*;\s*url\s*=\s*(.+?)\s*$/i);
  return urlMatch ? urlMatch[1] : null;
}

/**
 * Sanitizes `<link rel="canonical" ...>` inside a `<meta http-equiv="refresh">`
 * redirect HTML document.
 *
 * @param {string} html
 * @param {{basePrefix?: string}} [options]
 * @returns {string}
 */
export function sanitizeRedirectStubHtml(html, {basePrefix = ''} = {}) {
  if (!isMetaRefreshHtml(html)) {
    return html;
  }
  const normalizedBase = normalizeBasePrefix(basePrefix);
  if (normalizedBase) {
    return html.replace(
      /<link\b[^>]*\brel\s*=\s*(?:"canonical"|'canonical'|canonical(?=[\s/>]|$))[^>]*>/gi,
      '',
    );
  }
  return html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/\brel\s*=\s*(?:"canonical"|'canonical'|canonical(?=[\s/>]|$))/i.test(tag)) {
      return tag;
    }
    return tag.replace(
      /(\bhref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
      (_full, prefix, doubleQuoted, singleQuoted, unquoted) => {
        const rawHref = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
        const stripped = stripHashFromUrl(rawHref);
        if (doubleQuoted !== undefined) return `${prefix}"${stripped}"`;
        if (singleQuoted !== undefined) return `${prefix}'${stripped}'`;
        return `${prefix}"${stripped}"`;
      },
    );
  });
}

/**
 * Builds a static 1-hop `<meta http-equiv="refresh">` redirect stub HTML document
 * with `noindex, nofollow` and a fragmentless `<link rel="canonical">`.
 *
 * @param {{fromPath: string, toUrl: string, siteOrigin?: string}} options
 * @returns {string}
 */
export function buildPreviewRedirectStubHtml({fromPath, toUrl, siteOrigin = DEFAULT_SITE_ORIGIN}) {
  const canonicalPath = stripHashFromUrl(toUrl) || '/';
  const canonicalHref = new URL(canonicalPath, siteOrigin).href;
  const escapedFrom = escapeHtmlAttr(fromPath);
  const escapedTo = escapeHtmlAttr(toUrl);
  const escapedCanonical = escapeHtmlAttr(canonicalHref);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Redirecting to: ${escapedTo}</title>`,
    `<meta http-equiv="refresh" content="0;url=${escapedTo}">`,
    '<meta name="robots" content="noindex, nofollow">',
    `<link rel="canonical" href="${escapedCanonical}">`,
    '</head>',
    `<body><a href="${escapedTo}">Redirecting from <code>${escapedFrom}</code> to <code>${escapedTo}</code></a></body>`,
    '</html>',
    '',
  ].join('');
}

/**
 * Runs post-build SEO tasks against `distDir`.
 *
 * @param {{distDir?: string, base?: string, siteOrigin?: string}} [options]
 */
export function runPostbuildSeo({
  distDir = defaultDistDir,
  base = process.env.ASTRO_BASE || '',
  siteOrigin = process.env.ASTRO_SITE || DEFAULT_SITE_ORIGIN,
} = {}) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`[postbuild-seo] Build directory does not exist: ${distDir}`);
  }

  const basePrefix = normalizeBasePrefix(base);
  const htmlFiles = walkHtmlFiles(distDir);
  let sanitizedRedirects = 0;

  for (const htmlFile of htmlFiles) {
    const original = fs.readFileSync(htmlFile, 'utf8');
    const sanitized = sanitizeRedirectStubHtml(original, {basePrefix});
    if (sanitized !== original) {
      fs.writeFileSync(htmlFile, sanitized, 'utf8');
      sanitizedRedirects++;
    }
  }

  if (basePrefix) {
    return {
      copiedSitemapAlias: false,
      sanitizedRedirects,
      previewRedirectsCreated: 0,
    };
  }

  // 1. Copy dist/sitemap-index.xml -> dist/sitemap.xml for legacy Search Console submissions.
  const sitemapIndexPath = path.join(distDir, 'sitemap-index.xml');
  const sitemapAliasPath = path.join(distDir, 'sitemap.xml');
  let copiedSitemapAlias = false;
  if (fs.existsSync(sitemapIndexPath)) {
    fs.copyFileSync(sitemapIndexPath, sitemapAliasPath);
    copiedSitemapAlias = true;
  }

  // 2. Emit 1-hop dist/preview/<slug>/index.html redirect stubs for former /preview/* routes.
  let previewRedirectsCreated = 0;
  for (const htmlFile of htmlFiles) {
    const relPath = path.relative(distDir, htmlFile).split(path.sep).join('/');
    if (
      relPath === 'index.html' ||
      relPath === '404.html' ||
      relPath === 'preview/index.html' ||
      relPath.startsWith('preview/')
    ) {
      continue;
    }
    if (!relPath.endsWith('/index.html')) {
      continue;
    }

    const slug = relPath.slice(0, -'/index.html'.length);
    const previewStubPath = path.join(distDir, 'preview', slug, 'index.html');
    if (fs.existsSync(previewStubPath)) {
      continue;
    }

    const html = fs.readFileSync(htmlFile, 'utf8');
    const existingRefreshTarget = extractMetaRefreshTarget(html);
    const finalTarget = existingRefreshTarget || `/${slug}/`;

    fs.mkdirSync(path.dirname(previewStubPath), {recursive: true});
    fs.writeFileSync(
      previewStubPath,
      buildPreviewRedirectStubHtml({
        fromPath: `/preview/${slug}/`,
        toUrl: finalTarget,
        siteOrigin,
      }),
      'utf8',
    );
    previewRedirectsCreated++;
  }

  return {
    copiedSitemapAlias,
    sanitizedRedirects,
    previewRedirectsCreated,
  };
}

const isCliEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCliEntry) {
  const summary = runPostbuildSeo();
  console.log(
    `[postbuild-seo] sitemapAlias=${summary.copiedSitemapAlias}, sanitizedRedirects=${summary.sanitizedRedirects}, previewRedirects=${summary.previewRedirectsCreated}`,
  );
}

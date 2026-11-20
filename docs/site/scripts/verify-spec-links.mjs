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

import {
  findRepoRoot,
  loadVersionSchemas,
  normalizeBasePrefix,
  SPEC_CATALOG_SCHEMAS,
  SPEC_DOC_ROUTES,
  SPEC_SCHEMAS,
} from '../src/lib/spec-schemas.mjs';
import {resolveAstUrl} from '../src/plugins/remark-a2ui-includes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = findRepoRoot(siteRoot);
const publicDir = path.join(siteRoot, 'public');
const distDir = path.join(siteRoot, 'dist');
const srcDir = path.join(siteRoot, 'src');
const checkDist = process.argv.includes('--check-dist');

const errors = [];

// 1. Load & index all canonical JSON schemas and verify staged raw JSON files in public/
/** @type {Record<string, Map<string, ReturnType<typeof loadVersionSchemas>[number]>>} */
const indexedByVersion = {};

for (const version of Object.keys(SPEC_SCHEMAS)) {
  const loaded = loadVersionSchemas(version, repoRoot);
  const byAlias = new Map();
  for (const schema of loaded) {
    byAlias.set(schema.alias, schema);
    const stagedPath = path.join(publicDir, schema.rawPublicPath.replace(/^\//, ''));
    if (!fs.existsSync(stagedPath)) {
      errors.push(
        `[${version}] Staged raw JSON missing in public/: ${schema.rawPublicPath} (expected at ${stagedPath})`,
      );
    }
  }
  indexedByVersion[version] = byAlias;
}

function validateSchemaPointer(version, fragment, contextLabel, expectedGuideRoute = null) {
  const versionMap = indexedByVersion[version];
  if (!versionMap) {
    errors.push(`${contextLabel}: Unknown schema explorer version "${version}"`);
    return;
  }
  if (!fragment) return;

  const normalized = fragment.replace(/\.json#\/?/, '.json/');
  const slashIdx = normalized.indexOf('/');
  const alias = decodeURIComponent(slashIdx === -1 ? normalized : normalized.slice(0, slashIdx));
  const pointer = slashIdx === -1 ? '' : normalized.slice(slashIdx + 1).replace(/^\/+/, '');

  const schema = versionMap.get(alias);
  if (!schema) {
    errors.push(
      `${contextLabel}: Unknown schema alias "${alias}" for ${version} (available: ${Array.from(versionMap.keys()).join(', ')})`,
    );
    return;
  }

  const actualRoute = schema.guideRoute || null;
  if (actualRoute !== expectedGuideRoute) {
    const expectedLoc = expectedGuideRoute
      ? `/${expectedGuideRoute}/`
      : `/specification/${version}/schemas/`;
    const actualLoc = actualRoute
      ? `/${actualRoute}/#${alias}`
      : `/specification/${version}/schemas/#${alias}`;
    errors.push(
      `${contextLabel}: Schema "${alias}" is not hosted on ${expectedLoc} (use ${actualLoc})`,
    );
    return;
  }

  if (pointer && !schema.pointers[pointer] && !schema.pointers[decodeURIComponent(pointer)]) {
    errors.push(`${contextLabel}: Broken JSON pointer "${pointer}" on ${version} ${alias}`);
  }
}

/** Validates `/specification/<ver>/schemas/#...` and `/<catalog-guide-route>/#<alias>...` links. */
function validateSchemaPermalink(rawHref, contextLabel) {
  const schemasMatch = /\/specification\/(v1\.0|v0\.9\.1)\/schemas\/(?:#([^\s"'<>)]+))?/.exec(
    rawHref,
  );
  if (schemasMatch) {
    const [, version, fragment] = schemasMatch;
    validateSchemaPointer(version, fragment, `${contextLabel} in "${rawHref}"`, null);
    return true;
  }
  const guideMatch =
    /\/specification\/((v1\.0|v0\.9\.1)-basic-catalog-implementation-guide)\/?#([^\s"'<>)]+\.json[^\s"'<>)]*)/.exec(
      rawHref,
    );
  if (guideMatch) {
    const [, slug, version, fragment] = guideMatch;
    validateSchemaPointer(
      version,
      fragment,
      `${contextLabel} in "${rawHref}"`,
      `specification/${slug}`,
    );
    return true;
  }
  const mcpGuideMatch = /\/guides\/mcp-catalog\/?#([^\s"'<>)]+\.json[^\s"'<>)]*)/.exec(rawHref);
  if (mcpGuideMatch) {
    validateSchemaPointer(
      'v1.0',
      mcpGuideMatch[1],
      `${contextLabel} in "${rawHref}"`,
      'guides/mcp-catalog',
    );
    return true;
  }
  return false;
}

function walkFiles(dir, extRegex, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, extRegex, out);
    else if (extRegex.test(entry.name)) out.push(full);
  }
  return out;
}

// 2. Verify all wrapper specification pages single-source via --8<-- and all source permalinks resolve
const specWrappers = walkFiles(
  path.join(srcDir, 'content/docs/specification'),
  /\.(?:md|mdx)$/,
).filter(f => !f.endsWith('-schemas.mdx'));
const seenIncludes = new Set();

for (const wrapperPath of specWrappers) {
  const raw = fs.readFileSync(wrapperPath, 'utf8');
  const includeMatches = Array.from(
    raw.matchAll(/^--8(?:<|&lt;)--\s+"([^":]+)(?::\d*(?::\d*)?)?"\s*$/gm),
  );
  if (includeMatches.length === 0) {
    errors.push(
      `${path.relative(repoRoot, wrapperPath)}: Specification wrapper must include canonical source via --8<--`,
    );
    continue;
  }
  for (const m of includeMatches) {
    const relInc = m[1];
    seenIncludes.add(relInc);
    const absInc = path.join(repoRoot, relInc);
    if (!fs.existsSync(absInc)) {
      errors.push(
        `${path.relative(repoRoot, wrapperPath)}: Included file does not exist: ${relInc}`,
      );
    }
  }
}

for (const requiredSpec of Object.keys(SPEC_DOC_ROUTES)) {
  if (!seenIncludes.has(requiredSpec)) {
    errors.push(`Canonical specification doc is not included by any wrapper page: ${requiredSpec}`);
  }
}

// 3. Scan all docs/site/src/**/*.{md,mdx,astro} for /specification/<ver>/schemas/#... permalinks
const sourceFiles = walkFiles(srcDir, /\.(?:md|mdx|astro)$/);
const schemaUrlRegex =
  /(?:\/specification\/(?:(?:v1\.0|v0\.9\.1)\/schemas\/(?:#[A-Za-z0-9_.$~/%-]+)?|(?:v1\.0|v0\.9\.1)-basic-catalog-implementation-guide\/?#[A-Za-z0-9_.$~/%-]+\.json[A-Za-z0-9_.$~/%-]*))|(?:\/guides\/mcp-catalog\/?#[A-Za-z0-9_.$~/%-]+\.json[A-Za-z0-9_.$~/%-]*)/g;

for (const file of sourceFiles) {
  const txt = fs.readFileSync(file, 'utf8');
  const rel = path.relative(repoRoot, file);
  for (const m of txt.matchAll(schemaUrlRegex)) {
    validateSchemaPermalink(m[0], rel);
  }
}

// 4. Verify rewritten links across all 11 included canonical specification Markdown files
for (const relSpec of Object.keys(SPEC_DOC_ROUTES)) {
  const absSpec = path.join(repoRoot, relSpec);
  const txt = fs.readFileSync(absSpec, 'utf8').replace(/```[\s\S]*?```|`[^`\n]+`/g, '');
  for (const m of txt.matchAll(
    /(?:\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)|^\s*\[[^\]]+\]:\s*(\S+))/gm,
  )) {
    const rawUrl = m[1] || m[2];
    const resolved = resolveAstUrl(rawUrl, absSpec);
    validateSchemaPermalink(resolved, `${relSpec} (${rawUrl})`);
  }
}

// 5. Optional post-build HTML verification across dist/
if (checkDist) {
  if (!fs.existsSync(distDir)) {
    errors.push(`--check-dist requested, but dist/ directory not found at ${distDir}`);
  } else {
    const basePrefix = normalizeBasePrefix(process.env.ASTRO_BASE);
    const allHtmlFiles = walkFiles(distDir, /\.html$/);
    const htmlIdCache = new Map();

    function getHtmlIds(absHtmlPath) {
      if (htmlIdCache.has(absHtmlPath)) return htmlIdCache.get(absHtmlPath);
      const html = fs.readFileSync(absHtmlPath, 'utf8');
      const ids = new Set();
      for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) {
        ids.add(m[1]);
      }
      htmlIdCache.set(absHtmlPath, ids);
      return ids;
    }

    function resolveDistTarget(pathname) {
      let rel = pathname;
      if (basePrefix && rel.startsWith(`${basePrefix}/`)) {
        rel = rel.slice(basePrefix.length);
      } else if (basePrefix && rel === basePrefix) {
        rel = '/';
      }
      const cleanRel = rel.replace(/^\/+/, '');
      const asFile = path.join(distDir, cleanRel);
      if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
        return {exists: true, htmlFile: asFile.endsWith('.html') ? asFile : null};
      }
      const asIndex = path.join(distDir, cleanRel, 'index.html');
      if (fs.existsSync(asIndex)) {
        return {exists: true, htmlFile: asIndex};
      }
      return {exists: false, htmlFile: null};
    }

    for (const htmlFile of allHtmlFiles) {
      const relHtml = path.relative(siteRoot, htmlFile);
      const html = fs.readFileSync(htmlFile, 'utf8');
      const isSpecHtml = relHtml.startsWith(`dist${path.sep}specification${path.sep}`);

      if (isSpecHtml) {
        // Strip <pre>...</pre> and <code>...</code> before checking for unexpanded --8<-- directives
        const proseOnly = html.replace(/<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/gi, '');
        if (/(?:--|\u2014|\u2013)8(?:<|&lt;|&#60;|&#x3c;)(?:--|\u2014|\u2013)/i.test(proseOnly)) {
          errors.push(`${relHtml}: Contains unexpanded --8<-- snippet directive`);
        }
        if (/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(proseOnly)) {
          errors.push(`${relHtml}: Contains unrendered GitHub blockquote alert marker`);
        }
      }

      const schemaPageMatch =
        /^dist[\\/]specification[\\/](v1\.0|v0\.9\.1)[\\/]schemas[\\/]index\.html$/.exec(relHtml);
      if (schemaPageMatch) {
        const pageVer = schemaPageMatch[1];
        const ids = getHtmlIds(htmlFile);
        for (const expectedSchema of SPEC_SCHEMAS[pageVer]) {
          if (!ids.has(expectedSchema.alias)) {
            errors.push(
              `${relHtml}: Missing heading/section anchor id="${expectedSchema.alias}" on ${pageVer} JSON Schemas page`,
            );
          }
          if (!html.includes(`data-schema-panel="${expectedSchema.alias}"`)) {
            errors.push(
              `${relHtml}: Missing concatenated schema panel for "${expectedSchema.alias}" on ${pageVer} JSON Schemas page`,
            );
          }
        }
      }

      const basicCatalogGuideMatch =
        /^dist[\\/]specification[\\/](v1\.0|v0\.9\.1)-basic-catalog-implementation-guide[\\/]index\.html$/.exec(
          relHtml,
        );
      if (basicCatalogGuideMatch) {
        const pageVer = basicCatalogGuideMatch[1];
        const ids = getHtmlIds(htmlFile);
        if (!ids.has('basic_catalog.json')) {
          errors.push(
            `${relHtml}: Missing heading/section anchor id="basic_catalog.json" on ${pageVer} Basic Catalog Guide`,
          );
        }
        if (!html.includes('data-schema-panel="basic_catalog.json"')) {
          errors.push(
            `${relHtml}: Missing schema panel for "basic_catalog.json" on ${pageVer} Basic Catalog Guide`,
          );
        }
      }

      const mcpCatalogGuideMatch = /^dist[\\/]guides[\\/]mcp-catalog[\\/]index\.html$/.exec(
        relHtml,
      );
      if (mcpCatalogGuideMatch) {
        const ids = getHtmlIds(htmlFile);
        if (!ids.has('mcp_catalog.json')) {
          errors.push(
            `${relHtml}: Missing heading/section anchor id="mcp_catalog.json" on MCP Catalog Guide`,
          );
        }
        if (!html.includes('data-schema-panel="mcp_catalog.json"')) {
          errors.push(
            `${relHtml}: Missing schema panel for "mcp_catalog.json" on MCP Catalog Guide`,
          );
        }
      }

      for (const m of html.matchAll(/\bhref=["']([^"']+)["']/g)) {
        const href = m[1];
        validateSchemaPermalink(href, relHtml);

        if (!isSpecHtml) continue;
        if (/^(?:https?:|mailto:|tel:|javascript:)/.test(href)) continue;

        if (href.startsWith('#')) {
          const frag = decodeURIComponent(href.slice(1));
          if (!frag || frag === '_top') continue;
          if (frag.includes('.json')) {
            const pageVer = schemaPageMatch
              ? schemaPageMatch[1]
              : basicCatalogGuideMatch
                ? basicCatalogGuideMatch[1]
                : mcpCatalogGuideMatch
                  ? 'v1.0'
                  : null;
            const expectedRoute = basicCatalogGuideMatch
              ? `specification/${basicCatalogGuideMatch[1]}-basic-catalog-implementation-guide`
              : mcpCatalogGuideMatch
                ? 'guides/mcp-catalog'
                : null;
            if (pageVer) {
              validateSchemaPointer(pageVer, frag, relHtml, expectedRoute);
              continue;
            }
          }
          const ids = getHtmlIds(htmlFile);
          if (!ids.has(frag)) {
            errors.push(`${relHtml}: Broken intra-page anchor "${href}"`);
          }
          continue;
        }

        if (href.startsWith('/')) {
          const [pathname, rawFrag] = href.split('#');
          const resolved = resolveDistTarget(pathname);
          if (!resolved.exists) {
            errors.push(`${relHtml}: Broken internal link "${href}" (target missing in dist/)`);
            continue;
          }
          if (rawFrag && resolved.htmlFile && !pathname.endsWith('/schemas/')) {
            const guideMatch =
              /\/specification\/(v1\.0|v0\.9\.1)-basic-catalog-implementation-guide/.exec(pathname);
            const mcpMatch = /\/guides\/mcp-catalog/.exec(pathname);
            if ((guideMatch || mcpMatch) && rawFrag.includes('.json')) {
              continue;
            }
            const targetIds = getHtmlIds(resolved.htmlFile);
            const frag = decodeURIComponent(rawFrag);
            if (frag && frag !== '_top' && !targetIds.has(frag)) {
              errors.push(
                `${relHtml}: Broken cross-page anchor "${href}" (#${frag} missing in ${path.relative(siteRoot, resolved.htmlFile)})`,
              );
            }
          }
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(
    `\n[verify-spec-links] Found ${errors.length} specification verification error(s):`,
  );
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `[verify-spec-links] Verified ${Object.keys(SPEC_DOC_ROUTES).length} specification docs and ${Object.values(SPEC_SCHEMAS).flat().length + Object.values(SPEC_CATALOG_SCHEMAS).flat().length} JSON schemas (${checkDist ? 'source + dist/' : 'source'}).`,
);

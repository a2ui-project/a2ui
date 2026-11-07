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

import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
import {visit} from 'unist-util-visit';

import {findRepoRoot, resolveSchemaExplorerUrl, SPEC_DOC_ROUTES} from '../lib/spec-schemas.mjs';

const repoRoot = findRepoRoot();
const contentDocsRoot = path.join(repoRoot, 'docs/site/src/content/docs');

const ALERT_TYPES = {
  NOTE: {label: 'Note', cls: 'note'},
  TIP: {label: 'Tip', cls: 'tip'},
  IMPORTANT: {label: 'Important', cls: 'important'},
  WARNING: {label: 'Warning', cls: 'caution'},
  CAUTION: {label: 'Caution', cls: 'danger'},
};

/**
 * Legacy MkDocs `docs/public/...` routes mapped to their Starlight equivalents.
 */
function resolveLegacyPublicDocRoute(cleanPublicSubpath, basePrefix) {
  const withoutExt = cleanPublicSubpath.replace(/\.md$/, '').replace(/\/index$/, '');
  const renamedRoutes = {
    'concepts/actions': 'concepts/actions-and-functions',
    'concepts/components': 'concepts/catalogs',
    'concepts/data-flow': 'concepts/data-binding',
    'concepts/transports': fs.existsSync(
      path.join(contentDocsRoot, 'guides/architecting-an-integration.mdx'),
    )
      ? 'guides/architecting-an-integration'
      : 'concepts/messages',
    'guides/a2ui_over_mcp': 'guides/a2ui-over-mcp',
    'guides/defining-your-own-catalog': 'guides/defining-a-catalog',
    'guides/client-setup': 'guides/client-integration',
    'guides/agent-development': 'guides/agent-integration',
  };
  const targetSlug = renamedRoutes[withoutExt] || withoutExt;
  return `${basePrefix}/${targetSlug}/`;
}

/**
 * Reads explicit `slug:` from frontmatter when linking to a sibling `src/content/docs/` file.
 */
function resolveContentDocSlug(absDocPath) {
  const relToDocs = path.relative(contentDocsRoot, absDocPath).replace(/\\/g, '/');
  if (fs.existsSync(absDocPath)) {
    const raw = fs.readFileSync(absDocPath, 'utf8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (fmMatch) {
      const slugMatch = /^slug:\s*['"]?([^\r\n'"]+)['"]?\s*$/m.exec(fmMatch[1]);
      if (slugMatch) {
        return slugMatch[1].trim().replace(/^\/+|\/+$/g, '');
      }
    }
  }
  return relToDocs.replace(/\.(?:md|mdx)$/, '').replace(/\/index$/, '');
}

/**
 * Normalizes known legacy anchor mismatches in included specifications without mutating spec files.
 */
function normalizeSpecAnchor(targetSlug, rawAnchor) {
  if (!rawAnchor) return '';
  return `#${rawAnchor}`;
}

/**
 * Cleans up included specification Markdown header boilerplate before AST parsing.
 */
function cleanIncludedSpecMarkdown(markdown) {
  let out = markdown;

  // 1. Strip markdownlint HTML comments at top of file
  out = out.replace(/^(?:<!--\s*markdownlint-[^>]*-->\s*\r?\n)+/, '');

  // 2. Strip duplicate centered logo + H1 header block in protocol spec docs
  out = out.replace(
    /<div style="text-align:\s*center;">\s*<div class="centered-logo-text-group">[\s\S]*?<\/div>\s*<\/div>\s*/g,
    '',
  );

  // 3. Deduplicate repeated subtitle + format consecutive metadata lines cleanly
  out = out.replace(
    /A Specification for a JSON-Based, Streaming UI Protocol\.\s*\r?\n\s*\r?\n(\*\*Version:\*\*[^\r\n]+\r?\n\*\*Status:\*\*[^\r\n]+\r?\n\*\*Created:\*\*[^\r\n]+\r?\n\*\*Last Updated:\*\*[^\r\n]+)\s*\r?\n\s*\r?\nA Specification for a JSON-Based, Streaming UI Protocol\s*\r?\n/,
    (_, metaBlock) => {
      const items = metaBlock
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim());
      return `A Specification for a JSON-Based, Streaming UI Protocol.\n\n${items.join(' · ')}\n\n`;
    },
  );

  out = out.replace(
    /(A Specification for a JSONL-Based, Streaming UI Protocol)\s*\r?\n\s*\r?\n(Created:\s*[^\r\n]+)\r?\n(Updated:\s*[^\r\n]+)\s*\r?\n/,
    '$1\n\n**$2** · **$3**\n\n',
  );

  return out;
}

/**
 * Resolves a Markdown link or image URL relative to `originFilePath` (either the wrapper `.md`
 * file or the included `specification/...` / `catalogs/...` file on disk).
 */
export function resolveAstUrl(rawTarget, originFilePath, options = {}) {
  if (!rawTarget || /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/|#)/i.test(rawTarget)) {
    return rawTarget;
  }

  const githubBaseUrl = 'https://github.com/a2ui-project/a2ui/blob/main';
  const rawBaseOption = options.base ?? process.env.ASTRO_BASE ?? '';
  const basePrefix = String(rawBaseOption).replace(/\/+$/, '');

  const hashIdx = rawTarget.indexOf('#');
  const rawBase = hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx);
  const rawAnchor = hashIdx === -1 ? '' : rawTarget.slice(hashIdx + 1);
  const anchor = rawAnchor ? `#${rawAnchor}` : '';

  if (!rawBase) {
    return rawTarget;
  }

  // Handle already root-relative site paths by prepending ASTRO_BASE when configured
  if (rawBase.startsWith('/')) {
    if (basePrefix && rawBase !== basePrefix && !rawBase.startsWith(`${basePrefix}/`)) {
      return `${basePrefix}${rawBase}${anchor}`;
    }
    return rawTarget;
  }

  const originDir = originFilePath ? path.dirname(originFilePath) : process.cwd();
  const resolvedAbs = path.resolve(originDir, rawBase);
  const relToRepo = path.relative(repoRoot, resolvedAbs).replace(/\\/g, '/');
  const originRelToRepo = originFilePath
    ? path.relative(repoRoot, originFilePath).replace(/\\/g, '/')
    : '';
  const originIsContentDoc = originRelToRepo.startsWith('docs/site/src/content/docs/');

  if (originIsContentDoc) {
    // 1a. Explicit file links inside `src/content/docs/` (e.g. `./v1.0-schemas.mdx`)
    if (
      relToRepo.startsWith('docs/site/src/content/docs/') &&
      fs.existsSync(resolvedAbs) &&
      fs.statSync(resolvedAbs).isFile()
    ) {
      const slug = resolveContentDocSlug(resolvedAbs);
      return slug ? `${basePrefix}/${slug}/${anchor}` : `${basePrefix}/${anchor}`;
    }

    // 1b. Relative asset imports inside `docs/site/src/` (e.g. `../../assets/*.svg`)
    if (
      relToRepo.startsWith('docs/site/src/') &&
      !relToRepo.startsWith('docs/site/src/content/docs/') &&
      fs.existsSync(resolvedAbs)
    ) {
      return rawTarget;
    }

    // 1c. URL-relative site links authored relative to the page's rendered Starlight route
    // (e.g. `../overview/` from `concepts/glossary.mdx`, served at `/concepts/glossary/`).
    const targetsRepoSourceOutsideSite =
      !relToRepo.startsWith('docs/site/') &&
      !relToRepo.startsWith('..') &&
      (Boolean(SPEC_DOC_ROUTES[relToRepo]) ||
        relToRepo.endsWith('.json') ||
        fs.existsSync(resolvedAbs));

    if (!targetsRepoSourceOutsideSite) {
      const originSlug = resolveContentDocSlug(originFilePath);
      const pageUrlBase = originSlug ? `https://a2ui.org/${originSlug}/` : 'https://a2ui.org/';
      const resolvedPathname = new URL(rawBase, pageUrlBase).pathname;
      return `${basePrefix}${resolvedPathname}${anchor}`;
    }
  }

  if (relToRepo.startsWith('..')) {
    return rawTarget;
  }

  // 1. Canonical included specification / catalog Markdown files
  if (SPEC_DOC_ROUTES[relToRepo]) {
    const slug = SPEC_DOC_ROUTES[relToRepo];
    return `${basePrefix}/${slug}/${normalizeSpecAnchor(slug, rawAnchor)}`;
  }

  // 2. Canonical JSON Schemas -> human-browsable JSON Schemas page permalinks
  if (relToRepo.endsWith('.json')) {
    const explorerUrl = resolveSchemaExplorerUrl(relToRepo, rawAnchor, basePrefix);
    if (explorerUrl) {
      return explorerUrl;
    }
  }

  // 3. Links to Starlight content docs (`docs/site/src/content/docs/...`)
  if (relToRepo.startsWith('docs/site/src/content/docs/')) {
    const slug = resolveContentDocSlug(resolvedAbs);
    return slug ? `${basePrefix}/${slug}/${anchor}` : `${basePrefix}/${anchor}`;
  }

  // Preserve relative imports/images inside docs/site/src/ (e.g. ../../assets/*.svg) for Astro's remarkCollectImages
  if (
    relToRepo.startsWith('docs/site/src/') &&
    !relToRepo.startsWith('docs/site/src/content/docs/')
  ) {
    return rawTarget;
  }

  // 4. Links to legacy `docs/public/...` pages or assets
  if (relToRepo.startsWith('docs/public/assets/')) {
    const assetRel = relToRepo.slice('docs/public/assets/'.length);
    return `${basePrefix}/assets/${assetRel}${anchor}`;
  }
  if (relToRepo.startsWith('docs/public/')) {
    const publicRel = relToRepo.slice('docs/public/'.length);
    return `${resolveLegacyPublicDocRoute(publicRel, basePrefix)}${anchor}`;
  }

  // 5. Fallback for any other repository source file (e.g. Python SDKs, v0.9 archived docs, tests)
  return `${githubBaseUrl}/${relToRepo}${anchor}`;
}

/**
 * Traverses the Markdown AST to rewrite URLs on `link`, `image`, and `definition` nodes and
 * convert GitHub-flavored alert blockquotes (`> [!NOTE]`, etc.) into styled callout containers
 * without touching inline code or fenced code blocks.
 */
function transformMarkdownAst(tree, originFilePath) {
  const basePrefix = (process.env.ASTRO_BASE || '').replace(/\/$/, '');

  visit(tree, node => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      if (node.url) {
        node.url = resolveAstUrl(node.url, originFilePath);
      }
      return;
    }

    if (node.type === 'html' && typeof node.value === 'string') {
      node.value = node.value.replace(
        /src=["'](?:\.\.\/)+docs\/public\/assets\/([^"']+)["']/g,
        `src="${basePrefix}/assets/$1"`,
      );
      return;
    }

    if (node.type === 'blockquote') {
      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== 'paragraph') return;
      const firstInline = firstChild.children?.[0];
      if (!firstInline || firstInline.type !== 'text') return;

      const alertMatch =
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\r\n]*)(?:\r?\n([\s\S]*))?$/.exec(
          firstInline.value,
        );
      if (!alertMatch) return;

      const [, type, customTitle, remainingText] = alertMatch;
      const meta = ALERT_TYPES[type] || ALERT_TYPES.NOTE;
      const title = customTitle.trim() || meta.label;

      if (remainingText) {
        firstInline.value = remainingText;
      } else {
        firstChild.children.shift();
        if (firstChild.children.length === 0) {
          node.children.shift();
        }
      }

      node.data = {
        ...node.data,
        hName: 'div',
        hProperties: {
          className: ['a2-callout', `a2-callout--${meta.cls}`],
        },
      };
      node.children.unshift({
        type: 'paragraph',
        data: {
          hName: 'div',
          hProperties: {
            className: ['a2-callout__title'],
          },
        },
        children: [{type: 'text', value: title}],
      });
    }
  });
}

function extractNodeText(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(extractNodeText).join('');
  }
  return '';
}

function getRawParagraphText(node, rawValue) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number' && rawValue) {
    return rawValue.slice(start, end);
  }
  return extractNodeText(node);
}

function normalizeDirectiveLine(line) {
  return line
    .trim()
    .replace(/[\u2014\u2013]/g, '--')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/&lt;|&#60;|&#x3c;/gi, '<');
}

function parseMarkdownBlock(markdownText, originFilePath) {
  const blockTree = fromMarkdown(markdownText, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  transformMarkdownAst(blockTree, originFilePath);
  return blockTree.children;
}

/**
 * Remark plugin that expands `--8<-- "path[:start:end]"` snippets directly from the repository root
 * with zero file duplication, rewrites relative links per origin file via AST traversal, and styles
 * GitHub blockquote alerts.
 */
export function remarkA2uiIncludes() {
  return function transformer(tree, file) {
    const filePath = file.history?.[0] || '';
    const rawValue = typeof file.value === 'string' ? file.value : String(file.value || '');

    // 1. Transform the outer page AST first (rewrites wrapper links and formats GitHub alerts)
    transformMarkdownAst(tree, filePath);

    const hasSnippet = rawValue.includes('--8<--') || rawValue.includes('--8&lt;--');

    // 2. Expand snippet includes (each included block is transformed against its own absPath)
    if (hasSnippet && Array.isArray(tree.children)) {
      const newChildren = [];
      for (const node of tree.children) {
        if (node.type === 'paragraph') {
          const rawText = getRawParagraphText(node, rawValue);
          const lines = rawText.split(/\r?\n/).map(normalizeDirectiveLine).filter(Boolean);
          const isAllDirectives =
            lines.length > 0 && lines.every(l => /^--8<--\s+"([^"]+)"$/.test(l));

          if (isAllDirectives) {
            for (const line of lines) {
              const match = /^--8<--\s+"([^"]+)"$/.exec(line);
              if (!match) continue;

              const parts = match[1].split(':');
              const relFile = parts[0];
              const startLine = parts[1] ? parseInt(parts[1], 10) : null;
              const endLine = parts[2] ? parseInt(parts[2], 10) : null;

              const absPath = path.resolve(repoRoot, relFile);
              if (!absPath.startsWith(repoRoot + path.sep)) {
                newChildren.push(
                  ...parseMarkdownBlock(
                    `> **Warning:** Included file path escapes repository root: \`${relFile}\``,
                    filePath,
                  ),
                );
                continue;
              }
              if (!fs.existsSync(absPath)) {
                newChildren.push(
                  ...parseMarkdownBlock(
                    `> **Warning:** Included file not found: \`${relFile}\``,
                    filePath,
                  ),
                );
                continue;
              }

              let includedContent = fs.readFileSync(absPath, 'utf8');
              if (startLine !== null || endLine !== null) {
                const lines = includedContent.split(/\r?\n/);
                const s = startLine ? Math.max(0, startLine - 1) : 0;
                const e = endLine ? endLine : lines.length;
                includedContent = lines.slice(s, e).join('\n');
              }

              includedContent = cleanIncludedSpecMarkdown(includedContent);

              // Strip leading H1 from full-file includes so Starlight doesn't render duplicate H1s
              if (startLine === null) {
                includedContent = includedContent.replace(/^\s*#\s+[^\r\n]+\r?\n+/, '');
              }

              newChildren.push(...parseMarkdownBlock(includedContent, absPath));
            }
            continue;
          }
        }
        newChildren.push(node);
      }
      tree.children = newChildren;
    }
  };
}

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

function findRepoRoot() {
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, 'specification'))) {
      return curr;
    }
    curr = path.resolve(curr, '..');
  }
  return path.resolve(process.cwd(), '../..');
}

const repoRoot = findRepoRoot();

function mapSpecFilename(filename, versionPrefix, basePrefix) {
  if (versionPrefix === 'v0.8' && filename === 'a2ui_extension_specification.md') {
    return `${basePrefix}/specification/v0.8-a2a-extension/`;
  }
  const mapping = {
    'a2ui_protocol.md': `${basePrefix}/specification/${versionPrefix}-a2ui/`,
    'evolution_guide.md': `${basePrefix}/specification/${versionPrefix}-evolution-guide/`,
    'a2ui_extension_specification.md': `${basePrefix}/specification/${versionPrefix}-a2ui-extension-specification/`,
    'basic_catalog_implementation_guide.md': `${basePrefix}/specification/${versionPrefix}-basic-catalog-implementation-guide/`,
  };
  return mapping[filename] || null;
}

/**
 * Rewrites relative specification links and HTML asset paths to match published website paths,
 * mirroring the logic in hooks.py.
 */
function rewriteSpecLinks(markdown, sourcePagePath) {
  const githubBaseUrl = 'https://github.com/a2ui-project/a2ui/blob/main';
  const basePrefix = (process.env.ASTRO_BASE || '').replace(/\/$/, '');
  let versionPrefix = null;
  if (sourcePagePath.includes('v0.8')) versionPrefix = 'v0.8';
  else if (sourcePagePath.includes('v0.9.1')) versionPrefix = 'v0.9.1';
  else if (sourcePagePath.includes('v0.9')) versionPrefix = 'v0.9';
  else if (sourcePagePath.includes('v1.0')) versionPrefix = 'v1.0';

  let out = markdown;

  // 1. Strip the duplicate centered logo + H1 header block in spec docs since Starlight renders the page H1
  out = out.replace(
    /<div style="text-align:\s*center;">\s*<div class="centered-logo-text-group">[\s\S]*?<\/div>\s*<\/div>\s*/g,
    '',
  );

  // 2. Rewrite any remaining HTML <img src="../../../docs/public/assets/..."> to "/assets/..."
  out = out.replace(
    /src=["'](?:\.\.\/)+docs\/public\/assets\/([^"']+)["']/g,
    `src="${basePrefix}/assets/$1"`,
  );

  return out;
}

/**
 * Rewrites link and image AST node URLs to match published routes.
 */
function resolveAstUrl(rawTarget, sourcePagePath) {
  if (!rawTarget || /^(?:https?:|mailto:|tel:|#)/.test(rawTarget)) {
    return rawTarget;
  }
  const githubBaseUrl = 'https://github.com/a2ui-project/a2ui/blob/main';
  const basePrefix = (process.env.ASTRO_BASE || '').replace(/\/$/, '');
  let versionPrefix = null;
  if (sourcePagePath.includes('v0.8')) versionPrefix = 'v0.8';
  else if (sourcePagePath.includes('v0.9.1')) versionPrefix = 'v0.9.1';
  else if (sourcePagePath.includes('v0.9')) versionPrefix = 'v0.9';
  else if (sourcePagePath.includes('v1.0')) versionPrefix = 'v1.0';

  const versionFolder = versionPrefix ? versionPrefix.replace(/\./g, '_') : null;
  const [rawBase, rawAnchor] = rawTarget.split('#');
  const anchor = rawAnchor ? `#${rawAnchor}` : '';
  const basePath = rawBase.replace(/^\.\//, '');

  if (versionPrefix) {
    const baseFilename = path.posix.basename(basePath);
    const mapped = mapSpecFilename(baseFilename, versionPrefix, basePrefix);
    if (mapped) {
      return `${mapped}${anchor}`;
    }
    if (basePath.includes('/json/')) {
      const afterJson = basePath.slice(basePath.indexOf('/json/'));
      return `${basePrefix}/specification/${versionFolder}${afterJson}${anchor}`;
    }
  }

  // Check if link traverses up to repo root (e.g. ../../../docs/public/... or ../../../samples/...)
  if (basePath.startsWith('../../')) {
    const cleanPath = basePath.replace(/^(?:\.\.\/)+/, '');
    if (cleanPath.startsWith('docs/public/')) {
      let internalRoute = `${basePrefix}/` + cleanPath.slice('docs/public/'.length);
      internalRoute = internalRoute.replace(/\.md$/, '/');
      return `${internalRoute}${anchor}`;
    }
    return `${githubBaseUrl}/${cleanPath}${anchor}`;
  }

  return rawTarget;
}

function walkAstAndRewriteLinks(node, sourcePagePath) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
    if (node.url) {
      node.url = resolveAstUrl(node.url, sourcePagePath);
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkAstAndRewriteLinks(child, sourcePagePath);
    }
  }
}

/**
 * Preprocesses raw Markdown text to:
 * 1. Expand --8<-- "path[:start:end]" snippets from the repository root
 * 2. Convert GitHub-style blockquote alerts (> [!NOTE]) into styled HTML callouts
 */
function preprocessMarkdown(rawMarkdown, filePath) {
  const snippetRegex = /^--8<--\s+"([^"]+)"\s*$/gm;
  let expanded = rawMarkdown.replace(snippetRegex, (_, spec) => {
    const parts = spec.split(':');
    const relFile = parts[0];
    const startLine = parts[1] ? parseInt(parts[1], 10) : null;
    const endLine = parts[2] ? parseInt(parts[2], 10) : null;

    const absPath = path.resolve(repoRoot, relFile);
    if (!absPath.startsWith(repoRoot + path.sep)) {
      return `> **Warning:** Included file path escapes repository root: \`${relFile}\``;
    }
    if (!fs.existsSync(absPath)) {
      return `> **Warning:** Included file not found: \`${relFile}\``;
    }

    let content = fs.readFileSync(absPath, 'utf8');
    if (startLine !== null || endLine !== null) {
      const lines = content.split(/\r?\n/);
      const s = startLine ? Math.max(0, startLine - 1) : 0;
      const e = endLine ? endLine : lines.length;
      content = lines.slice(s, e).join('\n');
    }

    // Strip leading H1 from full-file includes so Starlight doesn't render duplicate H1s
    if (startLine === null) {
      content = content.replace(/^#\s+[^\n]+\n+/, '');
    }

    return rewriteSpecLinks(content, filePath);
  });

  // 2. Convert GitHub-flavored alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
  const alertTypes = {
    NOTE: {label: 'Note', cls: 'note'},
    TIP: {label: 'Tip', cls: 'tip'},
    IMPORTANT: {label: 'Important', cls: 'important'},
    WARNING: {label: 'Warning', cls: 'caution'},
    CAUTION: {label: 'Caution', cls: 'danger'},
  };

  expanded = expanded.replace(
    /(```[\s\S]*?```)|(?:^>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\r\n]*)\r?\n)((?:^>[^\r\n]*(?:\r?\n|$))*)/gm,
    (match, codeFence, type, customTitle, bodyLines) => {
      if (codeFence) return match;
      const meta = alertTypes[type] || alertTypes.NOTE;
      const title = customTitle.trim() || meta.label;
      const cleanBody = bodyLines
        .split(/\r?\n/)
        .map(line => line.replace(/^>[ \t]?/, ''))
        .join('\n')
        .trim();
      return `\n<div class="a2-callout a2-callout--${meta.cls}">\n<div class="a2-callout__title">${title}</div>\n\n${cleanBody}\n\n</div>\n`;
    },
  );

  return expanded;
}

/**
 * Remark plugin that expands --8<-- snippets and GitHub alerts into the AST.
 */
export function remarkA2uiIncludes() {
  return function transformer(tree, file) {
    const filePath = file.history?.[0] || '';
    const rawValue = typeof file.value === 'string' ? file.value : String(file.value || '');

    const hasSnippet = rawValue.includes('--8<--');
    const hasAlert = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(rawValue);

    if (!hasSnippet && !hasAlert) {
      return;
    }

    const bodyWithoutFrontmatter = rawValue.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const processedMarkdown = preprocessMarkdown(bodyWithoutFrontmatter, filePath);

    const newTree = fromMarkdown(processedMarkdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    walkAstAndRewriteLinks(newTree, filePath);
    tree.children = newTree.children;
  };
}

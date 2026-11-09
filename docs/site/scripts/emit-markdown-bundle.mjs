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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '../..');
const docsRoot = path.join(siteRoot, 'src/content/docs');
const publicDir = path.join(siteRoot, 'public');
const distDir = path.join(siteRoot, 'dist');

const NO_BLANK_LINE = String.raw`(?:[^\n]|\n(?![ \t]*(?:\n|$)))`;
const MULTILINE_IMPORT_RE = new RegExp(
  String.raw`^[ \t]*import\s+${NO_BLANK_LINE}+?\s+from\s+['"][^'"]+['"];?[ \t]*$`,
  'gm',
);
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm;
const MULTILINE_EXPORT_RE = new RegExp(
  String.raw`^[ \t]*export\s+(?:const|let|var)\s+\w+\s*=(?:${NO_BLANK_LINE}*?;|[^\n]+)[ \t]*$`,
  'gm',
);

function walkDocs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDocs(abs, out);
    } else if (/\.(?:md|mdx)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return {meta: {}, body: raw};
  }
  const fm = match[1];
  const body = raw.slice(match[0].length);
  const readField = key => {
    const m = new RegExp(`^${key}:\\s*['"]?([^\\r\\n'"]+)['"]?\\s*$`, 'm').exec(fm);
    return m ? m[1].trim() : '';
  };
  return {
    meta: {
      title: readField('title'),
      description: readField('description'),
      slug: readField('slug'),
    },
    body,
  };
}

function expandIncludes(markdown) {
  return markdown.replace(/^[ \t]*--8<--\s+"([^"]+)"[ \t]*$/gm, (_full, spec) => {
    const parts = spec.split(':');
    const relFile = parts[0];
    const startLine = parts[1] ? parseInt(parts[1], 10) : null;
    const endLine = parts[2] ? parseInt(parts[2], 10) : null;
    const absPath = path.resolve(repoRoot, relFile);
    if (!absPath.startsWith(repoRoot + path.sep) || !fs.existsSync(absPath)) {
      return '';
    }
    let content = fs.readFileSync(absPath, 'utf8');
    if (startLine !== null || endLine !== null) {
      const lines = content.split(/\r?\n/);
      const s = startLine ? Math.max(0, startLine - 1) : 0;
      const e = endLine ? endLine : lines.length;
      content = lines.slice(s, e).join('\n');
    }
    content = content
      .replace(/^(?:<!--\s*markdownlint-[^>]*-->\s*\r?\n)+/, '')
      .replace(
        /<div style="text-align:\s*center;">\s*<div class="centered-logo-text-group">[\s\S]*?<\/div>\s*<\/div>\s*/g,
        '',
      );
    if (startLine === null) {
      content = content.replace(/^\s*#\s+[^\r\n]+\r?\n+/, '');
    }
    return content.trim();
  });
}

function splitByCodeFences(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  let current = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        if (current.length > 0) {
          segments.push({inFence: false, text: current.join('\n')});
          current = [];
        }
        inFence = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
        current.push(line);
        continue;
      }
      if (
        marker[0] === fenceChar &&
        marker.length >= fenceLen &&
        /^(\s*)(`{3,}|~{3,})\s*$/.test(line)
      ) {
        current.push(line);
        segments.push({inFence: true, text: current.join('\n')});
        current = [];
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        continue;
      }
    }
    current.push(line);
  }

  if (current.length > 0) {
    segments.push({inFence, text: current.join('\n')});
  }
  return segments;
}

export function cleanMdxOutsideFences(markdown) {
  const out = [];

  for (const segment of splitByCodeFences(markdown)) {
    if (segment.inFence) {
      out.push(segment.text);
      continue;
    }

    // Strip single-line and multi-line ESM imports/exports outside fenced code blocks
    const stripped = segment.text
      .replace(MULTILINE_IMPORT_RE, '')
      .replace(SIDE_EFFECT_IMPORT_RE, '')
      .replace(MULTILINE_EXPORT_RE, '');

    const segmentOut = [];
    for (const line of stripped.split('\n')) {
      // Replace <SchemaExplorer version="..." alias="..." /> with raw schema URL
      const schemaMatch =
        /^\s*<SchemaExplorer\s+version=["']([^"']+)["']\s+alias=["']([^"']+)["']\s*\/>\s*$/.exec(
          line,
        );
      if (schemaMatch) {
        const verDir = schemaMatch[1].replace(/^v?/, 'v').replace(/\./g, '_');
        segmentOut.push(
          `- Raw JSON Schema: [${schemaMatch[2]}](https://a2ui.org/specification/${verDir}/json/${schemaMatch[2]})`,
        );
        continue;
      }

      // Convert Starlight <Tabs> / <TabItem> / <Aside> wrappers to readable Markdown
      if (/^\s*<\/?(?:Tabs|CardGrid|Steps)\b[^>]*>\s*$/.test(line)) {
        continue;
      }
      const tabMatch = /^\s*<TabItem\b[^>]*label=["']([^"']+)["'][^>]*>\s*$/.exec(line);
      if (tabMatch) {
        segmentOut.push(`\n#### ${tabMatch[1]}\n`);
        continue;
      }
      if (/^\s*<\/TabItem>\s*$/.test(line)) {
        continue;
      }
      const asideOpen = /^\s*<Aside\b[^>]*?(?:title=["']([^"']+)["'])?[^>]*>\s*$/.exec(line);
      if (asideOpen) {
        segmentOut.push(asideOpen[1] ? `> **${asideOpen[1]}**` : '> **Note**');
        continue;
      }
      if (/^\s*<\/Aside>\s*$/.test(line)) {
        continue;
      }

      segmentOut.push(
        line.replace(
          /<a\s+href=\{\`\$\{base(?:Url)?\}([^`]+)\`\}>([^<]+)<\/a>/g,
          '[$2](https://a2ui.org$1)',
        ),
      );
    }

    out.push(segmentOut.join('\n'));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderLlmsHeader() {
  const llmsSourcePath = path.join(siteRoot, 'llms.txt');
  if (!fs.existsSync(llmsSourcePath)) {
    return '# A2UI Full Documentation';
  }

  let llms = fs.readFileSync(llmsSourcePath, 'utf8').trim();
  const versionsPath = path.join(repoRoot, 'specification/versions.json');
  if (fs.existsSync(versionsPath)) {
    const {versions} = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    const placeholders = {
      '{{A2UI_PROTOCOL_VERSIONS}}': versions.map(v => `${v.version} (${v.status})`).join(', '),
      '{{A2UI_SPEC_LINKS}}': versions
        .filter(v => v.status !== 'deprecated')
        .map(v => `- [Specification ${v.version} (${v.status})](${v.spec})`)
        .join('\n'),
    };
    for (const [placeholder, value] of Object.entries(placeholders)) {
      llms = llms.replaceAll(placeholder, value);
    }
  }
  return llms;
}

export function buildMarkdownPages() {
  const files = walkDocs(docsRoot).sort();
  const pages = [];

  for (const absFile of files) {
    const raw = fs.readFileSync(absFile, 'utf8');
    const {meta, body} = parseFrontmatter(raw);
    const rel = path.relative(docsRoot, absFile).replace(/\\/g, '/');
    const slug = (meta.slug || rel.replace(/\.(?:md|mdx)$/, '').replace(/\/index$/, '')).replace(
      /^\/+|\/+$/g,
      '',
    );

    const expanded = expandIncludes(body);
    const cleaned = cleanMdxOutsideFences(expanded);
    const headerLines = [`# ${meta.title || slug}`];
    if (meta.description) {
      headerLines.push('', `> ${meta.description}`);
    }
    headerLines.push('', `Canonical URL: https://a2ui.org/${slug}/`, '');
    const fullMarkdown = `${headerLines.join('\n')}\n${cleaned}\n`;

    pages.push({slug, title: meta.title || slug, markdown: fullMarkdown});
  }

  // Sort in logical reading order: quickstart -> concepts -> guides -> specification/v1.0 -> roadmap -> ecosystem -> v0.9.1
  const rank = slug => {
    if (slug === 'quickstart') return 0;
    if (slug === 'concepts/overview') return 1;
    if (slug.startsWith('concepts/')) return 2;
    if (slug.startsWith('guides/')) return 3;
    if (slug.startsWith('specification/v1.0')) return 4;
    if (slug === 'roadmap') return 5;
    if (slug.startsWith('ecosystem/')) return 6;
    return 7;
  };
  pages.sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
  return pages;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = buildMarkdownPages();
  const llmsHeader = renderLlmsHeader();

  const llmsFull = [llmsHeader, ...pages.map(p => `\n---\n\n${p.markdown.trim()}`), ''].join('\n');

  fs.mkdirSync(publicDir, {recursive: true});
  fs.writeFileSync(path.join(publicDir, 'llms-full.txt'), llmsFull);

  if (process.argv.includes('--dist')) {
    if (!fs.existsSync(distDir)) {
      throw new Error(`[emit-markdown-bundle] dist/ directory not found at ${distDir}`);
    }
    fs.writeFileSync(path.join(distDir, 'llms-full.txt'), llmsFull);
    fs.writeFileSync(path.join(distDir, 'index.md'), `${llmsHeader}\n`);
    fs.writeFileSync(path.join(distDir, 'index.html.md'), `${llmsHeader}\n`);

    for (const page of pages) {
      const flatDest = path.join(distDir, `${page.slug}.md`);
      fs.mkdirSync(path.dirname(flatDest), {recursive: true});
      fs.writeFileSync(flatDest, page.markdown);

      const indexDest = path.join(distDir, page.slug, 'index.html.md');
      fs.mkdirSync(path.dirname(indexDest), {recursive: true});
      fs.writeFileSync(indexDest, page.markdown);
    }
    console.log(
      `[emit-markdown-bundle] Wrote llms-full.txt and ${pages.length} parallel .md routes into dist/.`,
    );
  } else {
    console.log(
      `[emit-markdown-bundle] Staged llms-full.txt (${pages.length} docs pages) into public/.`,
    );
  }
}

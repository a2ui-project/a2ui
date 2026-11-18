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

/** The ID of the element the app renders into. */
export const ROOT_ELEMENT_ID = 'a2ui-root';

/** The content of a single-file app document. */
export interface AppDocument {
  title: string;
  script: string;
  style: string;
}

/** Renders a self-contained app document with the script and style inlined. */
export function renderAppHtml({title, script, style}: AppDocument): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtmlText(title)}</title>`,
    ...(style ? [`<style>${escapeInlineStyle(style)}</style>`] : []),
    '</head>',
    '<body>',
    `<main id="${ROOT_ELEMENT_ID}"></main>`,
    `<script type="module">${escapeInlineScript(script)}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes the sequences that would end an inline script early or switch the HTML parser into its
 * escaped script state. In minified module code both can only occur inside string, template or
 * regular expression literals, where `<\/script` and `\x3C!--` mean the same characters.
 */
export function escapeInlineScript(script: string): string {
  return script.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
}

/** Escapes `</style` so that a stylesheet cannot end its inline `<style>` element early. */
function escapeInlineStyle(style: string): string {
  return style.replace(/<\/(style)/gi, '<\\/$1');
}

/** Patterns for references the browser would load from the network. */
const EXTERNAL_REFERENCE_PATTERNS: readonly RegExp[] = [
  // `import('https://…')`, `import 'https://…'` and `from 'https://…'` in the script.
  /\bimport\s*\(\s*["'`](?:https?:)?\/\/[^"'`]*/g,
  /(?<!@)\b(?:import|from)\s*["'](?:https?:)?\/\/[^"']*/g,
  // `<script src>`, `<link href>`, `<img src>` and similar attributes in the document.
  /<(?:script|link|img|iframe|source|video|audio)\b[^>]*\s(?:src|href)\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]*/gi,
  // `@import "…"` and `url(…)`, which `@import url(…)` also uses, in stylesheets.
  /@import\s+["'](?:https?:)?\/\/[^"']*/gi,
  /\burl\(\s*["']?(?:https?:)?\/\/[^"')\s]*/gi,
];

/**
 * Finds references in an app document that the browser would load from the network, which the
 * default MCP Apps content security policy blocks.
 */
export function findExternalReferences(html: string): string[] {
  const found = new Set<string>();
  for (const pattern of EXTERNAL_REFERENCE_PATTERNS) {
    for (const match of html.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

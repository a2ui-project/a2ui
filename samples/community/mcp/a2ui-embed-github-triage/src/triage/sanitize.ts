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
 * Makes untrusted issue and comment markdown safe to render: the app runs
 * under a strict CSP and the text comes from anyone on GitHub, so raw HTML,
 * images (which would load from the network) and non-HTTP links are removed
 * before the text reaches the data model.
 */

/** Longest markdown kept per body. */
export const MAX_MARKDOWN_LENGTH = 4000;

const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_TAG = /<\/?[a-zA-Z][^<>]*>/g;
const REFERENCE_IMAGE = /^\s*\[[^\]]+\]:\s*\S+.*$/gm;

/**
 * Returns `markdown` with HTML comments and tags stripped, images replaced by
 * their alt text, links kept only for http(s) URLs, and cut to `maxLength`.
 */
export function sanitizeMarkdown(markdown: string, maxLength = MAX_MARKDOWN_LENGTH): string {
  let text = markdown.replace(/\r\n?/g, '\n').replace(HTML_COMMENT, '');
  text = text.replace(IMAGE, (_match, alt: string) =>
    alt.trim() ? `[image: ${alt.trim()}]` : '[image]',
  );
  text = text.replace(LINK, (match, label: string, url: string) =>
    /^https?:\/\//i.test(url) ? match : label,
  );
  text = text.replace(REFERENCE_IMAGE, '');
  text = text.replace(HTML_TAG, '');
  // Bare autolinks to non-HTTP schemes.
  text = text.replace(/\b(?:javascript|data|vbscript):[^\s)]*/gi, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}\n\n… (truncated)`;
}

/** A single line of plain text: control characters and newlines collapsed, cut to `maxLength`. */
export function plainLine(text: string, maxLength = 140): string {
  // eslint-disable-next-line no-control-regex
  const line = text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`;
}

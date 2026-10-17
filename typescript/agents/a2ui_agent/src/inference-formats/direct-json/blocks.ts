/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Finding and cleaning `<a2ui-json>` blocks in model output.
 */

import {A2UI_CLOSE_TAG, A2UI_OPEN_TAG} from '../../parser/constants.js';
import {RawResponsePart} from '../../parser/response-part.js';

export const OPEN_TAG = A2UI_OPEN_TAG;
export const CLOSE_TAG = A2UI_CLOSE_TAG;

const OPEN_TAG_SOURCE = '<a2ui-json(?:\\s[^>]*)?>';
const CLOSE_TAG_SOURCE = '<\\/a2ui-json\\s*>';
// The start of a tag that runs to the end of the text, matched at `lastIndex`.
const OPEN_TAG_START_RE = /<a2ui-json\s[^>]*$/iy;
const CLOSE_TAG_START_RE = /<\/a2ui-json\s*$/iy;
const LEADING_FENCE_RE = /^```[a-zA-Z-]*\s*/;
const TRAILING_FENCE_RE = /\s*```[a-zA-Z-]*$/;
const STREAM_TRAILING_FENCE_RE = /\s*`{1,3}[a-zA-Z-]*\s*$/;

/** Where an open tag starts and ends. */
export interface TagMatch {
  start: number;
  end: number;
}

/** Finds the first open tag in `text` at or after `from`. */
export function searchOpenTag(text: string, from = 0): TagMatch | undefined {
  const re = new RegExp(OPEN_TAG_SOURCE, 'gi');
  re.lastIndex = from;
  const match = re.exec(text);
  return match ? {start: match.index, end: match.index + match[0].length} : undefined;
}

/** Returns where a close tag that starts exactly at `at` ends, if one does. */
export function matchCloseTag(text: string, at: number): number | undefined {
  const re = new RegExp(CLOSE_TAG_SOURCE, 'iy');
  re.lastIndex = at;
  const match = re.exec(text);
  return match ? at + match[0].length : undefined;
}

/** Returns where a tail of `text` could start an open tag, else its length. */
export function possibleTagStart(text: string): number {
  let idx = text.indexOf('<');
  while (idx >= 0) {
    if (isTagPrefix(text, idx, OPEN_TAG) || matchesAt(OPEN_TAG_START_RE, text, idx)) {
      return idx;
    }
    idx = text.indexOf('<', idx + 1);
  }
  return text.length;
}

/** Whether the rest of `text` from `idx` is a proper prefix of `tag`. */
function isTagPrefix(text: string, idx: number, tag: string): boolean {
  return text.length - idx < tag.length && tag.startsWith(text.slice(idx).toLowerCase());
}

/** Whether the sticky `re` matches `text` at `idx`. */
function matchesAt(re: RegExp, text: string, idx: number): boolean {
  re.lastIndex = idx;
  return re.test(text);
}

/**
 * Finds the close tag of a block whose body starts at `start`.
 *
 * A tag written inside a JSON string does not count.
 *
 * @returns The close tag's offset, or undefined if the block is still open, and the length
 *     of the body that can be read: up to the close tag, or up to a tail that could start
 *     one.
 */
export function scanBlock(content: string, start: number): [number | undefined, number] {
  let i = start;
  let inString = false;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    if (inString) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '<') {
      if (matchCloseTag(content, i) !== undefined) return [i, i - start];
      if (isTagPrefix(content, i, CLOSE_TAG) || matchesAt(CLOSE_TAG_START_RE, content, i)) {
        return [undefined, i - start];
      }
    }
    i += 1;
  }
  return [undefined, n - start];
}

/** Appends `text` as a final text part, unless it is empty once cleaned. */
export function addText(parts: RawResponsePart[], text: string): void {
  const cleaned = clean(text);
  if (cleaned) parts.push({type: 'text', text: cleaned, isFinal: true});
}

/** Strips whitespace and one Markdown code fence around a block body. */
export function clean(text: string): string {
  return text.trim().replace(LEADING_FENCE_RE, '').replace(TRAILING_FENCE_RE, '').trim();
}

/** Strips the opening fence and a trailing fence from a block still arriving. */
export function cleanStart(block: string): string {
  let text = block.trimStart();
  // Nothing has arrived yet but the start of a fence.
  if ('```'.startsWith(text)) return '';
  if (text.startsWith('```')) {
    const newline = text.indexOf('\n');
    if (newline < 0) return '';
    text = text.slice(newline + 1);
  }
  return text.replace(STREAM_TRAILING_FENCE_RE, '');
}

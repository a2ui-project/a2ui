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
const LEADING_FENCE_RE = /^```[a-zA-Z0-9_-]*\s*/i;
const TRAILING_FENCE_RE = /\s*```[a-zA-Z0-9_-]*$/i;

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
  return new BlockScanner(start).scan(content);
}

/**
 * Finds the close tag of a block as its text arrives, reading each character once across
 * the scans of a longer and longer text.
 */
export class BlockScanner {
  private i: number;
  private inString = false;

  /** @param start Where the block's body starts. */
  constructor(private readonly start: number) {
    this.i = start;
  }

  /**
   * Scans `content`, the text the last scan read and more, from where the last scan
   * stopped. Returns what `scanBlock` returns.
   */
  scan(content: string): [number | undefined, number] {
    const n = content.length;
    while (this.i < n) {
      const c = content[this.i];
      if (this.inString) {
        if (c === '\\') {
          // Past the end of the text when the escaped character has not arrived yet.
          this.i += 2;
          continue;
        }
        if (c === '"') this.inString = false;
      } else if (c === '"') {
        this.inString = true;
      } else if (c === '<') {
        if (matchCloseTag(content, this.i) !== undefined) return [this.i, this.i - this.start];
        if (
          isTagPrefix(content, this.i, CLOSE_TAG) ||
          matchesAt(CLOSE_TAG_START_RE, content, this.i)
        ) {
          // Scanned again from here once more text arrives.
          return [undefined, this.i - this.start];
        }
      }
      this.i += 1;
    }
    return [undefined, n - this.start];
  }
}

/** Appends `text` as a final text part, unless it is empty once cleaned. */
export function addText(parts: RawResponsePart[], text: string): void {
  const cleaned = clean(text);
  if (cleaned) parts.push({type: 'text', text: cleaned, isFinal: true});
}

/** Strips whitespace and one Markdown code fence around a block body. */
export function clean(text: string): string {
  const cleaned = text.trim().replace(LEADING_FENCE_RE, '').replace(TRAILING_FENCE_RE, '').trim();
  return /^`*$/.test(cleaned) ? '' : cleaned;
}

/** Strips whitespace, fences, and inline-code edge backticks from a block body. */
export function cleanRaw(text: string): string {
  return clean(text)
    .replace(/^`+|`+$/g, '')
    .trim();
}

/**
 * Where the payload of a block still arriving starts: after leading whitespace, and after
 * the line of a leading Markdown fence, or undefined while that line is not complete.
 *
 * @param text The text of the block.
 * @param end Where the part of `text` that can be read ends.
 */
export function payloadStart(text: string, end: number): number | undefined {
  let start = 0;
  while (start < end && isSpace(text, start)) start += 1;
  if (start === end || text[start] !== '`') return start;
  const newline = text.indexOf('\n', start);
  return newline < 0 || newline >= end ? undefined : newline + 1;
}

/**
 * Where a Markdown fence that ends the part of `text` from `start` to `end`, or the start of
 * one, begins, with the whitespace before it, or `end` if none ends it.
 *
 * Finds what `\s*`{1,3}[a-zA-Z-]*\s*$` matches by reading back from the end, since a regular
 * expression would try every offset of a block that is read again on every chunk.
 */
export function trailingFenceStart(text: string, start: number, end: number): number {
  let fence = end;
  while (fence > start && isSpace(text, fence - 1)) fence -= 1;
  while (fence > start && /[a-zA-Z-]/.test(text[fence - 1])) fence -= 1;
  let ticks = 0;
  while (ticks < 3 && fence > start && text[fence - 1] === '`') {
    fence -= 1;
    ticks += 1;
  }
  if (ticks === 0) return end;
  while (fence > start && isSpace(text, fence - 1)) fence -= 1;
  return fence;
}

function isSpace(text: string, i: number): boolean {
  return /\s/.test(text[i]);
}

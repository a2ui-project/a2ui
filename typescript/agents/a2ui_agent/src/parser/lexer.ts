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

import {RawResponsePart} from './response-part.js';

export enum LexerState {
  NORMAL = 0, // Outside tag (conversational text)
  IN_A2UI = 1, // Inside tag (scanning code)
  IN_STRING = 2, // Inside string literal
  IN_COMMENT = 3, // Inside single-line comment
}

const LEADING_FENCE_RE = /^```[a-zA-Z0-9_-]*\s*/i;
const TRAILING_FENCE_RE = /\s*```[a-zA-Z0-9_-]*$/i;
const OPEN_FENCE_RE = /^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?/gm;
const CLOSING_FENCE_END_RE = /\r?\n?[ \t]*```[ \t]*\r?\n?$/;

export const EXPRESS_PAYLOAD_START_RE =
  /^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?!=))/m;
export const JSON_PAYLOAD_START_RE = /^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))/m;

/**
 * A generic state-machine-based scanner to extract structured format blocks from text.
 *
 * Correctly handles nested string literals and comments to prevent premature tag detection,
 * and strips Markdown code block wrapping artifacts.
 */
export class BlockLexer {
  private readonly openTagPattern: RegExp;
  private readonly openTagSearchPattern: RegExp;
  private readonly closeTagPattern: RegExp;
  private readonly closeTagSearchPattern: RegExp;
  private readonly stringDelimiters: Set<string>;
  private readonly singleLineComments: Set<string>;
  private readonly payloadStartPattern: RegExp;
  private readonly stripEdgeBackticks: boolean;

  /**
   * Initializes the block lexer with tag patterns, string delimiters, and comments.
   *
   * @param openTag Either the literal open tag string or a pre-compiled regex pattern.
   * @param closeTag Either the literal close tag string or a pre-compiled regex pattern.
   * @param stringDelimiters Character set representing string bounds.
   * @param singleLineComments Character set representing single-line comment markers.
   * @param payloadStartPattern Line-anchored regex matching the start of an unfenced payload.
   * @param stripEdgeBackticks Whether to strip inline-code backticks adjacent to tags.
   */
  constructor(
    openTag: string | RegExp = '<a2ui>',
    closeTag: string | RegExp = '</a2ui>',
    stringDelimiters: Set<string> = new Set(["'", '"']),
    singleLineComments: Set<string> = new Set(['#']),
    payloadStartPattern: RegExp = EXPRESS_PAYLOAD_START_RE,
    stripEdgeBackticks: boolean = false,
  ) {
    this.openTagPattern = this.toStickyRegExp(openTag, false);
    this.openTagSearchPattern = this.toSearchRegExp(openTag, false);
    this.closeTagPattern = this.toStickyRegExp(closeTag, true);
    this.closeTagSearchPattern = this.toSearchRegExp(closeTag, true);
    this.stringDelimiters = stringDelimiters;
    this.singleLineComments = singleLineComments;
    this.payloadStartPattern = payloadStartPattern;
    this.stripEdgeBackticks = stripEdgeBackticks;
  }

  private toStickyRegExp(tag: string | RegExp, isClose: boolean): RegExp {
    if (typeof tag === 'string') {
      const tagName = tag.replace(/[<>/]/g, '');
      if (isClose) {
        return new RegExp(`</${tagName}\\s*>`, 'iy');
      }
      return new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'iy');
    }

    let flags = tag.flags;
    if (!flags.includes('y')) {
      flags += 'y';
    }
    let source = tag.source;
    if (source.startsWith('^')) {
      source = source.substring(1);
    }
    return new RegExp(source, flags);
  }

  private toSearchRegExp(tag: string | RegExp, isClose: boolean): RegExp {
    if (typeof tag === 'string') {
      const tagName = tag.replace(/[<>/]/g, '');
      if (isClose) {
        return new RegExp(`</${tagName}\\s*>`, 'i');
      }
      return new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'i');
    }

    const flags = tag.flags.replace(/[yg]/g, '');
    let source = tag.source;
    if (source.startsWith('^')) {
      source = source.substring(1);
    }
    return new RegExp(source, flags);
  }

  /**
   * Cleans Markdown code block wrappers from either conversational text or inner raw content.
   *
   * A run made of nothing but backticks is left over from tags written as inline code, so it is
   * dropped.
   */
  private cleanMarkdown(text: string): string {
    if (!text) {
      return '';
    }
    let cleaned = text.trim();
    cleaned = cleaned.replace(LEADING_FENCE_RE, '');
    cleaned = cleaned.replace(TRAILING_FENCE_RE, '');
    cleaned = cleaned.trim();
    return /^`*$/.test(cleaned) ? '' : cleaned;
  }

  /**
   * Cleans a raw block: Markdown fences, then backticks left at its edges.
   *
   * No payload format starts or ends with a backtick, so the ones at the edges are left over from
   * tags written as inline code, such as `` `<a2ui>` ``.
   */
  private cleanRaw(text: string): string {
    return this.cleanMarkdown(text)
      .replace(/^`+|`+$/g, '')
      .trim();
  }

  private addText(parts: RawResponsePart[], text: string): void {
    const cleaned = this.cleanMarkdown(text);
    if (cleaned) {
      parts.push({type: 'text', text: cleaned, isFinal: true});
    }
  }

  private scanBlock(content: string, start: number, end: number): [number, number] | null {
    let i = start;
    let state = LexerState.IN_A2UI;
    let stringDelim: string | null = null;
    let tripleQuote = false;

    while (i < end) {
      if (state === LexerState.IN_A2UI) {
        this.closeTagPattern.lastIndex = i;
        const match = this.closeTagPattern.exec(content);
        if (match && this.closeTagPattern.lastIndex <= end) {
          return [i, this.closeTagPattern.lastIndex];
        }

        const ch = content[i];
        if (this.stringDelimiters.has(ch)) {
          if (i + 2 < end && content.startsWith(ch.repeat(3), i)) {
            stringDelim = ch.repeat(3);
            tripleQuote = true;
            i += 3;
          } else {
            stringDelim = ch;
            tripleQuote = false;
            i += 1;
          }
          state = LexerState.IN_STRING;
          continue;
        }

        let commentStart = false;
        for (const cm of this.singleLineComments) {
          if (content.startsWith(cm, i)) {
            i += cm.length;
            state = LexerState.IN_COMMENT;
            commentStart = true;
            break;
          }
        }
        if (commentStart) {
          continue;
        }

        i += 1;
        continue;
      }

      if (state === LexerState.IN_STRING) {
        if (content[i] === '\\') {
          i += 2;
          continue;
        }
        if (tripleQuote) {
          if (content.startsWith(stringDelim!, i)) {
            i += 3;
            state = LexerState.IN_A2UI;
            continue;
          }
        } else {
          if (content[i] === stringDelim) {
            i += 1;
            state = LexerState.IN_A2UI;
            continue;
          }
        }
        i += 1;
        continue;
      }

      if (state === LexerState.IN_COMMENT) {
        this.closeTagPattern.lastIndex = i;
        const match = this.closeTagPattern.exec(content);
        if (match && this.closeTagPattern.lastIndex <= end) {
          return [i, this.closeTagPattern.lastIndex];
        }
        const ch = content[i];
        if (ch === '\n' || ch === '\r') {
          state = LexerState.IN_A2UI;
        }
        i += 1;
        continue;
      }
    }

    return null;
  }

  private tryRecoverUnmatchedClose(
    parts: RawResponsePart[],
    content: string,
    start: number,
    searchEnd: number,
  ): number | null {
    const segment = content.slice(start, searchEnd);
    if (!this.closeTagSearchPattern.test(segment)) {
      return null;
    }

    const fences = Array.from(segment.matchAll(OPEN_FENCE_RE));
    for (let idx = 0; idx < fences.length; idx += 2) {
      const fence = fences[idx];
      const fenceStart = fence.index ?? 0;
      const fenceEnd = fenceStart + fence[0].length;
      const closeSpan = this.scanBlock(segment, fenceEnd, segment.length);
      if (!closeSpan) {
        continue;
      }
      const [closeStart, closeEnd] = closeSpan;
      const body = segment.slice(fenceEnd, closeStart);
      const bodyStripped = body.replace(CLOSING_FENCE_END_RE, '');
      OPEN_FENCE_RE.lastIndex = 0;
      if (OPEN_FENCE_RE.test(bodyStripped)) {
        continue;
      }
      const rawContent = this.cleanRaw(bodyStripped);
      if (!rawContent) {
        continue;
      }
      this.addText(parts, segment.slice(0, fenceStart));
      parts.push({type: 'a2ui', a2uiRaw: rawContent, isFinal: true});
      return start + closeEnd;
    }

    let searchFrom = 0;
    let pairIdx = 0;
    while (pairIdx + 1 < fences.length) {
      const closeFence = fences[pairIdx + 1];
      const closeFenceEnd = (closeFence.index ?? 0) + closeFence[0].length;
      if (!this.scanBlock(segment, closeFenceEnd, segment.length)) {
        break;
      }
      searchFrom = closeFenceEnd;
      pairIdx += 2;
    }

    const subSegment = segment.slice(searchFrom);
    const stmtMatch = this.payloadStartPattern.exec(subSegment);
    if (!stmtMatch || stmtMatch.index === undefined) {
      return null;
    }
    const stmtStart = searchFrom + stmtMatch.index;
    const closeSpan = this.scanBlock(segment, stmtStart, segment.length);
    if (!closeSpan) {
      return null;
    }
    const [closeStart, closeEnd] = closeSpan;
    const rawContent = this.cleanRaw(segment.slice(stmtStart, closeStart));
    if (!rawContent) {
      return null;
    }
    this.addText(parts, segment.slice(0, stmtStart));
    parts.push({type: 'a2ui', a2uiRaw: rawContent, isFinal: true});
    return start + closeEnd;
  }

  /**
   * Scans response content to extract format blocks.
   *
   * @param content The raw text response string to scan.
   * @returns A list of tokenized response parts.
   */
  tokenize(content: string): RawResponsePart[] {
    const parts: RawResponsePart[] = [];
    const n = content.length;
    let i = 0;
    let recoveredUnmatched = false;

    while (i < n) {
      const remaining = content.slice(i);
      const openMatch = this.openTagSearchPattern.exec(remaining);
      const openStart = openMatch && openMatch.index !== undefined ? i + openMatch.index : null;
      const searchEnd = openStart ?? n;

      if (!recoveredUnmatched && searchEnd > i) {
        const nextI = this.tryRecoverUnmatchedClose(parts, content, i, searchEnd);
        if (nextI !== null) {
          recoveredUnmatched = true;
          i = nextI;
          continue;
        }
      }

      if (openStart === null || !openMatch) {
        break;
      }

      let textBefore = content.slice(i, openStart);
      if (this.stripEdgeBackticks && textBefore.endsWith('`')) {
        textBefore = textBefore.replace(/`+$/, '');
      }
      this.addText(parts, textBefore);
      const openEnd = openStart + openMatch[0].length;
      const closeSpan = this.scanBlock(content, openEnd, n);
      if (!closeSpan) {
        parts.push({
          type: 'a2ui',
          a2uiRaw: this.cleanRaw(content.slice(openEnd)),
          isFinal: false,
        });
        return parts;
      }

      const [closeStart, closeEnd] = closeSpan;
      parts.push({
        type: 'a2ui',
        a2uiRaw: this.cleanRaw(content.slice(openEnd, closeStart)),
        isFinal: true,
      });
      i = closeEnd;
      if (this.stripEdgeBackticks) {
        while (i < n && content[i] === '`') {
          i++;
        }
      }
    }

    this.addText(parts, content.slice(i));
    return parts;
  }
}

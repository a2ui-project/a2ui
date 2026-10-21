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

const OPEN_FENCE_RE = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?/g;
const PAYLOAD_START_RE =
  /^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=|[a-zA-Z_][a-zA-Z0-9_]*\s*=|[[{])/m;

/**
 * A generic state-machine-based scanner to extract structured format blocks from text.
 *
 * Correctly handles nested string literals and comments to prevent premature tag detection,
 * and strips Markdown code block wrapping artifacts.
 */
export class BlockLexer {
  private readonly openTagPattern: RegExp;
  private readonly closeTagPattern: RegExp;
  private readonly stringDelimiters: Set<string>;
  private readonly singleLineComments: Set<string>;

  /**
   * Initializes the block lexer with tag patterns, string delimiters, and comments.
   *
   * @param openTag Either the literal open tag string or a pre-compiled regex pattern.
   * @param closeTag Either the literal close tag string or a pre-compiled regex pattern.
   * @param stringDelimiters Character set representing string bounds.
   * @param singleLineComments Character set representing single-line comment markers.
   */
  constructor(
    openTag: string | RegExp = '<a2ui>',
    closeTag: string | RegExp = '</a2ui>',
    stringDelimiters: Set<string> = new Set(["'", '"']),
    singleLineComments: Set<string> = new Set(['#']),
  ) {
    this.openTagPattern = this.toStickyRegExp(openTag, false);
    this.closeTagPattern = this.toStickyRegExp(closeTag, true);
    this.stringDelimiters = stringDelimiters;
    this.singleLineComments = singleLineComments;
  }

  private toStickyRegExp(tag: string | RegExp, isClose: boolean): RegExp {
    if (typeof tag === 'string') {
      const tagName = tag.replace(/[<>/]/g, '');
      if (isClose) {
        return new RegExp(`</${tagName}\\s*>`, 'iy');
      }
      return new RegExp(`<${tagName}\\b[^>]*>`, 'iy');
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
    cleaned = cleaned.replace(/^```[a-zA-Z-]*\s*/i, '');
    cleaned = cleaned.replace(/\s*```[a-zA-Z-]*$/i, '');
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

  private tryEmitUnmatchedClose(parts: RawResponsePart[], textBefore: string): boolean {
    const fenceMatches = Array.from(textBefore.matchAll(OPEN_FENCE_RE));
    let textPart = '';
    let rawContent = '';
    if (fenceMatches.length > 0) {
      const lastFence = fenceMatches[fenceMatches.length - 1];
      const fenceStart = lastFence.index ?? 0;
      const fenceEnd = fenceStart + lastFence[0].length;
      rawContent = this.cleanRaw(textBefore.slice(fenceEnd));
      if (!rawContent) {
        return false;
      }
      textPart = this.cleanMarkdown(textBefore.slice(0, fenceStart));
    } else {
      const stmtMatch = PAYLOAD_START_RE.exec(textBefore);
      if (!stmtMatch || stmtMatch.index === undefined) {
        return false;
      }
      const prefix = textBefore.slice(0, stmtMatch.index);
      if (stmtMatch.index > 0 && /[={[(\]]/.test(prefix)) {
        rawContent = this.cleanRaw(textBefore);
      } else {
        rawContent = this.cleanRaw(textBefore.slice(stmtMatch.index));
        textPart = this.cleanMarkdown(prefix);
      }
      if (!rawContent) {
        return false;
      }
    }

    if (textPart) {
      parts.push({type: 'text', text: textPart, isFinal: true});
    }
    parts.push({type: 'a2ui', a2uiRaw: rawContent, isFinal: true});
    return true;
  }

  /**
   * Scans response content character-by-character to extract format blocks.
   *
   * @param content The raw text response string to scan.
   * @returns A list of tokenized response parts.
   */
  tokenize(content: string): RawResponsePart[] {
    const parts: RawResponsePart[] = [];
    const n = content.length;
    let i = 0;

    let state = LexerState.NORMAL;

    let currentText: string[] = [];
    let currentRaw: string[] = [];

    let stringDelim: string | null = null;
    let tripleQuote = false;

    while (i < n) {
      if (state === LexerState.NORMAL) {
        this.openTagPattern.lastIndex = i;
        const match = this.openTagPattern.exec(content);
        if (match) {
          i = this.openTagPattern.lastIndex;
          state = LexerState.IN_A2UI;
          currentRaw = [];
          continue;
        }
        this.closeTagPattern.lastIndex = i;
        const closeMatch = this.closeTagPattern.exec(content);
        if (closeMatch && this.tryEmitUnmatchedClose(parts, currentText.join(''))) {
          currentText = [];
          i = this.closeTagPattern.lastIndex;
          continue;
        }
        currentText.push(content[i]);
        i += 1;
        continue;
      }

      if (state === LexerState.IN_A2UI) {
        this.closeTagPattern.lastIndex = i;
        const match = this.closeTagPattern.exec(content);
        if (match) {
          const rawContent = this.cleanRaw(currentRaw.join(''));
          const textPart = this.cleanMarkdown(currentText.join(''));

          if (textPart) {
            parts.push({type: 'text', text: textPart, isFinal: true});
          }
          parts.push({
            type: 'a2ui',
            a2uiRaw: rawContent,
            isFinal: true,
          });

          currentText = [];
          currentRaw = [];
          state = LexerState.NORMAL;
          i = this.closeTagPattern.lastIndex;
          continue;
        }

        const ch = content[i];

        if (this.stringDelimiters.has(ch)) {
          if (i + 2 < n && content.startsWith(ch.repeat(3), i)) {
            stringDelim = ch.repeat(3);
            tripleQuote = true;
            currentRaw.push(stringDelim);
            i += 3;
          } else {
            stringDelim = ch;
            tripleQuote = false;
            currentRaw.push(ch);
            i += 1;
          }
          state = LexerState.IN_STRING;
          continue;
        }

        let commentStart = false;
        for (const cm of this.singleLineComments) {
          if (content.startsWith(cm, i)) {
            currentRaw.push(cm);
            i += cm.length;
            state = LexerState.IN_COMMENT;
            commentStart = true;
            break;
          }
        }
        if (commentStart) {
          continue;
        }

        currentRaw.push(ch);
        i += 1;
        continue;
      }

      if (state === LexerState.IN_STRING) {
        if (content[i] === '\\') {
          if (i + 1 < n) {
            currentRaw.push(content.substring(i, i + 2));
            i += 2;
          } else {
            currentRaw.push(content[i]);
            i += 1;
          }
          continue;
        }

        if (tripleQuote) {
          if (content.startsWith(stringDelim!, i)) {
            currentRaw.push(stringDelim!);
            i += 3;
            state = LexerState.IN_A2UI;
            continue;
          }
        } else {
          if (content[i] === stringDelim) {
            currentRaw.push(stringDelim!);
            i += 1;
            state = LexerState.IN_A2UI;
            continue;
          }
        }

        currentRaw.push(content[i]);
        i += 1;
        continue;
      }

      if (state === LexerState.IN_COMMENT) {
        const ch = content[i];
        currentRaw.push(ch);
        i += 1;
        if (ch === '\n' || ch === '\r') {
          state = LexerState.IN_A2UI;
        }
        continue;
      }
    }

    if (
      state === LexerState.IN_A2UI ||
      state === LexerState.IN_STRING ||
      state === LexerState.IN_COMMENT
    ) {
      const rawContent = this.cleanRaw(currentRaw.join(''));
      const textPart = this.cleanMarkdown(currentText.join(''));

      if (textPart) {
        parts.push({type: 'text', text: textPart, isFinal: false});
      }
      parts.push({
        type: 'a2ui',
        a2uiRaw: rawContent,
        isFinal: false,
      });
    } else {
      const trailing = this.cleanMarkdown(currentText.join(''));
      if (trailing) {
        parts.push({type: 'text', text: trailing, isFinal: true});
      }
    }

    return parts;
  }
}

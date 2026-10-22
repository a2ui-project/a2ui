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

import {ParseError} from '../../errors.js';
import {AgentToRendererMessage, CatalogApi, linkCatalogs} from '../../internal/web-core.js';
import {ParseOptions, Parser} from '../../parser/parser.js';
import {RawResponsePart} from '../../parser/response-part.js';
import {checkParserCatalogs} from '../../utils/catalog-checks.js';
import {
  CLOSE_TAG,
  OPEN_TAG,
  addText,
  clean,
  matchCloseTag,
  scanBlock,
  searchOpenTag,
} from './blocks.js';
import {DirectJsonDecompiler} from './decompiler.js';
import {readJson} from './json-reader.js';
import {DirectJsonResponseStream} from './response-stream.js';

/** Options for a Direct JSON parser. */
export interface DirectJsonParserOptions {
  /**
   * Keys whose string values a stream closes where they stand while they arrive, so a long
   * text is emitted as it grows. Values that start like a URL are never closed early. None
   * by default.
   */
  progressiveKeys?: Iterable<string>;
}

/** Parser for the Direct JSON format, for complete and streamed responses. */
export class DirectJsonParser extends Parser {
  /** The active catalogs, linked to each other so cross-catalog `$ref`s resolve. */
  readonly catalogs: CatalogApi[];
  /** The keys whose string values a stream heals while they arrive. */
  readonly progressiveKeys: ReadonlySet<string>;
  private readonly decompiler = new DirectJsonDecompiler();

  /**
   * @param catalogs The active catalogs, which must target compatible protocol versions.
   * @param options How a stream reads values that are still arriving.
   * @throws {A2uiCatalogError} If no catalogs are given or their versions are incompatible.
   */
  constructor(catalogs: CatalogApi[], options: DirectJsonParserOptions = {}) {
    super();
    checkParserCatalogs(catalogs);
    this.catalogs = linkCatalogs(catalogs);
    this.progressiveKeys = new Set(options.progressiveKeys ?? []);
  }

  override get supportsStreaming(): boolean {
    return true;
  }

  hasFormatContent(content: string, {complete = false}: {complete?: boolean} = {}): boolean {
    const open = searchOpenTag(content);
    if (!open) return false;
    if (!complete) return true;
    const [closeStart] = scanBlock(content, open.end);
    return closeStart !== undefined;
  }

  unwrap(content: string): RawResponsePart[] {
    const parts: RawResponsePart[] = [];
    let i = 0;
    for (;;) {
      const open = searchOpenTag(content, i);
      if (!open) break;
      addText(parts, content.slice(i, open.start));
      const [closeStart] = scanBlock(content, open.end);
      if (closeStart === undefined) {
        parts.push({type: 'a2ui', a2uiRaw: clean(content.slice(open.end)), isFinal: false});
        return parts;
      }
      parts.push({
        type: 'a2ui',
        a2uiRaw: clean(content.slice(open.end, closeStart)),
        isFinal: true,
      });
      i = matchCloseTag(content, closeStart)!;
    }
    addText(parts, content.slice(i));
    return parts;
  }

  /**
   * Reads a block as a JSON message or a JSON array of messages.
   *
   * @throws {ParseError} If the block is empty or is not JSON.
   */
  compile(formatContent: string, isFinal = true): AgentToRendererMessage[] {
    if (!isFinal) {
      throw new ParseError(
        `The response ended inside an ${OPEN_TAG} block, before its ${CLOSE_TAG} tag.`,
      );
    }
    const cleaned = clean(formatContent);
    if (!cleaned) {
      throw new ParseError('The direct JSON block is empty.');
    }
    let decoded: unknown;
    try {
      decoded = readJson(cleaned);
    } catch (e) {
      throw new ParseError(`The direct JSON block is not JSON: ${(e as Error).message}`);
    }
    return (Array.isArray(decoded) ? decoded : [decoded]) as AgentToRendererMessage[];
  }

  decompile(a2uiPayload: AgentToRendererMessage[]): string {
    return this.decompiler.decompile(a2uiPayload);
  }

  wrap(blocks: RawResponsePart[]): string {
    return this.decompiler.wrap(blocks);
  }

  override openStream({wrapped = true, state}: ParseOptions = {}): DirectJsonResponseStream {
    return new DirectJsonResponseStream(this, wrapped, state ?? this.emptyState());
  }
}

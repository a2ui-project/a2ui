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
import {AgentToRendererMessage, CatalogApi} from '../../internal/web-core.js';
import {BlockLexer, JSON_PAYLOAD_START_RE} from '../../parser/lexer.js';
import {ContinuingStreamOptions, Parser, StreamOptions} from '../../parser/parser.js';
import {RawResponsePart, StreamPart} from '../../parser/response-part.js';
import {checkParserCatalogs} from '../../utils/catalog-checks.js';
import {CLOSE_TAG, OPEN_TAG, cleanRaw} from './blocks.js';
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
  /** The active catalogs. */
  readonly catalogs: CatalogApi[];
  /** The keys whose string values a stream heals while they arrive. */
  readonly progressiveKeys: ReadonlySet<string>;
  private readonly decompiler = new DirectJsonDecompiler();
  private readonly lexer = new BlockLexer(
    OPEN_TAG,
    CLOSE_TAG,
    new Set(["'", '"']),
    new Set(),
    JSON_PAYLOAD_START_RE,
    true,
  );

  /**
   * @param catalogs The active catalogs, which must target compatible protocol versions.
   * @param options How a stream reads values that are still arriving.
   * @throws {A2uiCatalogError} If no catalogs are given or their versions are incompatible.
   */
  constructor(catalogs: CatalogApi[], options: DirectJsonParserOptions = {}) {
    super();
    checkParserCatalogs(catalogs);
    this.catalogs = catalogs;
    this.progressiveKeys = new Set(options.progressiveKeys ?? []);
  }

  override get supportsStreaming(): boolean {
    return true;
  }

  hasFormatContent(content: string, {complete = false}: {complete?: boolean} = {}): boolean {
    const parts = this.lexer.tokenize(content);
    return parts.some(p => p.type === 'a2ui' && (!complete || p.isFinal));
  }

  unwrap(content: string): RawResponsePart[] {
    return this.lexer.tokenize(content);
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
    const cleaned = cleanRaw(formatContent);
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

  override openStream(options: ContinuingStreamOptions): DirectJsonResponseStream<StreamPart>;
  override openStream(options?: StreamOptions): DirectJsonResponseStream;
  override openStream({
    wrapped = true,
    state,
    afterRejectedBlock = 'end',
  }: StreamOptions = {}): DirectJsonResponseStream<StreamPart> {
    return new DirectJsonResponseStream<StreamPart>(this, {
      wrapped,
      state: state ?? this.emptyState(),
      afterRejectedBlock,
    });
  }
}

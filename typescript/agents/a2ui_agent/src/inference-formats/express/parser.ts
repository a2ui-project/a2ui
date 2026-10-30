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
 * @fileoverview Concrete parser implementation for A2UI Express DSL responses.
 *
 * Tokenizes response text into format blocks and conversational text,
 * delegating compilation to ExpressCompiler and decompilation to ExpressDecompiler.
 */

import {AgentToRendererMessage, CatalogApi} from '../../internal/web-core.js';
import {A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG} from '../../parser/constants.js';
import {BlockLexer, EXPRESS_PAYLOAD_START_RE} from '../../parser/lexer.js';
import {ContinuingStreamOptions, Parser, StreamOptions} from '../../parser/parser.js';
import {RawResponsePart, StreamPart} from '../../parser/response-part.js';
import {RendererState} from '../../utils/renderer-state.js';
import {resolveExpressVersion, toCatalogList} from './catalogs.js';
import {ExpressCompiler} from './compiler.js';
import {ExpressDecompiler} from './decompiler.js';
import {
  DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
  ExpressResponseStream,
  wrapExpressCompilationError,
} from './response-stream.js';

/** Options for configuring an `ExpressParser`. */
export interface ExpressParserOptions {
  progressiveKeys?: ReadonlySet<string> | Iterable<string>;
}

/**
 * Concrete parser implementation for A2UI Express DSL responses.
 */
export class ExpressParser extends Parser {
  readonly catalogs: CatalogApi[];
  readonly surfaceId: string;
  readonly version: string;
  readonly progressiveKeys: ReadonlySet<string>;
  private readonly lexer: BlockLexer;
  private readonly decompiler: ExpressDecompiler;

  /**
   * Initializes the Express parser with catalog schemas and target version.
   *
   * @param catalogs The component catalog, or several. A `surface(...)` line picks one by id.
   * @param surfaceId Surface identifier for compiled messages.
   * @param version Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
   * @param options Optional streaming and parser configuration.
   */
  constructor(
    catalogs: CatalogApi | CatalogApi[],
    surfaceId = 'main',
    version?: string,
    options: ExpressParserOptions = {},
  ) {
    super();
    this.catalogs = toCatalogList(catalogs);
    this.version = resolveExpressVersion(this.catalogs, version);
    this.surfaceId = surfaceId;
    this.progressiveKeys =
      options.progressiveKeys !== undefined
        ? new Set(options.progressiveKeys)
        : DEFAULT_EXPRESS_PROGRESSIVE_KEYS;
    this.lexer = new BlockLexer(
      A2UI_INFERENCE_OPEN_TAG,
      A2UI_INFERENCE_CLOSE_TAG,
      // Strings and comments as Express.g4 reads them: strings are double-quoted
      // only, so an apostrophe never opens one, and a quote or close tag inside
      // a `/* */` comment does not affect the block.
      new Set(['"']),
      new Set(['#', '//', '--']),
      EXPRESS_PAYLOAD_START_RE,
      false,
      [['/*', '*/']],
    );
    this.decompiler = new ExpressDecompiler(this.catalogs, this.version);
  }

  override get supportsStreaming(): boolean {
    return true;
  }

  override openStream(options: ContinuingStreamOptions): ExpressResponseStream<StreamPart>;
  override openStream(options?: StreamOptions): ExpressResponseStream;
  override openStream({
    wrapped = true,
    state,
    afterRejectedBlock = 'end',
  }: StreamOptions = {}): ExpressResponseStream<StreamPart> {
    return new ExpressResponseStream<StreamPart>(this, {
      wrapped,
      state: state ?? new RendererState(this.catalogs),
      afterRejectedBlock,
      progressiveKeys: this.progressiveKeys,
    });
  }

  hasFormatContent(content: string, {complete = false}: {complete?: boolean} = {}): boolean {
    const parts = this.lexer.tokenize(content);
    // The lexer reports an unterminated block as a part that is not final.
    return parts.some(p => p.type === 'a2ui' && (!complete || p.isFinal));
  }

  /**
   * Unwraps response content into raw Express DSL parts and conversational text.
   */
  unwrap(content: string): RawResponsePart[] {
    return this.lexer.tokenize(content);
  }

  /**
   * Compiles raw Express DSL into structured A2UI messages.
   */
  compile(formatContent: string, isFinal = true): AgentToRendererMessage[] {
    const compiler = new ExpressCompiler(this.catalogs, this.version);
    try {
      return compiler.compile(formatContent, this.surfaceId, isFinal);
    } catch (e) {
      throw wrapExpressCompilationError(e, formatContent);
    }
  }

  /**
   * Decompiles structured A2UI messages back into Express notation.
   */
  decompile(messages: AgentToRendererMessage[]): string {
    return this.decompiler.decompile(messages);
  }

  /**
   * Wraps raw response parts, adding format tags around A2UI payload sections.
   */
  wrap(blocks: RawResponsePart[]): string {
    return this.decompiler.wrap(blocks);
  }
}

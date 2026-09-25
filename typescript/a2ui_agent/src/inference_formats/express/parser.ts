/*
 * Copyright 2026 Google LLC
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

import {Parser} from '../../parser/parser.js';
import {RawResponsePart} from '../../parser/response_part.js';
import {AgentToRendererMessage} from '../../internal/web_core.js';
import {SchemaCatalog} from '../../types.js';
import {BlockLexer} from '../../parser/lexer.js';
import {A2UI_INFERENCE_OPEN_TAG, A2UI_INFERENCE_CLOSE_TAG} from '../../parser/constants.js';
import {resolveExpressVersion, toCatalogList} from './catalogs.js';
import {
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
} from '../../errors.js';
import {ExpressCompiler, pyStr} from './compiler.js';
import {ExpressDecompiler} from './decompiler.js';
import {
  ExpressCompilerError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressValidationError,
} from './errors.js';

function compilationErrorClass(error: ExpressCompilerError): new (
  message: string,
  options: {
    rawContent: string;
    line?: number;
    column?: number;
    helpMessage?: string;
  },
) => A2uiCompilationError {
  if (error instanceof ExpressValidationError) {
    return A2uiCompilationValidationError;
  }
  const cause = (error as {cause?: unknown}).cause;
  if (error instanceof ExpressParseError || cause instanceof ExpressSyntaxError) {
    return A2uiCompilationParseError;
  }
  return A2uiCompilationError;
}

/**
 * Concrete parser implementation for A2UI Express DSL responses.
 */
export class ExpressParser extends Parser {
  readonly catalogs: SchemaCatalog[];
  readonly surfaceId: string;
  readonly version: string;
  private readonly lexer: BlockLexer;
  private readonly decompiler: ExpressDecompiler;

  /**
   * Initializes the Express parser with catalog schemas and target version.
   *
   * @param catalogs The component catalog, or several. A `surface(...)` line picks one by id.
   * @param surfaceId Surface identifier for compiled messages.
   * @param version Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
   */
  constructor(catalogs: SchemaCatalog | SchemaCatalog[], surfaceId = 'main', version?: string) {
    super();
    this.catalogs = toCatalogList(catalogs);
    this.version = resolveExpressVersion(this.catalogs, version);
    this.surfaceId = surfaceId;
    this.lexer = new BlockLexer(
      A2UI_INFERENCE_OPEN_TAG,
      A2UI_INFERENCE_CLOSE_TAG,
      new Set(["'", '"']),
      new Set(['#']),
    );
    this.decompiler = new ExpressDecompiler(this.catalogs, this.version);
  }

  /**
   * Checks whether the given content string contains complete A2UI Express sentinel tags.
   */
  hasA2uiParts(content: string): boolean {
    const parts = this.lexer.tokenize(content);
    return parts.some(p => p.type === 'a2ui' && p.isFinal);
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
      return compiler.compile(formatContent, this.surfaceId, '', isFinal);
    } catch (e) {
      if (e instanceof ExpressCompilerError) {
        const cause = (e as {cause?: unknown}).cause;
        let line: number | undefined;
        let column: number | undefined;

        if (e instanceof ExpressSyntaxError) {
          line = e.line;
          column = e.column;
        } else if (cause instanceof ExpressSyntaxError) {
          line = cause.line;
          column = cause.column;
        }

        const helpMessage = e.helpMessage || 'Please correct the syntax error in your Express DSL.';
        const ErrorClass = compilationErrorClass(e);
        const message = pyStr(e);

        const wrapped = new ErrorClass(message, {
          rawContent: formatContent,
          line,
          column,
          helpMessage,
        });
        (wrapped as {cause?: unknown}).cause = e;
        throw wrapped;
      }
      throw e;
    }
  }

  /**
   * Decompiles structured A2UI messages back into Express notation.
   */
  decompile(messages: AgentToRendererMessage | AgentToRendererMessage[]): string {
    return this.decompiler.decompile(messages);
  }

  /**
   * Wraps raw response parts, adding format tags around A2UI payload sections.
   */
  wrap(blocks: RawResponsePart[]): string {
    return this.decompiler.wrap(blocks);
  }

  /**
   * Wraps individual decompiled A2UI Express DSL blocks within sentinel tags.
   */
  wrapDecompiledBlocks(blocks: string[]): string {
    return this.decompiler.wrapDecompiledBlocks(blocks);
  }
}

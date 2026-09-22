/**
 * @license
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

import {Parser} from '../../parser/parser.js';
import {RawResponsePart, ResponsePart} from '../../parser/response_part.js';
import {SchemaCatalog} from '../../types.js';
import {BlockLexer} from '../../parser/lexer.js';
import {ParseError} from '../../errors.js';
import {parseAndFix} from '../../parser/payload_fixer.js';
import {A2UI_OPEN_TAG, A2UI_CLOSE_TAG} from '../../parser/constants.js';
import {DirectJsonStreamProcessor} from './streaming_types.js';
import {AgentToRendererMessage} from '../../internal/web_core.js';
import {DirectJsonDecompiler} from './decompiler.js';

export class DirectJsonParser extends Parser {
  private readonly catalog: SchemaCatalog;
  private readonly streamProcessor?: DirectJsonStreamProcessor;
  private readonly lexer: BlockLexer;
  private readonly decompiler: DirectJsonDecompiler;

  constructor(catalog: SchemaCatalog, streamProcessor?: DirectJsonStreamProcessor) {
    super();
    this.catalog = catalog;
    this.streamProcessor = streamProcessor;
    this.lexer = new BlockLexer(A2UI_OPEN_TAG, A2UI_CLOSE_TAG, new Set(["'", '"']), new Set());
    this.decompiler = new DirectJsonDecompiler();
  }

  hasA2uiParts(content: string): boolean {
    const parts = this.lexer.tokenize(content);
    // An unterminated opening tag counts as false per the conformance requirement.
    return parts.some(p => p.type === 'a2ui' && p.isFinal);
  }

  unwrap(content: string): RawResponsePart[] {
    const parts = this.lexer.tokenize(content);
    let hasBlocks = false;
    const validParts: RawResponsePart[] = [];

    for (const part of parts) {
      if (part.type === 'a2ui') {
        if (!part.isFinal) {
          throw new ParseError(`A2UI close tag '${A2UI_CLOSE_TAG}' not found in response.`);
        }
        if (!part.a2uiRaw) {
          throw new ParseError('A2UI JSON part is empty.');
        }
        validParts.push(part);
        hasBlocks = true;
      } else {
        if (part.text) {
          validParts.push(part);
        }
      }
    }

    if (!hasBlocks) {
      throw new ParseError(
        `A2UI tags '${A2UI_OPEN_TAG}' and '${A2UI_CLOSE_TAG}' not found in response.`,
      );
    }

    return validParts;
  }

  compile(formatContent: string, _isFinal = true): AgentToRendererMessage[] {
    const jsonData = parseAndFix(formatContent);

    return jsonData as AgentToRendererMessage[];
  }

  parseChunk(chunk: string, _wrapped = true): ResponsePart[] {
    if (!this.streamProcessor) {
      throw new Error(
        'DirectJsonStreamProcessor is not injected. Streaming is unavailable until Phase 2B implements the healer.',
      );
    }

    return this.streamProcessor.processChunk(chunk);
  }

  decompile(a2uiPayload: AgentToRendererMessage[]): string {
    return this.decompiler.decompile(a2uiPayload);
  }

  wrap(blocks: RawResponsePart[]): string {
    return this.decompiler.wrap(blocks);
  }
}

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

import {ResponsePart, RawResponsePart} from './response_part.js';
import {AgentToRendererMessage} from '../internal/web_core.js';

/**
 * Abstract interface defining the response parser and compiler.
 */
export abstract class Parser {
  /**
   * Unwraps a raw model response string into a sequence of text and raw format blocks.
   */
  abstract unwrap(content: string): RawResponsePart[];

  /**
   * Compiles raw format content into structured A2UI messages.
   *
   * @param formatContent The raw format-content extracted from response.
   * @param isFinal Whether this format block is complete (not truncated).
   */
  abstract compile(formatContent: string, isFinal?: boolean): AgentToRendererMessage[];

  /**
   * Decompiles structured A2UI messages back into this format's raw notation.
   */
  abstract decompile(a2uiPayload: AgentToRendererMessage[]): string;

  /**
   * Wraps multiple raw blocks with the format's enclosing tags/markers.
   */
  abstract wrap(blocks: RawResponsePart[]): string;

  /**
   * Parses a complete model response string into structured parts.
   *
   * @param content The raw LLM response.
   * @param wrapped If true, unwraps sentinel tags; if false, compiles the whole content.
   */
  parseResponse(content: string, wrapped = true): ResponsePart[] {
    if (!wrapped) {
      return [{type: 'a2ui', a2ui: this.compile(content)}];
    }

    const rawParts = this.unwrap(content);
    const parts: ResponsePart[] = [];

    for (const raw of rawParts) {
      if (raw.type === 'text') {
        parts.push({type: 'text', text: raw.text});
      } else {
        parts.push({
          type: 'a2ui',
          a2ui: this.compile(raw.a2uiRaw, raw.isFinal),
        });
      }
    }

    return parts;
  }

  /**
   * Processes a streamed token chunk incrementally.
   *
   * @param chunk The next text chunk from the stream.
   * @param wrapped If true, checks for sentinel tags; if false, compiles whole chunks.
   */
  abstract parseChunk(chunk: string, wrapped?: boolean): ResponsePart[];

  /**
   * Returns whether the content contains at least one complete format block.
   */
  abstract hasA2uiParts(content: string): boolean;

  /**
   * Wraps `parseChunk` as an async generator for streaming responses.
   *
   * @param chunks An async iterable of token chunks from the model.
   * @param wrapped If true, unwrap sentinel tags; if false, parse as raw payload.
   */
  async *parseStream(
    chunks: AsyncIterable<string>,
    wrapped = true,
  ): AsyncGenerator<ResponsePart[], void, unknown> {
    for await (const chunk of chunks) {
      yield this.parseChunk(chunk, wrapped);
    }
  }
}

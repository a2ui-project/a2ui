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
 * Reading a streamed Express response chunk by chunk.
 */

import {AgentToRendererMessage} from '../../internal/web-core.js';
import {BlockLexer} from '../../parser/lexer.js';
import {ResponsePart} from '../../parser/response-part.js';
import {ResponseStream} from '../../parser/response-stream.js';
import {RendererState} from '../../utils/renderer-state.js';

/** What the stream needs from the parser that opened it. */
export interface ExpressStreamSource {
  compile(formatContent: string, isFinal?: boolean): AgentToRendererMessage[];
}

/**
 * Reads one streamed Express response, emitting text as it arrives and each block when it
 * closes.
 *
 * Text outside blocks is emitted as soon as it arrives, less a tail that could still start an
 * open tag, which is held until the next chunk settles it. A block is held until its close tag
 * arrives, then compiled whole, applied to the state and checked, and emitted as one part. The
 * statements of an open block are not applied as they arrive: that is what a streaming Express
 * compiler will add, and this reader is the step before it.
 *
 * A response read with `wrapped: false` is one block, compiled and applied when the stream
 * closes. A response that ends inside a block is compiled as far as it goes, as
 * `parseResponse` compiles a cut-off block, and the trees of the surfaces it touched are not
 * checked.
 *
 * The stream ends when `close` returns or when `feed` or `close` throws. A block is applied
 * all or nothing, so a stream that throws leaves the state holding the blocks emitted before
 * it, each of which was checked when it was emitted.
 */
export class ExpressResponseStream implements ResponseStream {
  private closed = false;
  // Text outside blocks.
  private held = '';
  private runStarted = false;
  private heldSpace = '';
  // The open block.
  private inBlock: boolean;
  private block = '';

  /**
   * @param parser The parser that opened the stream.
   * @param lexer The lexer whose tags frame the parser's blocks.
   * @param wrapped False if the whole response is one block, without tags.
   * @param state The state the stream's messages are applied to.
   */
  constructor(
    private readonly parser: ExpressStreamSource,
    private readonly lexer: BlockLexer,
    private readonly wrapped: boolean,
    readonly state: RendererState,
  ) {
    this.inBlock = !wrapped;
  }

  feed(chunk: string): ResponsePart[] {
    if (this.closed) {
      throw new Error('The response stream is closed.');
    }
    try {
      return this.read(chunk);
    } catch (e) {
      this.closed = true;
      throw e;
    }
  }

  close(): ResponsePart[] {
    if (this.closed) return [];
    this.closed = true;
    const parts: ResponsePart[] = [];
    if (this.inBlock) {
      this.finishBlock(parts, this.block, !this.wrapped);
      return parts;
    }
    if (this.held) {
      this.emitText(parts, this.held);
      this.held = '';
    }
    return parts;
  }

  private read(chunk: string): ResponsePart[] {
    const parts: ResponsePart[] = [];
    if (!this.wrapped) {
      this.block += chunk;
      return parts;
    }

    let input = this.held + chunk;
    this.held = '';
    while (input) {
      if (this.inBlock) {
        this.block += input;
        input = '';
        const close = this.lexer.findCloseTag(this.block, 0);
        if (!close) break;
        const [closeStart, closeEnd] = close;
        input = this.block.slice(closeEnd);
        this.finishBlock(parts, this.block.slice(0, closeStart), true);
        continue;
      }

      const open = this.lexer.findOpenTag(input);
      if (open) {
        this.emitText(parts, input.slice(0, open.start));
        this.runStarted = false;
        this.heldSpace = '';
        this.inBlock = true;
        this.block = '';
        input = input.slice(open.end);
        continue;
      }

      const hold = this.possibleTagStart(input);
      this.emitText(parts, input.slice(0, hold));
      this.held = input.slice(hold);
      input = '';
    }
    return parts;
  }

  /**
   * Where a tail that could still grow into an open tag starts, or the text's length if it
   * has none.
   *
   * A `<` followed by a prefix of the tag name, or by the full name and attributes not yet
   * closed by `>`, is held back; once a `>` closes a tag the lexer did not match, it is text.
   */
  private possibleTagStart(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '>') return text.length;
      if (ch !== '<') continue;
      const tail = text.slice(i);
      if (this.lexer.findOpenTag(`${tail}>`) || this.lexer.findOpenTag(`${tail} >`)) {
        return i;
      }
      // A longer tail whose name is complete but is not the tag is text, as is one that `>`
      // would not complete. Without a tag name to compare, the tail is held.
      const name = this.lexer.openTagName;
      if (name === undefined) return i;
      const prefix = name.slice(0, tail.length - 1);
      return `<${prefix}`.toLowerCase() === tail.toLowerCase() ? i : text.length;
    }
    return text.length;
  }

  private emitText(parts: ResponsePart[], text: string): void {
    const body = (this.runStarted ? text : text.trimStart()).trimEnd();
    if (!body) {
      if (this.runStarted) this.heldSpace += text;
      return;
    }
    const start = this.runStarted ? 0 : text.indexOf(body);
    parts.push({type: 'text', text: `${this.heldSpace}${body}`});
    this.heldSpace = text.slice(start + body.length);
    this.runStarted = true;
  }

  /**
   * Compiles a block, applies it to the state and emits it.
   *
   * The block is applied in a transaction with the check of the trees of the surfaces it
   * touched, so a block the state rejects leaves the state as it was.
   *
   * @param isFinal False if the response ended inside the block.
   */
  private finishBlock(parts: ResponsePart[], raw: string, isFinal: boolean): void {
    this.inBlock = false;
    this.block = '';
    const content = this.lexer.cleanBlock(raw);
    if (!content && !isFinal) return;
    const messages = this.parser.compile(content, isFinal);
    this.state.transaction(() => {
      const touched = this.state.apply(messages);
      if (isFinal) {
        this.state.checkTopology(touched);
      } else {
        // A cut-off block is missing what it would have added, so its components are not
        // held to be reachable; its dangling references are still reported by a later check.
        this.state.markChecked(touched);
      }
    });
    parts.push({type: 'a2ui', a2ui: messages});
  }
}

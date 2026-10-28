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

import {withPartialResults} from '../../errors.js';
import {A2uiError, AgentToRendererMessage} from '../../internal/web-core.js';
import {BlockLexer} from '../../parser/lexer.js';
import {ResponsePart, StreamPart} from '../../parser/response-part.js';
import {ResponseStream} from '../../parser/response-stream.js';
import {TextRun} from '../../parser/text-run.js';
import {RendererState} from '../../utils/renderer-state.js';

/** What the stream needs from the parser that opened it. */
export interface ExpressStreamSource {
  /**
   * Compiles a block, raising any failure as an `A2uiError`, as `parseResponse` does.
   */
  compile(formatContent: string, isFinal?: boolean): AgentToRendererMessage[];
}

/** How a stream is opened. */
export interface ExpressStreamOptions {
  /** False if the whole response is one block, without tags. */
  wrapped: boolean;
  /** The state the stream's messages are applied to. */
  state: RendererState;
  /** Whether the stream ends at a rejected block or reads past it. */
  afterRejectedBlock: 'end' | 'continue';
}

/** A Markdown fence line, complete, at the end of the text. */
const TRAILING_FENCE_RE = /\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?$/;
/** Text that could still grow into a trailing fence line. */
const TRAILING_FENCE_PREFIX_RE = /\s*`{1,3}[a-zA-Z0-9_-]*[ \t]*\r?\n?$/;
/** A Markdown fence line, complete, at the start of the text. */
const LEADING_FENCE_RE = /^\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|$)/;
/** Text that could still grow into a leading fence line. */
const LEADING_FENCE_PREFIX_RE = /^\s*(?:`{1,2}|```[a-zA-Z0-9_-]*[ \t]*\r?)?$/;
/** The start of a close tag that the text after the last `<` may still be. */
const CLOSE_TAG_PREFIX_RE = /^<\/?[a-zA-Z0-9-]*\s*$/;

/**
 * Reads one streamed Express response, emitting text as it arrives and each block when it
 * closes.
 *
 * Text outside blocks is emitted as soon as it arrives, less a tail that could still start an
 * open tag or a Markdown fence around one, which is held until the next chunk settles it. A
 * fence line right before an open tag or right after a close tag is dropped, as
 * `parseResponse` drops it. A block is held until its close tag arrives, then compiled whole,
 * applied to the state and checked, and emitted as one part. The statements of an open block
 * are not applied as they arrive: that is what a streaming Express compiler will add, and
 * this reader is the step before it.
 *
 * Each block is checked on its own, as the Direct JSON stream checks each message: the trees
 * of the surfaces a block touches must be complete once it is applied. A response whose
 * first block names a component a later block defines is accepted by `parseResponse`, which
 * checks the response as a whole, but is rejected by a stream.
 *
 * A block the model wrote without its open tag, which `parseResponse` recovers from the
 * close tag and a fence or payload start, is read as text by a stream, since the text before
 * the close tag has been emitted by the time the tag arrives.
 *
 * A response read with `wrapped: false` is one block, compiled and applied when the stream
 * closes. A response that ends inside a block is compiled as far as it goes, as
 * `parseResponse` compiles a cut-off block, and the trees of the surfaces it touched are not
 * checked.
 *
 * The stream ends when `close` returns or when `feed` or `close` throws. By default it throws
 * at the first rejected block; opened with `afterRejectedBlock: 'continue'`, it returns an
 * `ErrorPart` in its place and reads on. A block is applied all or nothing, so a rejected
 * block leaves the state holding the blocks emitted before it, each of which was checked when
 * it was emitted.
 *
 * @template Part The parts the stream returns. See `ResponseStream`.
 */
export class ExpressResponseStream<
  Part extends StreamPart = ResponsePart,
> implements ResponseStream<Part> {
  private readonly wrapped: boolean;
  readonly state: RendererState;
  private readonly continues: boolean;
  private closed = false;
  // Text outside blocks.
  private held = '';
  private readonly text = new TextRun();
  /** Whether a block just closed, so a fence line that follows it is dropped. */
  private afterBlock = false;
  // The open block.
  private inBlock: boolean;
  private block = '';
  /** Where the last `<` of the block is, or -1; what a close tag could still start at. */
  private lastTagStart = -1;

  /**
   * @param parser The parser that opened the stream.
   * @param lexer The lexer whose tags frame the parser's blocks.
   * @param options Whether the response is wrapped in tags, the state the stream's messages
   *     are applied to, and whether the stream reads past a rejected block.
   */
  constructor(
    private readonly parser: ExpressStreamSource,
    private readonly lexer: BlockLexer,
    {wrapped, state, afterRejectedBlock}: ExpressStreamOptions,
  ) {
    this.wrapped = wrapped;
    this.state = state;
    this.continues = afterRejectedBlock === 'continue';
    this.inBlock = !wrapped;
  }

  get isInBlock(): boolean {
    return !this.closed && this.inBlock;
  }

  feed(chunk: string): Part[] {
    if (this.closed) {
      throw new Error('The response stream is closed.');
    }
    const parts: StreamPart[] = [];
    try {
      this.read(chunk, parts);
    } catch (e) {
      this.closed = true;
      throw withPartialResults(e, parts.filter(isResponsePart));
    }
    return parts as Part[];
  }

  close(): Part[] {
    if (this.closed) return [];
    this.closed = true;
    const parts: StreamPart[] = [];
    if (this.inBlock) {
      try {
        this.finishBlock(parts, this.block, !this.wrapped);
      } catch (e) {
        throw withPartialResults(e, parts.filter(isResponsePart));
      }
      return parts as Part[];
    }
    if (this.held) {
      let rest = this.held;
      this.held = '';
      if (this.afterBlock) rest = rest.replace(LEADING_FENCE_RE, '');
      this.text.emit(parts, rest.replace(TRAILING_FENCE_RE, ''));
    }
    return parts as Part[];
  }

  private read(chunk: string, parts: StreamPart[]): void {
    if (!this.wrapped) {
      this.block += chunk;
      return;
    }

    let input = this.held + chunk;
    this.held = '';
    while (input) {
      if (this.inBlock) {
        input = this.readBlock(parts, input);
        continue;
      }

      if (this.afterBlock) {
        // A fence line right after a block is dropped. Until the text shows whether it is
        // one, it is held.
        if (LEADING_FENCE_PREFIX_RE.test(input)) {
          this.held = input;
          return;
        }
        this.afterBlock = false;
        input = input.replace(LEADING_FENCE_RE, '');
        continue;
      }

      const open = this.lexer.findOpenTag(input);
      if (open) {
        // A fence line right before the tag is dropped.
        this.text.emit(parts, input.slice(0, open.start).replace(TRAILING_FENCE_RE, ''));
        this.text.reset();
        this.inBlock = true;
        this.block = '';
        this.lastTagStart = -1;
        input = input.slice(open.end);
        continue;
      }

      const tagStart = this.possibleTagStart(input);
      // A fence before a held tag start is held with it, since it is dropped if the tag
      // follows.
      const hold = possibleFenceStart(input.slice(0, tagStart));
      this.text.emit(parts, input.slice(0, hold));
      this.held = input.slice(hold);
      input = '';
    }
  }

  /**
   * Adds `input` to the open block and finishes the block if its close tag has arrived.
   *
   * @returns The text after the close tag, or nothing if the block is still open.
   */
  private readBlock(parts: StreamPart[], input: string): string {
    const before = this.block.length;
    this.block += input;
    const tagStart = input.lastIndexOf('<');
    if (tagStart >= 0) {
      this.lastTagStart = before + tagStart;
    } else if (
      this.lastTagStart < 0 ||
      !CLOSE_TAG_PREFIX_RE.test(this.block.slice(this.lastTagStart, before))
    ) {
      // No `<` arrived, and the last one was already known not to start a close tag, so
      // this chunk cannot have completed one: the block need not be scanned again.
      return '';
    }
    const close = this.lexer.findCloseTag(this.block, 0);
    if (!close) return '';
    const [closeStart, closeEnd] = close;
    const rest = this.block.slice(closeEnd);
    this.finishBlock(parts, this.block.slice(0, closeStart), true);
    return rest;
  }

  /**
   * Where a tail that could still grow into an open tag starts, or the text's length if it
   * has none.
   *
   * A `<` followed by a prefix of the tag name, or by the full name and attributes not yet
   * closed by `>`, is held back. A `<` that neither completes nor starts the tag is text,
   * and the scan goes on to the `<` before it; once a `>` closes a tag the lexer did not
   * match, nothing before it is held.
   */
  private possibleTagStart(text: string): number {
    const name = this.lexer.openTagName;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '>') return text.length;
      if (ch !== '<') continue;
      const tail = text.slice(i);
      if (this.lexer.findOpenTag(`${tail}>`) || this.lexer.findOpenTag(`${tail} >`)) {
        return i;
      }
      // Without a tag name to compare, the tail is held.
      if (name === undefined) return i;
      if (`<${name}`.toLowerCase().startsWith(tail.toLowerCase())) return i;
    }
    return text.length;
  }

  /**
   * Compiles a block, applies it to the state and emits it.
   *
   * The block is applied in a transaction with the check of the trees of the surfaces it
   * touched, so a block the state rejects leaves the state as it was.
   *
   * @param isFinal False if the response ended inside the block.
   */
  private finishBlock(parts: StreamPart[], raw: string, isFinal: boolean): void {
    this.inBlock = false;
    this.block = '';
    this.lastTagStart = -1;
    this.afterBlock = true;
    const content = this.lexer.cleanBlock(raw);
    if (!content && !isFinal) return;
    try {
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
    } catch (e) {
      if (!this.continues || !(e instanceof A2uiError)) throw e;
      parts.push({type: 'error', error: e});
    }
  }
}

function isResponsePart(part: StreamPart): part is ResponsePart {
  return part.type !== 'error';
}

/**
 * Where a tail that could still grow into a Markdown fence line starts, or the text's length
 * if it has none. Such a tail is held back, since a fence right before an open tag is
 * dropped.
 */
function possibleFenceStart(text: string): number {
  const match = TRAILING_FENCE_PREFIX_RE.exec(text);
  return match ? match.index : text.length;
}

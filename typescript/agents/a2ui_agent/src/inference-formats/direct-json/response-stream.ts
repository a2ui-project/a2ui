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
 * Reading a streamed Direct JSON response chunk by chunk.
 */

import {ParseError} from '../../errors.js';
import {A2uiError, AgentToRendererMessage, isAtLeastVersion} from '../../internal/web-core.js';
import {ResponsePart} from '../../parser/response-part.js';
import {ResponseStream} from '../../parser/response-stream.js';
import {RendererState} from '../../utils/renderer-state.js';
import {
  CLOSE_TAG,
  cleanStart,
  matchCloseTag,
  OPEN_TAG,
  possibleTagStart,
  scanBlock,
  searchOpenTag,
} from './blocks.js';
import {readPartialMessageItems} from './json-reader.js';

/**
 * Envelope keys of the messages that a renderer applies only once, so a stream holds them
 * until their object closes: creating a surface twice fails, and a deleted surface cannot be
 * restored.
 */
const ONCE_KEYS = ['createSurface', 'deleteSurface'];

/** What the stream needs from the parser that opened it. */
export interface DirectJsonStreamSource {
  readonly catalogs: readonly {protocolVersion?: string}[];
  readonly progressiveKeys: ReadonlySet<string>;
  compile(formatContent: string): AgentToRendererMessage[];
}

/**
 * Reads one streamed Direct JSON response.
 *
 * A message is emitted, and applied to the state, as soon as it reads and the state accepts
 * it, and again each time it grows. A message that creates or deletes a surface is held
 * until its object closes. When a block closes, the messages it holds are applied in full
 * and every surface they touched is checked in full.
 *
 * The stream ends when `close` returns or when `feed` or `close` throws: the response cannot
 * be read further once part of it is rejected.
 */
export class DirectJsonResponseStream implements ResponseStream {
  private readonly v10: boolean;
  private closed = false;
  // Text outside blocks.
  private held = '';
  private runStarted = false;
  private heldSpace = '';
  // The open block.
  private inBlock: boolean;
  private block = '';
  private committed = 0;
  private readonly appliedJson: string[] = [];
  private readonly touched = new Set<string>();

  /**
   * @param parser The parser that opened the stream.
   * @param wrapped False if the whole response is one block, without tags.
   * @param state The state the stream's messages are applied to.
   */
  constructor(
    private readonly parser: DirectJsonStreamSource,
    private readonly wrapped: boolean,
    readonly state: RendererState,
  ) {
    this.v10 = isAtLeastVersion(parser.catalogs[0].protocolVersion ?? 'v1.0', '1.0');
    this.inBlock = !wrapped;
  }

  feed(chunk: string): ResponsePart[] {
    if (this.closed) {
      throw new Error('The response stream is closed.');
    }
    try {
      // A chunk may apply messages and then fail, for example in a second block, before its
      // parts are returned. The transaction undoes them, so the state holds only what was
      // emitted.
      return this.state.transaction(() => this.read(chunk));
    } catch (e) {
      this.closed = true;
      throw e;
    }
  }

  close(): ResponsePart[] {
    if (this.closed) return [];
    this.closed = true;
    const parts: ResponsePart[] = [];
    if (!this.wrapped) {
      this.finishBlock(parts, this.block);
      return parts;
    }
    if (this.inBlock) {
      throw new ParseError(
        `The response ended inside an ${OPEN_TAG} block, before its ${CLOSE_TAG} tag.`,
      );
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
      this.emitReady(parts, this.block);
      return parts;
    }

    let input = this.held + chunk;
    this.held = '';
    while (input) {
      if (this.inBlock) {
        this.block += input;
        input = '';
        const [closeStart, readableEnd] = scanBlock(this.block, 0);
        if (closeStart === undefined) {
          this.emitReady(parts, this.block.slice(0, readableEnd));
          break;
        }
        const closeEnd = matchCloseTag(this.block, closeStart)!;
        input = this.block.slice(closeEnd);
        this.finishBlock(parts, this.block.slice(0, closeStart));
        continue;
      }

      const open = searchOpenTag(input);
      if (open) {
        this.emitText(parts, input.slice(0, open.start));
        this.runStarted = false;
        this.heldSpace = '';
        this.inBlock = true;
        input = input.slice(open.end);
        continue;
      }

      const hold = possibleTagStart(input);
      this.emitText(parts, input.slice(0, hold));
      this.held = input.slice(hold);
      input = '';
    }
    return parts;
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

  /** Emits the messages of the open block that read and are accepted. */
  private emitReady(parts: ResponsePart[], block: string): void {
    const candidates = readPartialMessageItems(
      cleanStart(block),
      this.parser.progressiveKeys,
      this.v10 ? ['components'] : [],
    );
    const ready: AgentToRendererMessage[] = [];
    for (const [index, [envelope, closed]] of candidates.entries()) {
      if (index < this.committed) continue;
      if (!isObject(envelope)) break;
      // A message that creates or deletes a surface is held until its object closes rather
      // than emitted as it grows. The messages after it wait with it.
      if (!closed && ONCE_KEYS.some(key => key in envelope)) break;
      try {
        ready.push(...this.apply(index, envelope));
      } catch (e) {
        if (e instanceof A2uiError && this.raisesWhileArriving(envelope)) throw e;
        break;
      }
      if (closed) this.committed = index + 1;
    }
    if (ready.length > 0) parts.push({type: 'a2ui', a2ui: ready});
  }

  /**
   * Whether a rejected message is reported as soon as it arrives rather than held back: a
   * v1.0 `updateComponents` that names its surface and whose components have read whole.
   */
  private raisesWhileArriving(envelope: Record<string, unknown>): boolean {
    const body = envelope.updateComponents;
    return (
      this.v10 &&
      typeof envelope.version === 'string' &&
      isObject(body) &&
      typeof body.surfaceId === 'string' &&
      Array.isArray(body.components) &&
      body.components.length > 0
    );
  }

  /**
   * Applies the rest of a closed block and checks the surfaces it touched.
   *
   * `compile` only reads the block. Each message is checked when the state applies it: the
   * messages that closed while the block arrived were checked then, and `apply` checks the
   * rest here. The trees of the surfaces the block touched are checked last.
   *
   * The messages not emitted yet are emitted only if the checks pass, so a failed block
   * leaves the state holding what was emitted.
   */
  private finishBlock(parts: ResponsePart[], block: string): void {
    const messages = this.parser.compile(block);
    const ready = this.state.transaction(() => {
      const applied: AgentToRendererMessage[] = [];
      messages.forEach((envelope, index) => {
        if (index >= this.committed) applied.push(...this.apply(index, envelope));
      });
      this.state.checkTopology(this.touched);
      return applied;
    });
    if (ready.length > 0) parts.push({type: 'a2ui', a2ui: ready});
    this.inBlock = false;
    this.block = '';
    this.committed = 0;
    this.appliedJson.length = 0;
    this.touched.clear();
  }

  /**
   * Applies the message at an index of the block if it changed.
   *
   * A newer version of a message holds everything the older one did, since components are
   * replaced by id and a data model path is overwritten, so applying it over the older one is
   * an update.
   *
   * @returns The message, if the renderer has not received it as it now stands.
   */
  private apply(index: number, envelope: unknown): AgentToRendererMessage[] {
    const encoded = stableStringify(envelope);
    if (index < this.appliedJson.length && this.appliedJson[index] === encoded) return [];
    for (const surfaceId of this.state.apply([envelope])) {
      this.touched.add(surfaceId);
    }
    if (index < this.appliedJson.length) {
      this.appliedJson[index] = encoded;
    } else {
      this.appliedJson.push(encoded);
    }
    return [envelope as AgentToRendererMessage];
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Encodes a JSON value with its object keys sorted, so equal values encode the same. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (!isObject(val)) return val;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(val).sort()) {
      Object.defineProperty(sorted, key, {value: val[key], enumerable: true});
    }
    return sorted;
  });
}

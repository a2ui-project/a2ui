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

import {ParseError, withPartialResults} from '../../errors.js';
import {
  A2uiError,
  A2uiIntegrityError,
  AgentToRendererMessage,
  isAtLeastVersion,
  validateRecursionAndPaths,
} from '../../internal/web-core.js';
import {ResponsePart, StreamPart} from '../../parser/response-part.js';
import {ResponseStream} from '../../parser/response-stream.js';
import {RendererState} from '../../utils/renderer-state.js';
import {
  BlockScanner,
  CLOSE_TAG,
  matchCloseTag,
  OPEN_TAG,
  payloadStart,
  possibleTagStart,
  searchOpenTag,
  trailingFenceStart,
} from './blocks.js';
import {PartialReadCache, readPartialMessages} from './json-reader.js';

/**
 * Envelope keys of the messages a renderer applies again as they grow, so a stream emits them
 * before their object closes. Any other message is applied once, so it is held until it
 * closes: creating a surface twice fails, a deleted surface cannot be restored, and a
 * function runs each time it is called.
 */
const GROWING_KEYS = ['updateComponents', 'updateDataModel'];

/** How deep the value of an `updateDataModel` sits in its message: envelope, body, value. */
const VALUE_DEPTH = 2;

/** What the stream needs from the parser that opened it. */
export interface DirectJsonStreamSource {
  readonly catalogs: readonly {protocolVersion?: string}[];
  readonly progressiveKeys: ReadonlySet<string>;
  compile(formatContent: string): AgentToRendererMessage[];
}

/** How a stream is opened. */
export interface DirectJsonStreamOptions {
  /** False if the whole response is one block, without tags. */
  wrapped: boolean;
  /** The state the stream's messages are applied to. */
  state: RendererState;
  /** Whether the stream ends at a rejected block or reads past it. */
  afterRejectedBlock: 'end' | 'continue';
}

/**
 * The message at the end of what has arrived of a block, while it grows, as far as it has
 * been applied and emitted.
 */
type Growing =
  | {
      readonly kind: 'components';
      readonly index: number;
      /** The JSON of the message less its components. */
      readonly rest: string;
      /** How many of its components have been applied. */
      count: number;
      /** The JSON and id of the last component applied, which may still grow in v0.9. */
      lastJson: string | undefined;
      lastId: unknown;
      /** The ids of the components applied. */
      readonly ids: Set<unknown>;
    }
  | {
      readonly kind: 'dataModel';
      readonly index: number;
      /** The JSON of the message less its value. */
      readonly rest: string;
      /** The value last emitted. */
      value: unknown;
    }
  | {
      readonly kind: 'other';
      readonly index: number;
      /** The JSON of the message last emitted, with its keys sorted. */
      readonly json: string;
    };

/**
 * Reads one streamed Direct JSON response.
 *
 * A message is emitted, and applied to the state, as soon as it reads and the state accepts
 * it, and again each time it grows. Only `updateComponents` and `updateDataModel` are emitted
 * while they grow; any other message is held until its object closes, and the messages after
 * it wait with it. When a block closes, the messages it holds are applied in full and every
 * surface they touched is checked in full.
 *
 * Each chunk is read once. The scan for the close tag and the read of the open block go on
 * where the previous chunk left them, a message that has closed is not read or checked
 * again, and a message that grows is checked for what it gains: an `updateComponents` for
 * the components it adds, and an `updateDataModel` for the lists and maps its value gains.
 * An `updateDataModel` is applied when it first reads and again once it closes. A closed
 * message the state rejects fails the same way on every later chunk, so nothing after it is
 * emitted, and the block throws when it closes.
 *
 * The stream ends when `close` returns or when `feed` or `close` throws. By default it throws
 * at the first rejected block; opened with `afterRejectedBlock: 'continue'`, it returns an
 * `ErrorPart` in its place, skips the rest of the block, and reads on. Either way the messages
 * the block emitted stay in the state, since the renderer holds them, and the components they
 * added are marked checked (`RendererState.markChecked`), so a later turn on the surface is
 * not required to make them reachable.
 *
 * @template Part The parts the stream returns. See `ResponseStream`.
 */
export class DirectJsonResponseStream<
  Part extends StreamPart = ResponsePart,
> implements ResponseStream<Part> {
  private readonly v10: boolean;
  private readonly wrapped: boolean;
  readonly state: RendererState;
  private readonly continues: boolean;
  private closed = false;
  // Text outside blocks.
  private held = '';
  private runStarted = false;
  private heldSpace = '';
  private heldBackticks = '';
  private stripCloseBackticks = false;
  // The open block.
  private inBlock: boolean;
  /** Whether the open block was rejected, so the rest of it is skipped. */
  private rejected = false;
  private block = '';
  private scanner = new BlockScanner(0);
  private readCache = new PartialReadCache();
  private readStart: number | undefined;
  /** The messages of the block whose objects have closed, in order. */
  private closedMessages: unknown[] = [];
  /** How many of `closedMessages` have been applied and emitted. */
  private committed = 0;
  /** Whether the closed message after the committed ones was rejected. */
  private stalled = false;
  private growing: Growing | undefined;
  private readonly touched = new Set<string>();

  /**
   * @param parser The parser that opened the stream.
   * @param options Whether the response is wrapped in tags, the state the stream's messages
   *     are applied to, and whether the stream reads past a rejected block.
   */
  constructor(
    private readonly parser: DirectJsonStreamSource,
    {wrapped, state, afterRejectedBlock}: DirectJsonStreamOptions,
  ) {
    this.v10 = isAtLeastVersion(parser.catalogs[0].protocolVersion ?? '1.0', '1.0');
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
      this.fail();
      throw withPartialResults(e, parts.filter(isResponsePart));
    }
    // Only a stream that reads past rejected blocks, whose parts are `StreamPart`s, returns an
    // `ErrorPart`.
    return parts as Part[];
  }

  close(): Part[] {
    return this.end() as Part[];
  }

  private end(): StreamPart[] {
    if (this.closed) return [];
    this.closed = true;
    const parts: StreamPart[] = [];
    try {
      if (!this.wrapped) {
        if (!this.rejected) this.readBlock(parts, () => this.finishBlock(parts, this.block));
        return parts;
      }
      if (this.inBlock) {
        if (!this.rejected) {
          this.readBlock(parts, () => {
            throw new ParseError(
              `The response ended inside an ${OPEN_TAG} block, before its ${CLOSE_TAG} tag.`,
            );
          });
        }
        return parts;
      }
    } catch (e) {
      this.fail();
      throw withPartialResults(e, parts.filter(isResponsePart));
    }
    if (this.heldBackticks) {
      this.emitText(parts, this.heldBackticks);
      this.heldBackticks = '';
    } else if (this.held) {
      this.emitText(parts, this.held);
      this.held = '';
    }
    return parts;
  }

  /**
   * Ends the stream after a failure, keeping what it emitted.
   *
   * The renderer holds the messages already emitted, and so does the state. No message
   * removes a component, so the components they added are marked checked: a later turn is
   * not required to make them reachable.
   */
  private fail(): void {
    this.closed = true;
    this.state.markChecked(this.touched);
  }

  /**
   * Runs a step that reads the open block. If the block is rejected and the stream reads past
   * rejected blocks, returns an `ErrorPart` for it and skips the rest of it; otherwise the
   * error propagates.
   */
  private readBlock(parts: StreamPart[], step: () => void): void {
    try {
      step();
    } catch (e) {
      if (!this.continues || !(e instanceof A2uiError)) throw e;
      parts.push({type: 'error', error: e});
      this.state.markChecked(this.touched);
      this.rejected = true;
    }
  }

  private read(chunk: string, parts: StreamPart[]): void {
    if (!this.wrapped) {
      this.block += chunk;
      if (!this.rejected) this.readBlock(parts, () => this.emitReady(parts, this.block.length));
      return;
    }

    let input = this.held + chunk;
    this.held = '';
    if (this.stripCloseBackticks) {
      if (input.startsWith('`')) {
        input = input.replace(/^`+/, '');
      }
      if (input.length > 0) {
        this.stripCloseBackticks = false;
      }
    }
    if (!this.inBlock && this.heldBackticks.length > 0) {
      if (input.length > 0) {
        const isOpenTag =
          searchOpenTag(input)?.start === 0 ||
          (input.startsWith('<') && OPEN_TAG.toLowerCase().startsWith(input.toLowerCase()));
        if (isOpenTag) {
          this.heldBackticks = '';
        } else {
          input = `${this.heldBackticks}${input}`;
          this.heldBackticks = '';
        }
      }
    }
    while (input) {
      if (this.inBlock) {
        this.block += input;
        input = '';
        const [closeStart, readableEnd] = this.scanner.scan(this.block);
        if (closeStart === undefined) {
          if (!this.rejected) this.readBlock(parts, () => this.emitReady(parts, readableEnd));
          break;
        }
        const closeEnd = matchCloseTag(this.block, closeStart)!;
        input = this.block.slice(closeEnd);
        if (input.startsWith('`')) {
          input = input.replace(/^`+/, '');
        } else if (!input) {
          this.stripCloseBackticks = true;
        }
        const body = this.block.slice(0, closeStart);
        if (!this.rejected) this.readBlock(parts, () => this.finishBlock(parts, body));
        this.resetBlock();
        continue;
      }

      const open = searchOpenTag(input);
      if (open) {
        let textBefore = input.slice(0, open.start);
        if (textBefore.endsWith('`')) {
          textBefore = textBefore.replace(/`+$/, '');
        }
        this.emitText(parts, textBefore);
        this.runStarted = false;
        this.heldSpace = '';
        this.heldBackticks = '';
        this.inBlock = true;
        input = input.slice(open.end);
        continue;
      }

      let hold = possibleTagStart(input);
      if (hold < input.length) {
        while (hold > 0 && input.charCodeAt(hold - 1) === 0x60) {
          hold--;
        }
      }
      let textToEmit = input.slice(0, hold);
      this.held = input.slice(hold);
      input = '';
      if (!this.held) {
        const ticksMatch = textToEmit.match(/`+$/);
        if (ticksMatch) {
          this.heldBackticks = ticksMatch[0];
          textToEmit = textToEmit.slice(0, textToEmit.length - this.heldBackticks.length);
        }
      }
      this.emitText(parts, textToEmit);
    }
  }

  private emitText(parts: StreamPart[], text: string): void {
    const body = (this.runStarted ? text : text.trimStart()).trimEnd();
    if (!body) {
      if (this.runStarted && !body) this.heldSpace += text;
      return;
    }
    const start = this.runStarted ? 0 : text.indexOf(body);
    parts.push({type: 'text', text: `${this.heldSpace}${body}`});
    this.heldSpace = text.slice(start + body.length);
    this.runStarted = true;
  }

  /**
   * Emits the messages of the open block that read and are accepted.
   *
   * @param end Where the part of the block that can be read ends.
   */
  private emitReady(parts: StreamPart[], end: number): void {
    const start = payloadStart(this.block, end);
    if (start === undefined) return;
    // The block only grows, so what earlier reads found holds while the payload starts at
    // the same place.
    if (start !== this.readStart) {
      this.readStart = start;
      this.readCache = new PartialReadCache();
    }
    const read = readPartialMessages(this.block, this.parser.progressiveKeys, {
      wholeItemKeys: this.v10 ? ['components'] : [],
      cache: this.readCache,
      start,
      end: trailingFenceStart(this.block, start, end),
    });
    let open: unknown;
    for (const [offset, [envelope, closed]] of read.messages.entries()) {
      const index = read.skipped + offset;
      if (index !== this.closedMessages.length) continue;
      if (closed) {
        this.closedMessages.push(envelope);
      } else {
        open = envelope;
      }
    }
    if (this.stalled) return;

    const ready: AgentToRendererMessage[] = [];
    // The messages applied before a rejected one are emitted with the error, since the state
    // holds them.
    try {
      while (this.committed < this.closedMessages.length) {
        const envelope = this.closedMessages[this.committed];
        try {
          ready.push(...this.applyMessage(this.committed, envelope, true));
        } catch (e) {
          if (e instanceof A2uiError && this.raisesWhileArriving(envelope)) throw e;
          this.stalled = true;
          break;
        }
        this.committed += 1;
      }
      if (!this.stalled && isObject(open) && GROWING_KEYS.some(key => key in open)) {
        try {
          ready.push(...this.applyMessage(this.committed, open, false));
        } catch (e) {
          // Held back, and checked again as it grows.
          if (e instanceof A2uiError && this.raisesWhileArriving(open)) throw e;
        }
      }
    } finally {
      if (ready.length > 0) parts.push({type: 'a2ui', a2ui: ready});
    }
  }

  /**
   * Whether a rejected message is reported as soon as it arrives rather than held back: a
   * v1.0 `updateComponents` that names its surface and whose components have read whole.
   */
  private raisesWhileArriving(envelope: unknown): boolean {
    if (!isObject(envelope)) return false;
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
   * messages that closed while the block arrived were checked then, and the rest are checked
   * here. The trees of the surfaces the block touched are checked last.
   *
   * The messages not emitted yet are emitted only if the checks pass, so a failed block
   * leaves the state holding what was emitted.
   */
  private finishBlock(parts: StreamPart[], block: string): void {
    const messages = this.parser.compile(block);
    const ready = this.state.transaction(() => {
      const applied: AgentToRendererMessage[] = [];
      messages.forEach((envelope, index) => {
        if (index >= this.committed) applied.push(...this.applyMessage(index, envelope, true));
      });
      this.state.checkTopology(this.touched);
      return applied;
    });
    if (ready.length > 0) parts.push({type: 'a2ui', a2ui: ready});
  }

  /** Forgets the block that closed, whether it was read or rejected. */
  private resetBlock(): void {
    this.inBlock = false;
    this.rejected = false;
    this.block = '';
    this.scanner = new BlockScanner(0);
    this.readCache = new PartialReadCache();
    this.readStart = undefined;
    this.closedMessages = [];
    this.committed = 0;
    this.stalled = false;
    this.growing = undefined;
    this.touched.clear();
  }

  /**
   * Applies the message at an index of the block, as far as the state does not hold it yet.
   *
   * A message seen for the first time is applied whole. A message that grew since the last
   * chunk is checked for what it gained, since applying that over what was applied before
   * leaves the state as applying the whole message would: components are replaced by id. An
   * `updateDataModel` is applied whole again once it closes.
   *
   * @param closed Whether the message's object has closed.
   * @returns The message, if the renderer has not received it as it now stands.
   */
  private applyMessage(
    index: number,
    envelope: unknown,
    closed: boolean,
  ): AgentToRendererMessage[] {
    const growing = this.growing?.index === index ? this.growing : undefined;
    let emit: boolean;
    if (
      growing?.kind === 'components' &&
      restOf(envelope, 'updateComponents', 'components') === growing.rest
    ) {
      emit = this.applyAddedComponents(growing, envelope as Record<string, unknown>);
    } else if (
      growing?.kind === 'dataModel' &&
      restOf(envelope, 'updateDataModel', 'value') === growing.rest
    ) {
      emit = this.checkGrownValue(growing, envelope as Record<string, unknown>, closed);
    } else if (growing?.kind === 'other' && !closed && stableStringify(envelope) === growing.json) {
      emit = false;
    } else {
      this.applyWhole(envelope);
      this.growing = closed ? undefined : growingOf(index, envelope);
      return [envelope as AgentToRendererMessage];
    }
    if (closed) this.growing = undefined;
    return emit ? [envelope as AgentToRendererMessage] : [];
  }

  /**
   * Applies the components an `updateComponents` gained since it was last applied, and the
   * last one applied before if it has grown since.
   *
   * The state sees only those components as a batch, so it would take an id repeated from an
   * earlier batch of the same message for an update; such an id is rejected here, as the
   * state rejects one repeated within a batch.
   *
   * @returns Whether the message changed.
   */
  private applyAddedComponents(
    growing: Extract<Growing, {kind: 'components'}>,
    envelope: Record<string, unknown>,
  ): boolean {
    const body = envelope.updateComponents as Record<string, unknown>;
    const components = body.components as unknown[];
    let kept = growing.count;
    if (components.length < kept) kept = 0;
    if (kept > 0 && JSON.stringify(components[kept - 1]) !== growing.lastJson) kept -= 1;
    if (kept === components.length) return false;
    const added = components.slice(kept);
    // The ids the components before the re-read ones hold.
    const rereadLast = kept === growing.count - 1;
    const earlier = (id: unknown) =>
      kept > 0 && growing.ids.has(id) && !(rereadLast && id === growing.lastId);
    const seen = new Set<unknown>();
    for (const component of added) {
      const id = isObject(component) ? component.id : undefined;
      if (typeof id !== 'string') continue;
      if (earlier(id) || seen.has(id)) {
        throw new A2uiIntegrityError(`Duplicate component ID: '${id}'`, [id]);
      }
      seen.add(id);
    }
    this.applyWhole({...envelope, updateComponents: {...body, components: added}});
    if (kept === 0) growing.ids.clear();
    if (rereadLast) growing.ids.delete(growing.lastId);
    for (const id of seen) growing.ids.add(id);
    const last = components[components.length - 1];
    growing.count = components.length;
    growing.lastJson = JSON.stringify(last);
    growing.lastId = isObject(last) ? last.id : undefined;
    return true;
  }

  /**
   * Checks what the value of an `updateDataModel` gained since it was last emitted, or
   * applies it whole once it has closed.
   *
   * Of what the state checks, only the depth of the value and the paths it binds depend on
   * the value, so only the lists and maps it gained are checked while it grows.
   *
   * @returns Whether the message changed.
   */
  private checkGrownValue(
    growing: Extract<Growing, {kind: 'dataModel'}>,
    envelope: Record<string, unknown>,
    closed: boolean,
  ): boolean {
    const value = (envelope.updateDataModel as Record<string, unknown>).value;
    const changed = !sameJson(value, growing.value);
    if (closed) {
      this.applyWhole(envelope);
    } else if (changed) {
      checkGained(value, growing.value, VALUE_DEPTH);
      growing.value = value;
    }
    return changed;
  }

  private applyWhole(envelope: unknown): void {
    for (const surfaceId of this.state.apply([envelope])) {
      this.touched.add(surfaceId);
    }
  }
}

function isResponsePart(part: StreamPart): part is ResponsePart {
  return part.type !== 'error';
}

/** What the stream keeps of a message it applied whole while it grows. */
function growingOf(index: number, envelope: unknown): Growing {
  if (isObject(envelope)) {
    const components = isObject(envelope.updateComponents)
      ? envelope.updateComponents.components
      : undefined;
    if (Array.isArray(components)) {
      const last: unknown = components[components.length - 1];
      return {
        kind: 'components',
        index,
        rest: restOf(envelope, 'updateComponents', 'components')!,
        count: components.length,
        lastJson: components.length > 0 ? JSON.stringify(last) : undefined,
        lastId: isObject(last) ? last.id : undefined,
        ids: new Set(components.map(c => (isObject(c) ? c.id : undefined))),
      };
    }
    const dataModel = envelope.updateDataModel;
    if (isObject(dataModel) && 'value' in dataModel) {
      return {
        kind: 'dataModel',
        index,
        rest: restOf(envelope, 'updateDataModel', 'value')!,
        value: dataModel.value,
      };
    }
  }
  return {kind: 'other', index, json: stableStringify(envelope)};
}

/**
 * The JSON of a message less the field it grows by, or undefined if it is not a message of
 * that action with that field.
 */
function restOf(envelope: unknown, action: string, field: string): string | undefined {
  if (!isObject(envelope)) return undefined;
  const body = envelope[action];
  if (!isObject(body) || !(field in body)) return undefined;
  const rest: Record<string, unknown> = {...body};
  delete rest[field];
  return JSON.stringify({...envelope, [action]: rest});
}

/**
 * Checks the lists and maps a value gained over the one before it, at a depth of the
 * message, for what the state checks of a value: its depth and the paths it binds.
 *
 * A list or map that closed reads as the same object on every chunk, so it is skipped
 * without being read.
 */
function checkGained(value: unknown, previous: unknown, depth: number): void {
  if (value === previous) return;
  if (Array.isArray(value) && Array.isArray(previous)) {
    value.forEach((item, i) => checkGained(item, previous[i], depth + 1));
    return;
  }
  if (isObject(value) && isObject(previous)) {
    const paths: Record<string, unknown> = {};
    for (const key of ['path', '@path']) {
      if (value[key] !== previous[key]) paths[key] = value[key];
    }
    if (Object.keys(paths).length > 0) validateAt(paths, depth);
    for (const key of Object.keys(value)) {
      if (key !== 'path' && key !== '@path') checkGained(value[key], previous[key], depth + 1);
    }
    return;
  }
  validateAt(value, depth);
}

/** Checks a value as the state checks the part of a message at a depth of it. */
function validateAt(value: unknown, depth: number): void {
  let wrapped = value;
  for (let i = 0; i < depth; i++) wrapped = [wrapped];
  validateRecursionAndPaths(wrapped);
}

/**
 * Whether two JSON values are the same. A list or map that is the same object in both, as a
 * read through the cache returns one that closed, is not read.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]))
    );
  }
  return false;
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

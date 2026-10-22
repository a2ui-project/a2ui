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
 * Reads the JSON a model writes, which is often almost JSON.
 *
 * Both readers accept what a model commonly gets wrong and a strict decoder rejects: a
 * trailing comma before `]` or `}`, and a raw line break or tab inside a string. When the
 * text does not read as it is, they read it again with curly quotes straightened, so a curly
 * quote inside a string that is otherwise valid JSON is kept.
 */

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const HEX_RE = /^[0-9a-fA-F]{4}$/;
// Values that are never healed while they arrive: a cut URL is a different, usually broken,
// address rather than a shorter version of the same text.
const URL_PREFIXES = ['http://', 'https://', 'data:'];

/** A JSON value the reader produced. */
export type JsonValue = unknown;

/** Thrown when the text is not JSON. */
export class JsonReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonReadError';
  }
}

/**
 * Reads the complete JSON document `text`.
 *
 * @throws {JsonReadError} If `text` is not a single JSON value.
 */
export function readJson(text: string): JsonValue {
  try {
    return new Reader(text, undefined).document();
  } catch (e) {
    const straight = straightenQuotes(text);
    if (straight === text) throw e;
    return new Reader(straight, undefined).document();
  }
}

/** What one read of a block still arriving found. */
export interface PartialRead {
  /**
   * How many messages before `messages` had closed on an earlier read through the same
   * cache. They are not read again, so they are not in `messages`.
   */
  readonly skipped: number;
  /**
   * One `[envelope, closed]` pair per message read, in order. `closed` is false when the
   * message's text was still arriving and the reader healed it; only the last can be.
   */
  readonly messages: Array<[JsonValue, boolean]>;
}

/** Options for `readPartialMessages`. */
export interface PartialReadOptions {
  /** Keys whose array items are read only once each item is whole. */
  wholeItemKeys?: Iterable<string>;
  /**
   * What earlier reads of the same text found, so a read goes on where they stopped. The
   * text must only have grown since, and be read from the same `start`.
   */
  cache?: PartialReadCache;
  /** Where the payload starts in `text`. Defaults to 0. */
  start?: number;
  /** Where the part of `text` that can be read ends. Defaults to its length. */
  end?: number;
}

/**
 * What the reads of a block still arriving keep from one chunk to the next.
 *
 * The block only grows, so a list or map that closed reads the same on every later chunk,
 * and so do the items of a list still open, up to the last one that closed. A read through
 * the cache takes those from it rather than reading their text again, so reading every chunk
 * of a block reads each character about once.
 */
export class PartialReadCache {
  /** The state of the reads of the text as it is. */
  readonly plain = new ReadState();
  /** The state of the reads of the text with curly quotes straightened, at the same offsets. */
  readonly straight = new ReadState();
}

class ReadState {
  /** Each list or map that closed, by the offset of its opening bracket, with the offset after its closing one. */
  readonly closed = new Map<number, [unknown, number]>();
  /** Each list still open, by the offset of its opening bracket, with the items that closed and the offset after the last of them. */
  readonly open = new Map<number, [unknown[], number]>();
  /** For a payload written as a list of messages, how many messages closed, and the offset after the last of them. */
  messages: [number, number] | undefined;
}

/**
 * Reads a partial JSON array or object into candidate envelopes.
 *
 * @param text The text of a block that may still be arriving.
 * @param progressiveKeys Keys whose string values are closed where they stand while they
 *     arrive.
 * @param options What to read and what earlier reads found.
 * @returns The messages read, after those earlier reads saw close. When the text is not
 *     JSON, no messages.
 */
export function readPartialMessages(
  text: string,
  progressiveKeys: Iterable<string>,
  {wholeItemKeys = [], cache, start = 0, end}: PartialReadOptions = {},
): PartialRead {
  const progressive = new Set(progressiveKeys);
  const whole = new Set(wholeItemKeys);
  const read = (input: string, state: ReadState | undefined) =>
    new Reader(input, progressive, whole, state, start, end).messageItems();
  try {
    return read(text, cache?.plain);
  } catch (e) {
    if (!(e instanceof JsonReadError)) throw e;
    const straight = straightenQuotes(text);
    if (straight === text) return {skipped: 0, messages: []};
    try {
      return read(straight, cache?.straight);
    } catch (e2) {
      if (!(e2 instanceof JsonReadError)) throw e2;
      return {skipped: 0, messages: []};
    }
  }
}

function straightenQuotes(text: string): string {
  return text
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'");
}

/** Thrown where the text ends before a value that cannot be healed. */
class Unfinished extends Error {}

/** Recursive-descent JSON and partial-JSON reader. */
class Reader {
  private i: number;
  private readonly limit: number;
  private cut = false;

  /**
   * @param text The text to read.
   * @param progressiveKeys The keys whose string value may be closed early, or undefined when
   *     `text` must be complete.
   * @param wholeItemKeys The keys whose list value holds only the items that have closed.
   * @param state What earlier reads of `text` found, or undefined.
   * @param start Where to start reading.
   * @param end Where the part of `text` to read ends.
   */
  constructor(
    private readonly text: string,
    private readonly progressiveKeys: ReadonlySet<string> | undefined,
    private readonly wholeItemKeys: ReadonlySet<string> = new Set(),
    private readonly state?: ReadState,
    start = 0,
    end?: number,
  ) {
    this.i = start;
    this.limit = end ?? text.length;
  }

  private get partial(): boolean {
    return this.progressiveKeys !== undefined;
  }

  private get atEnd(): boolean {
    return this.i >= this.limit;
  }

  document(): JsonValue {
    this.skipSpace();
    const value = this.value(false);
    this.skipSpace();
    if (!this.atEnd) this.fail('unexpected text after the JSON value');
    return value;
  }

  messageItems(): PartialRead {
    this.skipSpace();
    if (this.atEnd) return {skipped: 0, messages: []};
    if (this.text[this.i] !== '[') {
      try {
        const message = this.message();
        this.skipSpace();
        if (!this.atEnd) this.fail('unexpected text after the JSON value');
        return {skipped: 0, messages: [message]};
      } catch (e) {
        if (e instanceof Unfinished) return {skipped: 0, messages: []};
        throw e;
      }
    }
    this.i += 1;
    // How many messages closed, and where the text after the last of them starts, for the
    // next read to go on from.
    let skipped = 0;
    let closedCount = 0;
    let resume = this.i;
    let afterItem = false;
    if (this.state?.messages) {
      [closedCount, resume] = this.state.messages;
      skipped = closedCount;
      this.i = resume;
      afterItem = closedCount > 0;
    }
    const messages: Array<[JsonValue, boolean]> = [];
    const soFar = (): PartialRead => {
      if (this.state) this.state.messages = [closedCount, resume];
      return {skipped, messages};
    };
    for (;;) {
      if (afterItem) {
        this.skipSpace();
        if (this.atEnd) return soFar();
        if (this.text[this.i] === ',') {
          this.i += 1;
        } else if (this.text[this.i] !== ']') {
          this.fail("expected ',' or ']'");
        }
      }
      afterItem = true;
      this.skipSpace();
      if (this.atEnd) return soFar();
      if (this.text[this.i] === ']') {
        this.i += 1;
        this.skipSpace();
        if (!this.atEnd) this.fail('unexpected text after the JSON value');
        return {skipped, messages};
      }
      let message: [JsonValue, boolean];
      try {
        message = this.message();
      } catch (e) {
        if (e instanceof Unfinished) return soFar();
        throw e;
      }
      messages.push(message);
      if (message[1]) {
        closedCount = skipped + messages.length;
        resume = this.i;
      }
    }
  }

  /** Reads one message, noting whether the text closed it or it was healed. */
  private message(): [JsonValue, boolean] {
    this.cut = false;
    const message = this.value(false);
    return [message, !this.cut];
  }

  private value(healable: boolean): JsonValue {
    if (this.atEnd) this.end();
    const c = this.text[this.i];
    if (c === '{') return this.closedOr(() => this.object());
    if (c === '[') return this.closedOr(() => this.array(false));
    if (c === '"') return this.string(healable);
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    const words: Array<[string, unknown]> = [
      ['true', true],
      ['false', false],
      ['null', null],
    ];
    for (const [word, val] of words) {
      if (this.i + word.length <= this.limit && this.text.startsWith(word, this.i)) {
        this.i += word.length;
        return val;
      }
      if (this.partial && word.startsWith(this.text.slice(this.i, this.limit))) {
        this.end();
      }
    }
    return this.fail(`unexpected character '${c}'`);
  }

  /**
   * Reads a list or map through `read`, unless an earlier read saw the one that starts here
   * close, and keeps it if it closes.
   */
  private closedOr<T>(read: () => T): T {
    const closed = this.state?.closed;
    if (!closed) return read();
    const start = this.i;
    const known = closed.get(start);
    if (known) {
      this.i = known[1];
      return known[0] as T;
    }
    const cutBefore = this.cut;
    this.cut = false;
    const value = read();
    if (!this.cut) closed.set(start, [value, this.i]);
    this.cut = cutBefore || this.cut;
    return value;
  }

  private object(): Record<string, unknown> {
    this.i += 1;
    const obj: Record<string, unknown> = {};
    for (;;) {
      this.skipSpace();
      if (this.atEnd) return this.healed(obj);
      if (this.text[this.i] === '}') {
        this.i += 1;
        return obj;
      }
      if (this.text[this.i] !== '"') this.fail('expected a key');
      const key = this.string(false);
      this.skipSpace();
      if (this.atEnd) this.end();
      if (this.text[this.i] !== ':') this.fail(`expected ':' after key '${key}'`);
      this.i += 1;
      this.skipSpace();
      let value: unknown;
      if (!this.atEnd && this.text[this.i] === '[' && this.partial && this.wholeItemKeys.has(key)) {
        value = this.closedOr(() => this.array(true));
      } else {
        value = this.value(this.progressiveKeys?.has(key) ?? false);
      }
      // Defined as an own property, so a key such as `__proto__` stays plain data.
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipSpace();
      if (this.atEnd) return this.healed(obj);
      if (this.text[this.i] === ',') {
        this.i += 1;
      } else if (this.text[this.i] !== '}') {
        this.fail("expected ',' or '}'");
      }
    }
  }

  /**
   * Reads a list. When `wholeItems` is true, an item the text ends in is left out rather than
   * healed. A list still open goes on after the items an earlier read saw close.
   */
  private array(wholeItems: boolean): unknown[] {
    const start = this.i;
    this.i += 1;
    let arr: unknown[] = [];
    // How many items closed, and where the text after the last of them starts.
    let closedItems = 0;
    let resume = this.i;
    let afterItem = false;
    const known = this.state?.open.get(start);
    if (known) {
      arr = [...known[0]];
      closedItems = arr.length;
      resume = this.i = known[1];
      afterItem = closedItems > 0;
    }
    const healed = (): unknown[] => {
      this.state?.open.set(start, [
        closedItems === arr.length ? arr : arr.slice(0, closedItems),
        resume,
      ]);
      return this.healed(arr);
    };
    for (;;) {
      if (afterItem) {
        this.skipSpace();
        if (this.atEnd) return healed();
        if (this.text[this.i] === ',') {
          this.i += 1;
        } else if (this.text[this.i] !== ']') {
          this.fail("expected ',' or ']'");
        }
      }
      afterItem = true;
      this.skipSpace();
      if (this.atEnd) return healed();
      if (this.text[this.i] === ']') {
        this.i += 1;
        this.state?.open.delete(start);
        return arr;
      }
      const cutBefore = this.cut;
      this.cut = false;
      let item: unknown;
      if (wholeItems) {
        try {
          item = this.value(false);
        } catch (e) {
          if (e instanceof Unfinished) return healed();
          throw e;
        }
        if (this.cut) return healed();
      } else {
        item = this.value(false);
      }
      arr.push(item);
      // An item closed early ends the text, so the list closes early too.
      if (this.cut) continue;
      this.cut = cutBefore;
      closedItems = arr.length;
      resume = this.i;
    }
  }

  private healed<T>(value: T): T {
    if (!this.partial) this.end();
    this.cut = true;
    return value;
  }

  private string(healable: boolean): string {
    this.i += 1;
    let buf = '';
    const text = this.text;
    const n = this.limit;
    while (!this.atEnd) {
      const c = text[this.i];
      if (c === '"') {
        this.i += 1;
        return buf;
      }
      if (c !== '\\') {
        buf += c;
        this.i += 1;
        continue;
      }
      if (this.i + 1 >= n) {
        this.i = n;
        break;
      }
      const escaped = text[this.i + 1];
      if (escaped === '"' || escaped === '\\' || escaped === '/') {
        buf += escaped;
      } else if (escaped === 'b') {
        buf += '\b';
      } else if (escaped === 'f') {
        buf += '\f';
      } else if (escaped === 'n') {
        buf += '\n';
      } else if (escaped === 'r') {
        buf += '\r';
      } else if (escaped === 't') {
        buf += '\t';
      } else if (escaped === 'u') {
        if (this.i + 6 > n) {
          this.i = n;
          continue;
        }
        let code = this.hex(text.slice(this.i + 2, this.i + 6));
        if (code >= 0xd800 && code <= 0xdbff) {
          if (this.i + 12 > n) {
            const rest = text.slice(this.i + 6, n);
            if (
              this.partial &&
              (rest === '\\u'.slice(0, n - (this.i + 6)) ||
                (this.i + 8 <= n && text.slice(this.i + 6, this.i + 8) === '\\u'))
            ) {
              this.i = n;
              continue;
            }
          }
          if (this.i + 12 <= n && text.slice(this.i + 6, this.i + 8) === '\\u') {
            const low = this.hex(text.slice(this.i + 8, this.i + 12));
            if (low >= 0xdc00 && low <= 0xdfff) {
              code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
              this.i += 6;
            }
          }
        }
        buf += String.fromCodePoint(code);
        this.i += 4;
      } else {
        this.fail(`invalid escape '\\${escaped}'`);
      }
      this.i += 2;
    }
    if (healable && this.partial) {
      // A URL that is still arriving names the wrong resource, so it waits for its closing
      // quote like any value that can't heal.
      if (!URL_PREFIXES.some(prefix => buf.startsWith(prefix))) {
        this.cut = true;
        return buf;
      }
    }
    return this.end();
  }

  private hex(digits: string): number {
    if (!HEX_RE.test(digits)) this.fail('invalid unicode escape');
    return parseInt(digits, 16);
  }

  private number(): number {
    const start = this.i;
    if (this.text[this.i] === '-') this.i += 1;
    while (!this.atEnd && /[0-9+\-.eE]/.test(this.text[this.i])) {
      this.i += 1;
    }
    if (this.atEnd && this.partial) this.end();
    const literal = this.text.slice(start, this.i);
    if (!NUMBER_RE.test(literal)) this.fail(`invalid number '${literal}'`);
    return Number(literal);
  }

  private skipSpace(): void {
    while (!this.atEnd && ' \t\n\r'.includes(this.text[this.i])) {
      this.i += 1;
    }
  }

  private end(): never {
    if (this.partial) throw new Unfinished();
    return this.fail('unexpected end of the JSON text');
  }

  private fail(reason: string): never {
    throw new JsonReadError(`Invalid JSON at ${this.i}: ${reason}`);
  }
}

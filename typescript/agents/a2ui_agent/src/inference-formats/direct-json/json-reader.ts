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

/**
 * Reads a partial JSON array or object into candidate envelopes.
 *
 * @param text The text of a block that may still be arriving.
 * @param progressiveKeys Keys whose string values are closed where they stand while they
 *     arrive.
 * @param wholeItemKeys Keys whose array items are read only once each item is whole.
 * @returns One `[envelope, closed]` pair per message, in order. `closed` is false when the
 *     message's text was still arriving and the reader healed it.
 */
export function readPartialMessageItems(
  text: string,
  progressiveKeys: Iterable<string>,
  wholeItemKeys: Iterable<string> = [],
): Array<[JsonValue, boolean]> {
  const progressive = new Set(progressiveKeys);
  const whole = new Set(wholeItemKeys);
  try {
    return new Reader(text, progressive, whole).messageItems();
  } catch (e) {
    if (!(e instanceof JsonReadError)) throw e;
    const straight = straightenQuotes(text);
    if (straight === text) return [];
    try {
      return new Reader(straight, progressive, whole).messageItems();
    } catch (e2) {
      if (!(e2 instanceof JsonReadError)) throw e2;
      return [];
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
  private i = 0;
  private cut = false;
  private readonly wholeItemKeys: ReadonlySet<string>;

  constructor(
    private readonly text: string,
    private readonly progressiveKeys: ReadonlySet<string> | undefined,
    wholeItemKeys: ReadonlySet<string> = new Set(),
  ) {
    this.wholeItemKeys = wholeItemKeys;
  }

  private get partial(): boolean {
    return this.progressiveKeys !== undefined;
  }

  private get atEnd(): boolean {
    return this.i >= this.text.length;
  }

  document(): JsonValue {
    this.skipSpace();
    const value = this.value(false);
    this.skipSpace();
    if (!this.atEnd) this.fail('unexpected text after the JSON value');
    return value;
  }

  messageItems(): Array<[JsonValue, boolean]> {
    this.skipSpace();
    if (this.atEnd) return [];
    if (this.text[this.i] !== '[') {
      try {
        this.cut = false;
        const message = this.value(false);
        const closed = !this.cut;
        this.skipSpace();
        if (!this.atEnd) this.fail('unexpected text after the JSON value');
        return [[message, closed]];
      } catch (e) {
        if (e instanceof Unfinished) return [];
        throw e;
      }
    }
    this.i += 1;
    const messages: Array<[JsonValue, boolean]> = [];
    for (;;) {
      this.skipSpace();
      if (this.atEnd) return messages;
      if (this.text[this.i] === ']') {
        this.i += 1;
        this.skipSpace();
        if (!this.atEnd) this.fail('unexpected text after the JSON value');
        return messages;
      }
      try {
        this.cut = false;
        const message = this.value(false);
        messages.push([message, !this.cut]);
      } catch (e) {
        if (e instanceof Unfinished) return messages;
        throw e;
      }
      this.skipSpace();
      if (this.atEnd) return messages;
      if (this.text[this.i] === ',') {
        this.i += 1;
      } else if (this.text[this.i] !== ']') {
        this.fail("expected ',' or ']'");
      }
    }
  }

  private value(healable: boolean): JsonValue {
    if (this.atEnd) this.end();
    const c = this.text[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array(false);
    if (c === '"') return this.string(healable);
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    const words: Array<[string, unknown]> = [
      ['true', true],
      ['false', false],
      ['null', null],
    ];
    for (const [word, val] of words) {
      if (this.text.startsWith(word, this.i)) {
        this.i += word.length;
        return val;
      }
      if (this.partial && word.startsWith(this.text.slice(this.i, this.i + word.length))) {
        this.end();
      }
    }
    return this.fail(`unexpected character '${c}'`);
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
        value = this.array(true);
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

  private array(wholeItems: boolean): unknown[] {
    this.i += 1;
    const arr: unknown[] = [];
    for (;;) {
      this.skipSpace();
      if (this.atEnd) return this.healed(arr);
      if (this.text[this.i] === ']') {
        this.i += 1;
        return arr;
      }
      if (wholeItems) {
        const cutBefore = this.cut;
        this.cut = false;
        let item: unknown;
        try {
          item = this.value(false);
        } catch (e) {
          if (e instanceof Unfinished) return this.healed(arr);
          throw e;
        }
        if (this.cut) return this.healed(arr);
        this.cut = cutBefore;
        arr.push(item);
      } else {
        arr.push(this.value(false));
      }
      this.skipSpace();
      if (this.atEnd) return this.healed(arr);
      if (this.text[this.i] === ',') {
        this.i += 1;
      } else if (this.text[this.i] !== ']') {
        this.fail("expected ',' or ']'");
      }
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
    const n = text.length;
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

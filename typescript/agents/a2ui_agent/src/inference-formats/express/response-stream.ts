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
 * @fileoverview Incremental streaming reader for A2UI Express DSL responses.
 */

import {
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  ParseError,
  withPartialResults,
} from '../../errors.js';
import {A2uiError, AgentToRendererMessage, CatalogApi} from '../../internal/web-core.js';
import {A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG} from '../../parser/constants.js';
import {ResponsePart, StreamPart} from '../../parser/response-part.js';
import {ResponseStream} from '../../parser/response-stream.js';
import {RendererState} from '../../utils/renderer-state.js';
import {ExpressCompiler, ExpressScopeSession, formatErrorMessage} from './compiler.js';
import {
  ExpressCompilerError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressValidationError,
} from './errors.js';
import {CatalogSchemaHelper} from './schema-helper.js';

/** Default property keys whose string literals stream progressively before the closing quote. */
export const DEFAULT_EXPRESS_PROGRESSIVE_KEYS: ReadonlySet<string> = new Set<string>(['text']);

const OPEN_TAG = A2UI_INFERENCE_OPEN_TAG;
const CLOSE_TAG = A2UI_INFERENCE_CLOSE_TAG;
const OPEN_TAG_SOURCE = '<a2ui(?:\\s[^>]*)?>';
const CLOSE_TAG_SOURCE = '<\\/a2ui\\s*>';
const OPEN_TAG_START_RE = /<a2ui\s[^>]*$/iy;
const CLOSE_TAG_START_RE = /<\/a2ui\s*$/iy;
const LEADING_FENCE_RE = /^\s*(?:```[a-zA-Z0-9_-]*[ \t]*\r?\n|`+\s*)/;
const TRAILING_FENCE_RE = /(?:\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`+)\s*$/;
const IDENT_RE = /[a-zA-Z_][a-zA-Z0-9_]*/y;
const DATA_ASSIGN_RE = /^\s*\$([a-zA-Z0-9_/]*)\s*=(?!=)/;

/** Parser interface required by `ExpressResponseStream`. */
export interface ExpressStreamSource {
  readonly catalogs: CatalogApi[];
  readonly surfaceId: string;
  readonly version: string;
  readonly progressiveKeys: ReadonlySet<string>;
  compile(formatContent: string, isFinal?: boolean): AgentToRendererMessage[];
}

interface TagMatch {
  start: number;
  end: number;
}

function searchOpenTag(text: string, from = 0): TagMatch | undefined {
  const re = new RegExp(OPEN_TAG_SOURCE, 'gi');
  re.lastIndex = from;
  const match = re.exec(text);
  return match ? {start: match.index, end: match.index + match[0].length} : undefined;
}

function matchCloseTag(text: string, at: number): number | undefined {
  const re = new RegExp(CLOSE_TAG_SOURCE, 'iy');
  re.lastIndex = at;
  const match = re.exec(text);
  return match ? at + match[0].length : undefined;
}

function isTagPrefix(text: string, idx: number, tag: string): boolean {
  return text.length - idx < tag.length && tag.startsWith(text.slice(idx).toLowerCase());
}

function matchesAt(re: RegExp, text: string, idx: number): boolean {
  re.lastIndex = idx;
  return re.test(text);
}

/** Returns where a tail of `text` could start `<a2ui>`, else its length. */
export function possibleOpenTagStart(text: string): number {
  let idx = text.indexOf('<');
  while (idx >= 0) {
    if (isTagPrefix(text, idx, OPEN_TAG) || matchesAt(OPEN_TAG_START_RE, text, idx)) {
      return idx;
    }
    idx = text.indexOf('<', idx + 1);
  }
  return text.length;
}

/** Finds `</a2ui>` outside string literals, or holds a partial close-tag tail. */
export function scanExpressBlock(content: string): [number | undefined, number] {
  let i = 0;
  const n = content.length;
  while (i < n) {
    const nextI = skipBlockLiteralOrComment(content, i, n);
    if (nextI > i) {
      i = nextI;
      continue;
    }
    if (content[i] === '<') {
      const hit = checkCloseTagAt(content, i);
      if (hit !== undefined) {
        return hit;
      }
    }
    i += 1;
  }
  return [undefined, n];
}

function skipBlockLiteralOrComment(content: string, i: number, n: number): number {
  if (content[i] === '"') {
    return skipStringLiteral(content, i, n);
  }
  if (content.startsWith('/*', i)) {
    const endComment = content.indexOf('*/', i + 2);
    return endComment < 0 ? n : endComment + 2;
  }
  if (content[i] === '#' || content.startsWith('//', i) || content.startsWith('--', i)) {
    let j = i + 1;
    while (j < n && content[j] !== '\n' && content[j] !== '\r') {
      if (content[j] === '<' && checkCloseTagAt(content, j) !== undefined) {
        return j;
      }
      j += 1;
    }
    return j < n ? j + 1 : n;
  }
  return i;
}

function checkCloseTagAt(content: string, i: number): [number | undefined, number] | undefined {
  if (matchCloseTag(content, i) !== undefined) {
    return [i, i];
  }
  if (isTagPrefix(content, i, CLOSE_TAG) || matchesAt(CLOSE_TAG_START_RE, content, i)) {
    return [undefined, i];
  }
  return undefined;
}

function skipStringLiteral(content: string, start: number, n: number): number {
  const quote = content[start];
  const tripleDelim = quote.repeat(3);
  const triple = content.startsWith(tripleDelim, start);
  const delim = triple ? tripleDelim : quote;
  let i = start + delim.length;
  while (i < n) {
    if (content[i] === '\\') {
      i += 2;
      continue;
    }
    if (content.startsWith(delim, i)) {
      return i + delim.length;
    }
    i += 1;
  }
  return n;
}

/** Strips leading/trailing markdown fences from `block.slice(0, end)`. */
export function cleanExpressPayload(block: string, end: number): string | undefined {
  const text = block.slice(0, end);
  const stripped = text.trimStart();
  if (stripped.length > 0 && stripped.length <= 3 && '```'.startsWith(stripped)) {
    return undefined;
  }
  if (stripped.startsWith('```') && !stripped.includes('\n')) {
    return undefined;
  }
  const withoutLeading = text.replace(LEADING_FENCE_RE, '');
  return withoutLeading.replace(TRAILING_FENCE_RE, '');
}

class ScanCursor {
  depth = 0;
  hasToken = false;
  sawEquals = false;
  hasRhs = false;
  rhsClosed = false;
  lastComplete = 0;

  resetStatement(pos: number): void {
    this.hasToken = false;
    this.sawEquals = false;
    this.hasRhs = false;
    this.rhsClosed = false;
    this.lastComplete = pos;
  }
}

/** Splits `source` into `[completePrefix, trailingFragment]`. */
export function splitCompleteStatements(source: string, isFinal = false): [string, string] {
  if (isFinal) {
    return [source, ''];
  }
  const cur = new ScanCursor();
  let i = 0;
  const n = source.length;
  while (i < n) {
    const [nextI, closedString] = stepStringOrComment(source, i, n);
    if (nextI > i) {
      if (closedString && cur.depth === 0 && cur.sawEquals) {
        cur.hasRhs = true;
        cur.rhsClosed = true;
        cur.lastComplete = nextI;
      }
      i = nextI;
      continue;
    }
    i = stepCodeChar(source, i, n, cur);
  }
  return [source.slice(0, cur.lastComplete), source.slice(cur.lastComplete)];
}

function stepStringOrComment(source: string, i: number, n: number): [number, boolean] {
  if ((source[i] === 'r' || source[i] === 'R') && i + 1 < n && source[i + 1] === '"') {
    const end = scanDoubleQuoted(source, i + 1, n, true);
    return end !== undefined ? [end, true] : [n, false];
  }
  if (source[i] === '"') {
    const end = scanDoubleQuoted(source, i, n, false);
    return end !== undefined ? [end, true] : [n, false];
  }
  if (source.startsWith('/*', i)) {
    const close = source.indexOf('*/', i + 2);
    return close >= 0 ? [close + 2, false] : [n, false];
  }
  if (source[i] === '#' || source.startsWith('//', i) || source.startsWith('--', i)) {
    const nl = source.indexOf('\n', i);
    return nl >= 0 ? [nl, false] : [n, false];
  }
  return [i, false];
}

function scanDoubleQuoted(
  source: string,
  quoteStart: number,
  n: number,
  raw: boolean,
): number | undefined {
  const triple = source.startsWith('"""', quoteStart);
  const delim = triple ? '"""' : '"';
  let i = quoteStart + delim.length;
  while (i < n) {
    if (!raw && source[i] === '\\') {
      if (i + 1 >= n) {
        return undefined;
      }
      i += 2;
      continue;
    }
    if (source.startsWith(delim, i)) {
      return i + delim.length;
    }
    i += 1;
  }
  return undefined;
}

function stepCodeChar(source: string, i: number, n: number, cur: ScanCursor): number {
  const ch = source[i];
  if (ch === '(' || ch === '[' || ch === '{') {
    onOpenBracket(cur);
  } else if (ch === ')' || ch === ']' || ch === '}') {
    onCloseBracket(i, cur);
  } else if (cur.depth === 0 && (ch === '\n' || ch === ';')) {
    onStatementSeparator(i, cur);
  } else if (!/\s/.test(ch)) {
    onNonSpaceChar(source, i, n, cur);
  }
  return i + 1;
}

function onOpenBracket(cur: ScanCursor): void {
  cur.depth += 1;
  cur.hasToken = true;
  if (cur.sawEquals) {
    cur.hasRhs = true;
    cur.rhsClosed = false;
  }
}

function onCloseBracket(i: number, cur: ScanCursor): void {
  if (cur.depth <= 0) {
    return;
  }
  cur.depth -= 1;
  if (cur.depth === 0 && (cur.sawEquals || cur.hasToken)) {
    cur.hasRhs = true;
    cur.rhsClosed = true;
    cur.lastComplete = i + 1;
  }
}

function onStatementSeparator(i: number, cur: ScanCursor): void {
  if (cur.rhsClosed || (cur.sawEquals && cur.hasRhs)) {
    cur.resetStatement(i + 1);
  } else if (!cur.hasToken) {
    cur.lastComplete = i + 1;
  }
}

function onNonSpaceChar(source: string, i: number, n: number, cur: ScanCursor): void {
  if (cur.depth === 0 && source[i] === '=' && (i + 1 >= n || source[i + 1] !== '=')) {
    cur.sawEquals = true;
    cur.hasToken = true;
    return;
  }
  cur.hasToken = true;
  if (cur.depth === 0 && cur.sawEquals) {
    cur.hasRhs = true;
  }
}

interface OpenCallFrame {
  name: string;
  argIndex: number;
  kwargName?: string;
  lastIdent?: string;
}

interface UnclosedStringState {
  strStart: number;
  delim: string;
  isRaw: boolean;
  brackets: string[];
  calls: OpenCallFrame[];
}

class FragmentScanState {
  brackets: string[] = [];
  calls: OpenCallFrame[] = [];
  lastIdent: string | undefined = undefined;
}

/** Heals an unclosed progressive string literal at the tail of `fragment`. */
export function healProgressiveFragment(
  fragment: string,
  helpers: ReadonlyMap<string, CatalogSchemaHelper>,
  progressiveKeys: ReadonlySet<string>,
): string | undefined {
  if (progressiveKeys.size === 0 || !fragment.trim()) {
    return undefined;
  }
  const state = scanFragmentForUnclosedString(fragment);
  if (state === undefined) {
    return undefined;
  }
  const content = fragment.slice(state.strStart);
  if (isUrlLike(content)) {
    return undefined;
  }
  if (!isProgressiveSlot(fragment, state.calls, helpers, progressiveKeys)) {
    return undefined;
  }
  let healed = fragment;
  if (!state.isRaw && hasOddTrailingBackslashes(healed)) {
    healed = healed.slice(0, -1);
  }
  if (state.delim === '"""' && !state.isRaw && healed.endsWith('"')) {
    healed = `${healed.slice(0, -1)}\\"`;
  }
  const closingBrackets = [...state.brackets]
    .reverse()
    .map(b => closingDelimiter(b))
    .join('');
  return `${healed}${state.delim}${closingBrackets}`;
}

function scanFragmentForUnclosedString(fragment: string): UnclosedStringState | undefined {
  let i = 0;
  const n = fragment.length;
  const st = new FragmentScanState();

  while (i < n) {
    const strRes = tryScanFragmentString(fragment, i, n, st);
    if (strRes !== undefined) {
      if (strRes.unclosed !== undefined) {
        return strRes.unclosed;
      }
      i = strRes.nextI;
      continue;
    }
    const commentI = trySkipFragmentComment(fragment, i);
    if (commentI !== undefined) {
      if (commentI < 0) {
        return undefined;
      }
      i = commentI;
      continue;
    }
    i = stepFragmentToken(fragment, i, st);
  }
  return undefined;
}

function tryScanFragmentString(
  fragment: string,
  i: number,
  n: number,
  st: FragmentScanState,
): {nextI: number; unclosed?: UnclosedStringState} | undefined {
  const isRaw =
    (fragment[i] === 'r' || fragment[i] === 'R') && i + 1 < n && fragment[i + 1] === '"';
  if (!isRaw && fragment[i] !== '"') {
    return undefined;
  }
  const quotePos = isRaw ? i + 1 : i;
  const delim = fragment.startsWith('"""', quotePos) ? '"""' : '"';
  const end = scanDoubleQuoted(fragment, quotePos, n, isRaw);
  if (end === undefined) {
    return {
      nextI: n,
      unclosed: {
        strStart: quotePos + delim.length,
        delim,
        isRaw,
        brackets: st.brackets,
        calls: st.calls,
      },
    };
  }
  return {nextI: end};
}

function trySkipFragmentComment(fragment: string, i: number): number | undefined {
  if (fragment.startsWith('/*', i)) {
    const close = fragment.indexOf('*/', i + 2);
    return close < 0 ? -1 : close + 2;
  }
  if (fragment[i] === '#' || fragment.startsWith('//', i) || fragment.startsWith('--', i)) {
    const nl = fragment.indexOf('\n', i);
    return nl < 0 ? -1 : nl + 1;
  }
  return undefined;
}

function stepFragmentToken(fragment: string, i: number, st: FragmentScanState): number {
  IDENT_RE.lastIndex = i;
  const match = IDENT_RE.exec(fragment);
  if (match) {
    st.lastIdent = match[0];
    if (st.calls.length > 0 && st.brackets[st.brackets.length - 1] === '(') {
      st.calls[st.calls.length - 1].lastIdent = st.lastIdent;
    }
    return i + match[0].length;
  }
  applyFragmentPunct(fragment[i], st);
  return i + 1;
}

function applyFragmentPunct(ch: string, st: FragmentScanState): void {
  const inCallParens = st.calls.length > 0 && st.brackets[st.brackets.length - 1] === '(';
  if (ch === '(') {
    st.brackets.push('(');
    st.calls.push({name: st.lastIdent ?? '', argIndex: 0});
    st.lastIdent = undefined;
  } else if (ch === '[' || ch === '{') {
    st.brackets.push(ch);
    st.lastIdent = undefined;
  } else if (ch === ')' || ch === ']' || ch === '}') {
    if (st.brackets.pop() === '(' && st.calls.length > 0) {
      st.calls.pop();
    }
    st.lastIdent = undefined;
  } else if (ch === ',' && inCallParens) {
    const top = st.calls[st.calls.length - 1];
    top.argIndex += 1;
    top.kwargName = undefined;
    top.lastIdent = undefined;
  } else if (ch === '=' && inCallParens && st.calls[st.calls.length - 1].lastIdent) {
    const top = st.calls[st.calls.length - 1];
    top.kwargName = top.lastIdent;
  } else if (!/\s/.test(ch)) {
    st.lastIdent = undefined;
  }
}

function isProgressiveSlot(
  fragment: string,
  calls: OpenCallFrame[],
  helpers: ReadonlyMap<string, CatalogSchemaHelper>,
  progressiveKeys: ReadonlySet<string>,
): boolean {
  if (calls.length === 0) {
    // A data path heals when its last segment names a progressive key, as a Direct JSON
    // value heals when its key does.
    const match = DATA_ASSIGN_RE.exec(fragment);
    if (!match) return false;
    const segments = match[1].replace(/\/+$/, '').split('/');
    return progressiveKeys.has(segments[segments.length - 1]);
  }
  const frame = calls[calls.length - 1];
  if (!frame.name) {
    return false;
  }
  for (const helper of helpers.values()) {
    if (helper.components.has(frame.name)) {
      if (frame.kwargName !== undefined) {
        return progressiveKeys.has(frame.kwargName);
      }
      const checkProp = helper.getCheckRuleProperty(frame.name);
      const props = helper
        .getComponentProperties(frame.name)
        .filter(p => p !== 'checks' && p !== checkProp);
      if (frame.argIndex < props.length) {
        return progressiveKeys.has(props[frame.argIndex]);
      }
    }
  }
  return false;
}

function isUrlLike(content: string): boolean {
  const lower = content.trimStart().toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:');
}

function hasOddTrailingBackslashes(text: string): boolean {
  let count = 0;
  let idx = text.length - 1;
  while (idx >= 0 && text[idx] === '\\') {
    count += 1;
    idx -= 1;
  }
  return count % 2 === 1;
}

function closingDelimiter(openCh: string): string {
  if (openCh === '[') return ']';
  if (openCh === '{') return '}';
  return ')';
}

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

/** Wraps an `ExpressCompilerError` into the matching `A2uiCompilationError` subclass. */
export function wrapExpressCompilationError(error: unknown, rawContent: string): unknown {
  if (error instanceof A2uiCompilationError) {
    return error;
  }
  if (error instanceof ExpressCompilerError) {
    const cause = (error as {cause?: unknown}).cause;
    let line: number | undefined;
    let column: number | undefined;
    if (error instanceof ExpressSyntaxError) {
      line = error.line;
      column = error.column;
    } else if (cause instanceof ExpressSyntaxError) {
      line = cause.line;
      column = cause.column;
    }
    const helpMessage = error.helpMessage || 'Please correct the syntax error in your Express DSL.';
    const ErrorClass = compilationErrorClass(error);
    const message = formatErrorMessage(error);
    const wrapped = new ErrorClass(message, {
      rawContent,
      line,
      column,
      helpMessage,
    });
    (wrapped as {cause?: unknown}).cause = error;
    return wrapped;
  }
  return error;
}

/** How an Express stream is opened. */
export interface ExpressStreamOptions {
  /** False if the whole response is one block, without tags. */
  wrapped?: boolean;
  /** The state the stream's messages are applied to. */
  state?: RendererState;
  /** Whether the stream ends at a rejected block or reads past it. */
  afterRejectedBlock?: 'end' | 'continue';
  /** Property keys whose unclosed string literals are healed progressively. */
  progressiveKeys?: Iterable<string>;
}

/**
 * Reads a streamed A2UI Express response chunk by chunk.
 *
 * By default the stream ends at the first rejected block: `feed` or `close` throws, and the
 * error's `partialResults` holds the parts the chunk made ready before the failure. Opened
 * with `afterRejectedBlock: 'continue'`, it returns an `ErrorPart` in the block's place,
 * skips the rest of the block, and reads on. Either way the messages the block emitted stay
 * in the state and the components they added are marked checked.
 *
 * @template Part The parts the stream returns. See `ResponseStream`.
 */
export class ExpressResponseStream<
  Part extends StreamPart = ResponsePart,
> implements ResponseStream<Part> {
  readonly state: RendererState;
  private readonly wrapped: boolean;
  private readonly continues: boolean;
  private readonly compiler: ExpressCompiler;
  private readonly progressiveKeys: ReadonlySet<string>;
  private closed = false;
  private held = '';
  private heldBackticks = '';
  private stripCloseBackticks = false;
  private runStarted = false;
  private heldSpace = '';
  private inBlock: boolean;
  /** Whether the open block was rejected, so the rest of it is skipped. */
  private rejected = false;
  private block = '';
  private lastCompiledPrefix = '';
  private touched = new Set<string>();
  private initialSurfaces: ReadonlySet<string>;
  private session: ExpressScopeSession;

  /**
   * @param parser The parser that opened the stream.
   * @param options Whether the response is wrapped in tags, the state the stream's messages
   *     are applied to, whether the stream reads past a rejected block, and the keys whose
   *     strings heal progressively.
   */
  constructor(
    private readonly parser: ExpressStreamSource,
    {wrapped = true, state, afterRejectedBlock = 'end', progressiveKeys}: ExpressStreamOptions = {},
  ) {
    this.wrapped = wrapped;
    this.state = state ?? new RendererState(parser.catalogs);
    this.continues = afterRejectedBlock === 'continue';
    this.compiler = new ExpressCompiler(parser.catalogs, parser.version);
    this.progressiveKeys =
      progressiveKeys !== undefined ? new Set(progressiveKeys) : parser.progressiveKeys;
    this.inBlock = !wrapped;
    this.initialSurfaces = new Set(this.state.surfaceIds);
    this.session = this.newSession();
  }

  get isInBlock(): boolean {
    return !this.closed && this.inBlock;
  }

  private newSession(): ExpressScopeSession {
    return new ExpressScopeSession(this.compiler, {
      surfaceId: this.parser.surfaceId,
      version: this.parser.version,
    });
  }

  /** Forgets the block that closed, whether it was read or rejected. */
  private resetBlock(): void {
    this.block = '';
    this.rejected = false;
    this.lastCompiledPrefix = '';
    this.touched = new Set<string>();
    this.initialSurfaces = new Set(this.state.surfaceIds);
    this.session = this.newSession();
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
    if (this.closed) {
      return [];
    }
    this.closed = true;
    const parts: StreamPart[] = [];
    try {
      if (!this.wrapped) {
        if (!this.rejected) {
          this.readBlock(parts, () => this.finishBlock(parts, this.block.length));
        }
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
        this.state.markChecked(this.touched);
        return parts;
      }
    } catch (e) {
      this.fail();
      throw withPartialResults(e, parts.filter(isResponsePart));
    }
    if (this.heldBackticks) {
      this.emitText(parts, this.heldBackticks);
      this.heldBackticks = '';
    }
    if (this.held) {
      this.emitText(parts, this.held);
      this.held = '';
    }
    return parts;
  }

  /**
   * Ends the stream after a failure. The renderer holds the messages already emitted, and so
   * does the state, so the components they added are marked checked.
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
      if (!this.rejected) {
        this.readBlock(parts, () => this.emitReady(parts, this.block.length));
      }
      return;
    }

    let input = this.prepareChunk(chunk);
    while (input.length > 0) {
      if (this.inBlock) {
        input = this.consumeBlockText(parts, input);
      } else {
        input = this.consumeOutsideText(parts, input);
      }
    }
  }

  private prepareChunk(chunk: string): string {
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
    if (!this.inBlock && this.heldBackticks.length > 0 && input.length > 0) {
      const isOpen =
        searchOpenTag(input)?.start === 0 ||
        matchesAt(OPEN_TAG_START_RE, input, 0) ||
        (input.startsWith('<') &&
          input.length <= OPEN_TAG.length &&
          OPEN_TAG.startsWith(input.toLowerCase()));
      if (!isOpen) {
        input = `${this.heldBackticks}${input}`;
      }
      this.heldBackticks = '';
    }
    return input;
  }

  private consumeBlockText(parts: StreamPart[], input: string): string {
    this.block += input;
    const [closeStart, readableEnd] = scanExpressBlock(this.block);
    if (closeStart === undefined) {
      if (!this.rejected) {
        this.readBlock(parts, () => this.emitReady(parts, readableEnd));
      }
      return '';
    }
    const closeEnd = matchCloseTag(this.block, closeStart)!;
    let remaining = this.block.slice(closeEnd);
    if (remaining.startsWith('`')) {
      remaining = remaining.replace(/^`+/, '');
    } else if (!remaining) {
      this.stripCloseBackticks = true;
    }
    if (!this.rejected) {
      this.readBlock(parts, () => this.finishBlock(parts, closeStart));
    }
    this.inBlock = false;
    this.resetBlock();
    return remaining;
  }

  private consumeOutsideText(parts: StreamPart[], input: string): string {
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
      this.resetBlock();
      return input.slice(open.end);
    }

    let hold = possibleOpenTagStart(input);
    if (hold < input.length) {
      while (hold > 0 && input.charCodeAt(hold - 1) === 0x60) {
        hold -= 1;
      }
    }
    let textToEmit = input.slice(0, hold);
    this.held = input.slice(hold);
    if (!this.held) {
      const ticksMatch = textToEmit.match(/`+$/);
      if (ticksMatch) {
        this.heldBackticks = ticksMatch[0];
        textToEmit = textToEmit.slice(0, textToEmit.length - this.heldBackticks.length);
      }
    }
    this.emitText(parts, textToEmit);
    return '';
  }

  private emitText(parts: StreamPart[], text: string): void {
    const body = (this.runStarted ? text : text.trimStart()).trimEnd();
    if (!body) {
      if (this.runStarted) {
        this.heldSpace += text;
      }
      return;
    }
    const start = this.runStarted ? 0 : text.indexOf(body);
    parts.push({type: 'text', text: `${this.heldSpace}${body}`});
    this.heldSpace = text.slice(start + body.length);
    this.runStarted = true;
  }

  private emitReady(parts: StreamPart[], end: number): void {
    const payload = cleanExpressPayload(this.block, end);
    if (!payload || !payload.trim()) {
      return;
    }
    const [completePrefix, trailingFragment] = splitCompleteStatements(payload, false);
    const readyMessages: AgentToRendererMessage[] = [];
    if (completePrefix.trim() && completePrefix !== this.lastCompiledPrefix) {
      const prefixMsgs = this.compileStep(completePrefix, false, true);
      this.lastCompiledPrefix = completePrefix;
      if (prefixMsgs.length > 0) {
        this.apply(prefixMsgs);
        readyMessages.push(...prefixMsgs);
      }
    }

    const healed = healProgressiveFragment(
      trailingFragment,
      this.compiler.helpers,
      this.progressiveKeys,
    );
    if (healed !== undefined) {
      const combined = completePrefix.trim() ? `${completePrefix}\n${healed}` : healed;
      readyMessages.push(...this.tryCompileAndApplyHealed(combined));
    }

    if (readyMessages.length > 0) {
      parts.push({type: 'a2ui', a2ui: mergeSameSurfaceUpdates(readyMessages)});
    }
  }

  private tryCompileAndApplyHealed(combined: string): AgentToRendererMessage[] {
    const savedSession = this.session.snapshot();
    const savedTouched = new Set(this.touched);
    try {
      return this.state.transaction(() => {
        const msgs = this.compileStep(combined, false, false);
        if (msgs.length > 0) {
          this.apply(msgs);
        }
        return msgs;
      });
    } catch (e) {
      if (e instanceof A2uiError) {
        this.session.restore(savedSession);
        this.touched = savedTouched;
        return [];
      }
      throw e;
    }
  }

  private finishBlock(parts: StreamPart[], end: number): void {
    const payload = cleanExpressPayload(this.block, end) ?? '';
    let models: AgentToRendererMessage[] = [];
    this.state.transaction(() => {
      if (!this.session.hasEmitted) {
        models = this.parser.compile(payload, true);
        this.apply(models);
      } else {
        models = this.compileStep(payload, true, true);
        if (models.length > 0) {
          this.apply(models);
        }
      }
      this.state.checkTopology(this.touched);
    });
    if (models.length > 0) {
      parts.push({type: 'a2ui', a2ui: models});
    }
  }

  private compileStep(
    source: string,
    isFinal: boolean,
    cachePrefix = true,
  ): AgentToRendererMessage[] {
    try {
      return this.session.compileStep(source, {
        isFinal,
        existingSurfaces: this.initialSurfaces,
        cachePrefix,
      });
    } catch (e) {
      throw wrapExpressCompilationError(e, source);
    }
  }

  private apply(messages: readonly AgentToRendererMessage[]): void {
    const touched = this.state.apply(messages);
    for (const id of touched) {
      this.touched.add(id);
    }
  }
}

function isResponsePart(part: StreamPart): part is ResponsePart {
  return part.type !== 'error';
}

function mergeSameSurfaceUpdates(messages: AgentToRendererMessage[]): AgentToRendererMessage[] {
  const merged: AgentToRendererMessage[] = [];
  for (const msg of messages) {
    if (merged.length > 0 && tryMergeComponentUpdate(merged[merged.length - 1], msg)) {
      continue;
    }
    merged.push(msg);
  }
  return merged;
}

function tryMergeComponentUpdate(
  prev: AgentToRendererMessage,
  curr: AgentToRendererMessage,
): boolean {
  const currRec = curr as unknown as Record<string, unknown>;
  const currUpd = currRec.updateComponents as Record<string, unknown> | undefined;
  if (!currUpd || !Array.isArray(currUpd.components)) {
    return false;
  }
  const sid = currUpd.surfaceId;
  const prevRec = prev as unknown as Record<string, unknown>;
  for (const key of ['updateComponents', 'createSurface']) {
    const target = prevRec[key] as Record<string, unknown> | undefined;
    if (target && target.surfaceId === sid && Array.isArray(target.components)) {
      const existing = [...(target.components as Record<string, unknown>[])];
      const byId = new Map<unknown, number>();
      existing.forEach((c, idx) => byId.set(c.id, idx));
      for (const comp of currUpd.components as Record<string, unknown>[]) {
        const prevIdx = byId.get(comp.id);
        if (prevIdx !== undefined) {
          existing[prevIdx] = comp;
        } else {
          byId.set(comp.id, existing.length);
          existing.push(comp);
        }
      }
      target.components = existing;
      return true;
    }
  }
  return false;
}

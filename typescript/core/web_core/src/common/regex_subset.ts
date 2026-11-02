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

/** Maximum allowed pattern length in Unicode code points. */
export const MAX_REGEX_PATTERN_CODE_POINTS = 256;

/** Maximum allowed input value length in Unicode code points. */
export const MAX_REGEX_VALUE_CODE_POINTS = 4096;

/** Closed inclusive Unicode scalar range `[start, end]`. */
export interface CodePointRange {
  readonly start: number;
  readonly end: number;
}

/** Zero-width anchor kinds supported by the A2UI regex dialect. */
export type AnchorKind = 'start' | 'end' | 'wordBoundary' | 'notWordBoundary';

/** Abstract syntax tree node for the A2UI portable regex subset. */
export type RegexNode =
  | {readonly kind: 'empty'}
  | {readonly kind: 'charSet'; readonly ranges: readonly CodePointRange[]}
  | {readonly kind: 'group'; readonly capturing: boolean; readonly child: RegexNode}
  | {readonly kind: 'lookahead'; readonly negated: boolean; readonly child: RegexNode}
  | {readonly kind: 'anchor'; readonly anchor: AnchorKind}
  | {readonly kind: 'concat'; readonly items: readonly RegexNode[]}
  | {readonly kind: 'alt'; readonly branches: readonly RegexNode[]}
  | {
      readonly kind: 'repeat';
      readonly child: RegexNode;
      readonly min: number;
      readonly max: number | null;
      readonly lazy: boolean;
    };

/** Rejection tokens produced by the A2UI regex subset parser and safety guard. */
export type RegexRejection =
  | 'UNSUPPORTED_SYNTAX'
  | 'PATTERN_TOO_LONG'
  | 'NESTED_QUANTIFIER'
  | 'OVERLAPPING_ALTERNATION'
  | 'ADJACENT_OVERLAP';

/** Result of parsing and checking an A2UI regex pattern. */
export type RegexAnalysisResult =
  | {readonly ok: true; readonly tree: RegexNode}
  | {
      readonly ok: false;
      readonly reason: RegexRejection | 'SYNTAX';
      readonly detail: string;
    };

/** Error raised when a pattern fails A2UI regex subset parsing. */
export class RegexSyntaxError extends Error {
  readonly unsupported: boolean;

  constructor(message: string, unsupported = false) {
    super(message);
    this.name = 'RegexSyntaxError';
    this.unsupported = unsupported;
  }
}

const SURROGATE_RANGE: CodePointRange = {start: 0xd800, end: 0xdfff};
const MAX_CODE_POINT = 0x10ffff;

const DIGIT_RANGES: readonly CodePointRange[] = [{start: 0x30, end: 0x39}];
const WORD_RANGES: readonly CodePointRange[] = [
  {start: 0x30, end: 0x39},
  {start: 0x41, end: 0x5a},
  {start: 0x5f, end: 0x5f},
  {start: 0x61, end: 0x7a},
];
const SPACE_RANGES: readonly CodePointRange[] = [
  {start: 0x09, end: 0x0d},
  {start: 0x20, end: 0x20},
  {start: 0xa0, end: 0xa0},
  {start: 0x1680, end: 0x1680},
  {start: 0x2000, end: 0x200a},
  {start: 0x2028, end: 0x2029},
  {start: 0x202f, end: 0x202f},
  {start: 0x205f, end: 0x205f},
  {start: 0x3000, end: 0x3000},
  {start: 0xfeff, end: 0xfeff},
];
const LINE_TERMINATOR_RANGES: readonly CodePointRange[] = [
  {start: 0x0a, end: 0x0a},
  {start: 0x0d, end: 0x0d},
  {start: 0x2028, end: 0x2029},
];

const SYNTAX_CHARS = new Set<number>([
  0x5e, // ^
  0x24, // $
  0x5c, // \
  0x2e, // .
  0x2a, // *
  0x2b, // +
  0x3f, // ?
  0x28, // (
  0x29, // )
  0x5b, // [
  0x5d, // ]
  0x7b, // {
  0x7d, // }
  0x7c, // |
  0x2f, // /
  0x2d, // -
]);

const CONTROL_ESCAPES = new Map<number, number>([
  [0x74, 0x09], // \t
  [0x6e, 0x0a], // \n
  [0x76, 0x0b], // \v
  [0x66, 0x0c], // \f
  [0x72, 0x0d], // \r
]);

function excludeSurrogates(r: CodePointRange): CodePointRange[] {
  if (r.start > r.end) return [];
  if (r.end < SURROGATE_RANGE.start || r.start > SURROGATE_RANGE.end) return [r];
  const out: CodePointRange[] = [];
  if (r.start < SURROGATE_RANGE.start) {
    out.push({start: r.start, end: SURROGATE_RANGE.start - 1});
  }
  if (r.end > SURROGATE_RANGE.end) {
    out.push({start: SURROGATE_RANGE.end + 1, end: r.end});
  }
  return out;
}

/** Normalizes, sorts, merges, and strips UTF-16 surrogates from code-point intervals. */
export function normalizeRanges(ranges: readonly CodePointRange[]): readonly CodePointRange[] {
  const split = ranges.flatMap(excludeSurrogates);
  if (split.length <= 1) return split;
  split.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: CodePointRange[] = [split[0]];
  for (let i = 1; i < split.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = split[i];
    if (curr.start <= prev.end + 1) {
      merged[merged.length - 1] = {start: prev.start, end: Math.max(prev.end, curr.end)};
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/** Computes the complement of `ranges` over all Unicode scalar values (`U+0000..U+10FFFF` excluding surrogates). */
export function complementRanges(ranges: readonly CodePointRange[]): readonly CodePointRange[] {
  const excluded = normalizeRanges([...ranges, SURROGATE_RANGE]);
  const result: CodePointRange[] = [];
  let cursor = 0;
  for (const r of excluded) {
    if (r.start > cursor) {
      result.push({start: cursor, end: r.start - 1});
    }
    cursor = r.end + 1;
  }
  if (cursor <= MAX_CODE_POINT) {
    result.push({start: cursor, end: MAX_CODE_POINT});
  }
  return result.flatMap(excludeSurrogates);
}

const NOT_DIGIT_RANGES = complementRanges(DIGIT_RANGES);
const NOT_WORD_RANGES = complementRanges(WORD_RANGES);
const NOT_SPACE_RANGES = complementRanges(SPACE_RANGES);
const DOT_RANGES = complementRanges(LINE_TERMINATOR_RANGES);

const CLASS_ESCAPES = new Map<number, readonly CodePointRange[]>([
  [0x64, DIGIT_RANGES], // \d
  [0x44, NOT_DIGIT_RANGES], // \D
  [0x77, WORD_RANGES], // \w
  [0x57, NOT_WORD_RANGES], // \W
  [0x73, SPACE_RANGES], // \s
  [0x53, NOT_SPACE_RANGES], // \S
]);

/** Returns true if two normalized `CodePointRange` arrays share at least one code point. */
export function rangesOverlap(a: readonly CodePointRange[], b: readonly CodePointRange[]): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].end < b[j].start) {
      i++;
    } else if (b[j].end < a[i].start) {
      j++;
    } else {
      return true;
    }
  }
  return false;
}

/** Counts Unicode code points in `input`. */
export function countCodePoints(input: string): number {
  let count = 0;
  for (let i = 0; i < input.length; i++) {
    const cu = input.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

function toCodePoints(pattern: string): number[] {
  const cps: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const cu = pattern.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const low = i + 1 < pattern.length ? pattern.charCodeAt(i + 1) : 0;
      if (low < 0xdc00 || low > 0xdfff) {
        throw new RegexSyntaxError('Lone high surrogate in pattern', true);
      }
      cps.push(0x10000 + ((cu - 0xd800) << 10) + (low - 0xdc00));
      i++;
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      throw new RegexSyntaxError('Lone low surrogate in pattern', true);
    } else {
      cps.push(cu);
    }
  }
  return cps;
}

class Scanner {
  private pos = 0;
  constructor(private readonly cps: readonly number[]) {}

  eof(): boolean {
    return this.pos >= this.cps.length;
  }

  peek(offset = 0): number | undefined {
    return this.cps[this.pos + offset];
  }

  next(): number {
    if (this.pos >= this.cps.length) {
      throw new RegexSyntaxError('Unexpected end of pattern', false);
    }
    return this.cps[this.pos++];
  }

  eat(cp: number): boolean {
    if (this.cps[this.pos] === cp) {
      this.pos++;
      return true;
    }
    return false;
  }
}

function isAsciiDigit(cp: number | undefined): cp is number {
  return cp !== undefined && cp >= 0x30 && cp <= 0x39;
}

function hexValue(cp: number | undefined): number {
  if (cp === undefined) return -1;
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (cp >= 0x41 && cp <= 0x46) return cp - 0x41 + 10;
  if (cp >= 0x61 && cp <= 0x66) return cp - 0x61 + 10;
  return -1;
}

function parseFixedHex(s: Scanner, digits: number): number {
  let value = 0;
  for (let i = 0; i < digits; i++) {
    const hv = hexValue(s.peek());
    if (hv < 0) {
      throw new RegexSyntaxError('Invalid hexadecimal escape', false);
    }
    s.next();
    value = (value << 4) | hv;
  }
  return value;
}

function parseUnicodeEscape(s: Scanner): number {
  if (!s.eat(0x7b)) {
    const cp = parseFixedHex(s, 4);
    if (cp >= SURROGATE_RANGE.start && cp <= SURROGATE_RANGE.end) {
      throw new RegexSyntaxError('Surrogate code point escape is not supported', true);
    }
    return cp;
  }
  let value = 0;
  let count = 0;
  while (!s.eof() && s.peek() !== 0x7d) {
    const hv = hexValue(s.peek());
    if (hv < 0) {
      throw new RegexSyntaxError('Invalid braced Unicode escape', false);
    }
    s.next();
    value = value * 16 + hv;
    count++;
    if (value > MAX_CODE_POINT) {
      throw new RegexSyntaxError('Unicode escape exceeds U+10FFFF', false);
    }
  }
  if (count === 0 || !s.eat(0x7d)) {
    throw new RegexSyntaxError('Malformed braced Unicode escape', false);
  }
  if (value >= SURROGATE_RANGE.start && value <= SURROGATE_RANGE.end) {
    throw new RegexSyntaxError('Surrogate code point escape is not supported', true);
  }
  return value;
}

type EscapeResult =
  | {readonly kind: 'single'; readonly cp: number}
  | {readonly kind: 'ranges'; readonly ranges: readonly CodePointRange[]}
  | {readonly kind: 'anchor'; readonly anchor: AnchorKind};

function parseNumericOrHexEscape(s: Scanner, cp: number): number | null {
  if (cp === 0x30) {
    if (isAsciiDigit(s.peek())) {
      throw new RegexSyntaxError('Octal escape is not supported', true);
    }
    return 0x00;
  }
  if (cp >= 0x31 && cp <= 0x39) {
    throw new RegexSyntaxError('Backreference or octal escape is not supported', true);
  }
  if (cp === 0x78) return parseFixedHex(s, 2);
  if (cp === 0x75) return parseUnicodeEscape(s);
  return null;
}

function parseEscape(s: Scanner, inClass: boolean): EscapeResult {
  if (s.eof()) {
    throw new RegexSyntaxError('Trailing backslash in pattern', false);
  }
  const cp = s.next();
  if (cp === 0x62) {
    return inClass ? {kind: 'single', cp: 0x08} : {kind: 'anchor', anchor: 'wordBoundary'};
  }
  if (cp === 0x42) {
    if (inClass) {
      throw new RegexSyntaxError('\\B is not supported inside a character class', true);
    }
    return {kind: 'anchor', anchor: 'notWordBoundary'};
  }
  const classRanges = CLASS_ESCAPES.get(cp);
  if (classRanges !== undefined) return {kind: 'ranges', ranges: classRanges};
  const controlCp = CONTROL_ESCAPES.get(cp);
  if (controlCp !== undefined) return {kind: 'single', cp: controlCp};
  const numOrHex = parseNumericOrHexEscape(s, cp);
  if (numOrHex !== null) return {kind: 'single', cp: numOrHex};
  if (SYNTAX_CHARS.has(cp)) return {kind: 'single', cp};
  throw new RegexSyntaxError('Unsupported escape sequence', true);
}

function parseClassAtom(s: Scanner): {
  readonly single?: number;
  readonly ranges: readonly CodePointRange[];
} {
  const cp = s.peek();
  if (cp === 0x5c) {
    s.next();
    const esc = parseEscape(s, true);
    if (esc.kind === 'single') {
      return {single: esc.cp, ranges: [{start: esc.cp, end: esc.cp}]};
    }
    if (esc.kind === 'ranges') {
      return {ranges: esc.ranges};
    }
    throw new RegexSyntaxError('Assertions are not valid in a character class', true);
  }
  if (cp === 0x5b) {
    throw new RegexSyntaxError('Nested character class is not supported', true);
  }
  if (cp === 0x26 && s.peek(1) === 0x26) {
    throw new RegexSyntaxError('Character class intersection is not supported', true);
  }
  const lit = s.next();
  return {single: lit, ranges: [{start: lit, end: lit}]};
}

function parseClassItem(s: Scanner): readonly CodePointRange[] {
  const firstAtom = parseClassAtom(s);
  if (s.peek() !== 0x2d || s.peek(1) === 0x5d) {
    return firstAtom.ranges;
  }
  s.next();
  if (s.peek() === 0x2d) {
    throw new RegexSyntaxError('Character class subtraction is not supported', true);
  }
  const secondAtom = parseClassAtom(s);
  if (firstAtom.single === undefined || secondAtom.single === undefined) {
    throw new RegexSyntaxError('Character class escape cannot form a range', false);
  }
  if (firstAtom.single > secondAtom.single) {
    throw new RegexSyntaxError('Character class range out of order', false);
  }
  return [{start: firstAtom.single, end: secondAtom.single}];
}

function parseClass(s: Scanner): RegexNode {
  const negated = s.eat(0x5e);
  const ranges: CodePointRange[] = [];
  while (!s.eof() && s.peek() !== 0x5d) {
    ranges.push(...parseClassItem(s));
  }
  if (!s.eat(0x5d)) {
    throw new RegexSyntaxError('Unclosed character class', false);
  }
  const normalized = normalizeRanges(ranges);
  return {
    kind: 'charSet',
    ranges: negated ? complementRanges(normalized) : normalized,
  };
}

function parseDecimalInt(s: Scanner): number | null {
  if (!isAsciiDigit(s.peek())) return null;
  let value = 0;
  while (isAsciiDigit(s.peek())) {
    value = value * 10 + (s.next() - 0x30);
  }
  return value;
}

function parseBracedBounds(s: Scanner): {min: number; max: number | null} {
  const min = parseDecimalInt(s);
  if (min === null) {
    throw new RegexSyntaxError('Malformed brace quantifier', true);
  }
  if (s.eat(0x7d)) {
    return {min, max: min};
  }
  if (!s.eat(0x2c)) {
    throw new RegexSyntaxError('Malformed brace quantifier', true);
  }
  if (s.eat(0x7d)) {
    return {min, max: null};
  }
  const max = parseDecimalInt(s);
  if (max === null || !s.eat(0x7d)) {
    throw new RegexSyntaxError('Malformed brace quantifier', true);
  }
  if (max < min) {
    throw new RegexSyntaxError('Quantifier minimum exceeds maximum', false);
  }
  return {min, max};
}

function isQuantifierStart(cp: number | undefined): boolean {
  return cp === 0x2a || cp === 0x2b || cp === 0x3f || cp === 0x7b;
}

function parseQuantifier(s: Scanner, child: RegexNode): RegexNode {
  const q = s.next();
  let min = 0;
  let max: number | null = null;
  if (q === 0x2a) {
    min = 0;
    max = null;
  } else if (q === 0x2b) {
    min = 1;
    max = null;
  } else if (q === 0x3f) {
    min = 0;
    max = 1;
  } else {
    const bounds = parseBracedBounds(s);
    min = bounds.min;
    max = bounds.max;
  }
  const lazy = s.eat(0x3f);
  if (isQuantifierStart(s.peek())) {
    throw new RegexSyntaxError('Possessive or chained quantifiers are not supported', true);
  }
  return {kind: 'repeat', child, min, max, lazy};
}

function parseGroup(s: Scanner): RegexNode {
  if (!s.eat(0x3f)) {
    const body = parseDisjunction(s);
    if (!s.eat(0x29)) {
      throw new RegexSyntaxError('Unclosed group', false);
    }
    return {kind: 'group', capturing: true, child: body};
  }
  const modifier = s.peek();
  if (modifier !== 0x3a && modifier !== 0x3d && modifier !== 0x21) {
    throw new RegexSyntaxError('Unsupported group extension', true);
  }
  s.next();
  const body = parseDisjunction(s);
  if (!s.eat(0x29)) {
    throw new RegexSyntaxError('Unclosed group', false);
  }
  if (modifier === 0x3a) {
    return {kind: 'group', capturing: false, child: body};
  }
  return {kind: 'lookahead', negated: modifier === 0x21, child: body};
}

function parseAtom(s: Scanner): RegexNode {
  const cp = s.next();
  if (cp === 0x5e) return {kind: 'anchor', anchor: 'start'};
  if (cp === 0x24) return {kind: 'anchor', anchor: 'end'};
  if (cp === 0x2e) return {kind: 'charSet', ranges: DOT_RANGES};
  if (cp === 0x5b) return parseClass(s);
  if (cp === 0x28) return parseGroup(s);
  if (cp === 0x5c) {
    const esc = parseEscape(s, false);
    if (esc.kind === 'anchor') return {kind: 'anchor', anchor: esc.anchor};
    if (esc.kind === 'ranges') return {kind: 'charSet', ranges: esc.ranges};
    return {kind: 'charSet', ranges: [{start: esc.cp, end: esc.cp}]};
  }
  if (cp === 0x7b || cp === 0x7d || cp === 0x5d) {
    throw new RegexSyntaxError('Unescaped brace or bracket is not supported', true);
  }
  if (cp === 0x2a || cp === 0x2b || cp === 0x3f) {
    throw new RegexSyntaxError('Nothing to repeat', false);
  }
  return {kind: 'charSet', ranges: [{start: cp, end: cp}]};
}

function parseTerm(s: Scanner): RegexNode {
  const atom = parseAtom(s);
  if (!isQuantifierStart(s.peek())) {
    return atom;
  }
  if (atom.kind === 'anchor' || atom.kind === 'lookahead') {
    throw new RegexSyntaxError('Quantifier on an assertion is not supported', true);
  }
  return parseQuantifier(s, atom);
}

function parseAlternative(s: Scanner): RegexNode {
  const items: RegexNode[] = [];
  while (!s.eof() && s.peek() !== 0x7c && s.peek() !== 0x29) {
    items.push(parseTerm(s));
  }
  if (items.length === 0) return {kind: 'empty'};
  if (items.length === 1) return items[0];
  return {kind: 'concat', items};
}

function parseDisjunction(s: Scanner): RegexNode {
  const branches: RegexNode[] = [parseAlternative(s)];
  while (s.eat(0x7c)) {
    branches.push(parseAlternative(s));
  }
  if (branches.length === 1) return branches[0];
  return {kind: 'alt', branches};
}

/** Parses an A2UI regex pattern into a `RegexNode` AST or throws `RegexSyntaxError`. */
export function parseRegexSubset(pattern: string): RegexNode {
  const s = new Scanner(toCodePoints(pattern));
  const tree = parseDisjunction(s);
  if (!s.eof()) {
    throw new RegexSyntaxError('Unmatched closing parenthesis', false);
  }
  return tree;
}

/** Strips outer `group` wrappers from `node`. */
export function unwrap(node: RegexNode): RegexNode {
  let curr = node;
  while (curr.kind === 'group') {
    curr = curr.child;
  }
  return curr;
}

/** Returns true if `node` can match the empty string (`""`). */
export function nullable(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'anchor':
    case 'lookahead':
      return true;
    case 'charSet':
      return false;
    case 'group':
      return nullable(node.child);
    case 'repeat':
      return node.min === 0 || nullable(node.child);
    case 'concat':
      return node.items.every(nullable);
    case 'alt':
      return node.branches.some(nullable);
  }
}

/** Returns the normalized set of code points that can start a non-empty match of `node`. */
export function first(node: RegexNode): readonly CodePointRange[] {
  switch (node.kind) {
    case 'empty':
    case 'anchor':
    case 'lookahead':
      return [];
    case 'charSet':
      return node.ranges;
    case 'group':
      return first(node.child);
    case 'repeat':
      return node.max === 0 ? [] : first(node.child);
    case 'alt':
      return normalizeRanges(node.branches.flatMap(first));
    case 'concat': {
      const acc: CodePointRange[] = [];
      for (const item of node.items) {
        acc.push(...first(item));
        if (!nullable(item)) break;
      }
      return normalizeRanges(acc);
    }
  }
}

/** Returns the normalized union of all character sets consumed in `node` outside lookaheads. */
export function chars(node: RegexNode): readonly CodePointRange[] {
  switch (node.kind) {
    case 'empty':
    case 'anchor':
    case 'lookahead':
      return [];
    case 'charSet':
      return node.ranges;
    case 'group':
      return chars(node.child);
    case 'repeat':
      return node.max === 0 ? [] : chars(node.child);
    case 'concat':
      return normalizeRanges(node.items.flatMap(chars));
    case 'alt':
      return normalizeRanges(node.branches.flatMap(chars));
  }
}

/** Returns true if `node` or any descendant contains a quantifier with `max === null`. */
export function hasUnbounded(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'charSet':
    case 'anchor':
      return false;
    case 'group':
    case 'lookahead':
      return hasUnbounded(node.child);
    case 'repeat':
      return node.max === null || hasUnbounded(node.child);
    case 'concat':
      return node.items.some(hasUnbounded);
    case 'alt':
      return node.branches.some(hasUnbounded);
  }
}

function hasNestedQuantifier(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'charSet':
    case 'anchor':
      return false;
    case 'group':
    case 'lookahead':
      return hasNestedQuantifier(node.child);
    case 'repeat':
      if ((node.max === null || node.max > 1) && hasUnbounded(node.child)) {
        return true;
      }
      return hasNestedQuantifier(node.child);
    case 'concat':
      return node.items.some(hasNestedQuantifier);
    case 'alt':
      return node.branches.some(hasNestedQuantifier);
  }
}

function branchesOverlap(branches: readonly RegexNode[]): boolean {
  const firstSets = branches.map(b => first(unwrap(b)));
  for (let i = 0; i < firstSets.length; i++) {
    for (let j = i + 1; j < firstSets.length; j++) {
      if (rangesOverlap(firstSets[i], firstSets[j])) return true;
    }
  }
  return false;
}

function hasOverlappingAlternation(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'charSet':
    case 'anchor':
      return false;
    case 'group':
    case 'lookahead':
      return hasOverlappingAlternation(node.child);
    case 'repeat': {
      const inner = unwrap(node.child);
      if (node.max === null && inner.kind === 'alt' && branchesOverlap(inner.branches)) {
        return true;
      }
      return hasOverlappingAlternation(node.child);
    }
    case 'concat':
      return node.items.some(hasOverlappingAlternation);
    case 'alt':
      return node.branches.some(hasOverlappingAlternation);
  }
}

function concatHasAdjacentOverlap(items: readonly RegexNode[]): boolean {
  for (let i = 0; i < items.length; i++) {
    const ux = unwrap(items[i]);
    if (ux.kind !== 'repeat' || ux.max !== null) continue;
    const xChars = chars(ux.child);
    for (let j = i + 1; j < items.length; j++) {
      const uy = unwrap(items[j]);
      if (uy.kind === 'repeat' && uy.max === null && rangesOverlap(xChars, chars(uy.child))) {
        return true;
      }
      if (!nullable(items[j])) break;
    }
  }
  return false;
}

function hasAdjacentOverlap(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'charSet':
    case 'anchor':
      return false;
    case 'group':
    case 'lookahead':
    case 'repeat':
      return hasAdjacentOverlap(node.child);
    case 'concat':
      return concatHasAdjacentOverlap(node.items) || node.items.some(hasAdjacentOverlap);
    case 'alt':
      return node.branches.some(hasAdjacentOverlap);
  }
}

/** Checks the 4 static safety rules on a parsed `RegexNode` AST. Returns `null` if safe. */
export function checkRegexSafety(pattern: string, tree: RegexNode): RegexRejection | null {
  if (countCodePoints(pattern) > MAX_REGEX_PATTERN_CODE_POINTS) {
    return 'PATTERN_TOO_LONG';
  }
  if (hasNestedQuantifier(tree)) {
    return 'NESTED_QUANTIFIER';
  }
  if (hasOverlappingAlternation(tree)) {
    return 'OVERLAPPING_ALTERNATION';
  }
  if (hasAdjacentOverlap(tree)) {
    return 'ADJACENT_OVERLAP';
  }
  return null;
}

/**
 * Parses `pattern` against the A2UI portable regex subset and evaluates the 4 static
 * safety rules.
 */
export function analyzeRegex(pattern: string): RegexAnalysisResult {
  if (countCodePoints(pattern) > MAX_REGEX_PATTERN_CODE_POINTS) {
    return {
      ok: false,
      reason: 'PATTERN_TOO_LONG',
      detail: `Pattern exceeds maximum length of ${MAX_REGEX_PATTERN_CODE_POINTS} code points`,
    };
  }
  let tree: RegexNode;
  try {
    tree = parseRegexSubset(pattern);
  } catch (err) {
    if (err instanceof RegexSyntaxError) {
      return {
        ok: false,
        reason: err.unsupported ? 'UNSUPPORTED_SYNTAX' : 'SYNTAX',
        detail: err.message,
      };
    }
    throw err;
  }
  const safetyRejection = checkRegexSafety(pattern, tree);
  if (safetyRejection !== null) {
    return {
      ok: false,
      reason: safetyRejection,
      detail: `Unsafe regex pattern (${safetyRejection})`,
    };
  }
  return {ok: true, tree};
}

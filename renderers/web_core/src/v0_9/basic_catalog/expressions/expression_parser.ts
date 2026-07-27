/*
 * Copyright 2025 Google LLC
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

import {DynamicValue} from '../../schema/common-types.js';
import {A2uiExpressionError} from '../../errors.js';

/**
 * A parser for A2UI expressions, supporting string interpolation and functional calls.
 *
 * The parser converts strings with `${...}` placeholders into arrays of `DynamicValue`s.
 * It supports literals (strings, numbers, booleans), path-based data bindings, and
 * nested function calls with named arguments.
 */
export class ExpressionParser {
  /** The maximum allowed recursion depth for nested expressions to prevent stack overflows. */
  private static readonly MAX_DEPTH = 10;

  /**
   * Parses an input string into an array of DynamicValues.
   * If the input contains no interpolation, it returns the raw string as a single literal.
   */
  public parse(input: string, depth = 0): DynamicValue[] {
    if (depth > ExpressionParser.MAX_DEPTH) {
      throw new A2uiExpressionError('Max recursion depth reached in parse');
    }
    if (!input || !input.includes('${')) {
      return [input];
    }

    const parts: DynamicValue[] = [];
    const scanner = new Scanner(input);

    while (!scanner.isAtEnd()) {
      if (scanner.matches('${')) {
        scanner.advance(2);
        const content = this.extractInterpolationContent(scanner);
        const parsed = this.parseExpression(content, depth + 1);
        if (parsed !== null) {
          parts.push(parsed);
        }
      } else if (scanner.peek() === '\\' && scanner.peek(1) === '$' && scanner.peek(2) === '{') {
        scanner.advance();
        parts.push('${');
        scanner.advance(2);
      } else {
        const start = scanner.pos;
        while (!scanner.isAtEnd()) {
          if (scanner.matches('${')) {
            break;
          }
          if (scanner.peek() === '\\' && scanner.peek(1) === '$' && scanner.peek(2) === '{') {
            break;
          }
          scanner.advance();
        }
        parts.push(scanner.input.substring(start, scanner.pos));
      }
    }
    return parts.filter(p => p !== null && p !== '') as DynamicValue[];
  }

  private extractInterpolationContent(scanner: Scanner): string {
    const start = scanner.pos;
    let braceBalance = 1;

    while (!scanner.isAtEnd() && braceBalance > 0) {
      const char = scanner.advance();
      if (char === '{') {
        braceBalance++;
      } else if (char === '}') {
        braceBalance--;
      } else if (char === "'" || char === '"') {
        const quote = char;
        while (!scanner.isAtEnd()) {
          const c = scanner.advance();
          if (c === '\\') {
            scanner.advance();
          } else if (c === quote) {
            break;
          }
        }
      }
    }

    if (braceBalance > 0) {
      throw new A2uiExpressionError("Unclosed interpolation: missing '}'");
    }

    return scanner.input.substring(start, scanner.pos - 1);
  }

  /**
   * Parses a single expression string into a DynamicValue.
   *
   * Unlike `parse()`, which handles mixed literal text and interpolations,
   * this assumes the entire string is a single expression (e.g., as found inside `${...}`).
   *
   * @param expr The expression string to parse.
   * @param depth The current recursion depth.
   * @returns The resolved DynamicValue.
   */
  public parseExpression(expr: string, depth = 0): DynamicValue {
    expr = expr.trim();
    if (!expr) return '';

    const scanner = new Scanner(expr);
    const result = this.parseExpressionInternal(scanner, depth);
    if (!scanner.isAtEnd()) {
      throw new A2uiExpressionError(
        `Unexpected characters at end of expression: '${scanner.input.substring(scanner.pos)}'`,
      );
    }
    return result;
  }

  private parseExpressionInternal(scanner: Scanner, depth: number): DynamicValue {
    scanner.skipWhitespace();
    if (scanner.isAtEnd()) return '';

    // 0. Nested Interpolation (Block)
    if (scanner.matches('${')) {
      scanner.advance(2);
      const content = this.extractInterpolationContent(scanner);
      return this.parseExpression(content, depth + 1);
    }

    // 1. Literals
    if (scanner.matchesString("'") || scanner.matchesString('"')) {
      return this.parseStringLiteral(scanner);
    }
    if (this.isDigit(scanner.peek())) {
      return this.parseNumberLiteral(scanner);
    }
    if (scanner.matchesKeyword('true')) return true;
    if (scanner.matchesKeyword('false')) return false;
    if (scanner.matchesKeyword('null')) return '';

    // 2. Identifiers (Function calls or Path starts)
    const token = this.scanPathOrIdentifier(scanner);
    scanner.skipWhitespace();

    if (scanner.peek() === '(') {
      return this.parseFunctionCall(token, scanner, depth);
    } else {
      if (!token) {
        return '';
      }
      return {path: token};
    }
  }

  private scanPathOrIdentifier(scanner: Scanner): string {
    const start = scanner.pos;
    while (!scanner.isAtEnd()) {
      const c = scanner.peek();
      if (this.isAlnum(c) || c === '/' || c === '.' || c === '_' || c === '-') {
        scanner.advance();
      } else {
        break;
      }
    }
    return scanner.input.substring(start, scanner.pos);
  }

  private parseFunctionCall(
    funcName: string,
    scanner: Scanner,
    depth: number,
  ): {call: string; args: Record<string, any>; returnType: 'any'} {
    scanner.match('(');
    scanner.skipWhitespace();

    const args: Record<string, any> = {};

    while (!scanner.isAtEnd() && scanner.peek() !== ')') {
      const argName = this.scanIdentifier(scanner);
      scanner.skipWhitespace();
      if (!scanner.match(':')) {
        throw new A2uiExpressionError(
          `Expected ':' after argument name '${argName}' in function '${funcName}'`,
        );
      }
      scanner.skipWhitespace();

      args[argName] = this.parseExpressionInternal(scanner, depth);

      scanner.skipWhitespace();
      if (scanner.peek() === ',') {
        scanner.advance();
        scanner.skipWhitespace();
      }
    }

    if (!scanner.match(')')) {
      throw new A2uiExpressionError(`Expected ')' after function arguments for '${funcName}'`);
    }

    return {call: funcName, args, returnType: 'any'};
  }

  private scanIdentifier(scanner: Scanner): string {
    const start = scanner.pos;
    while (!scanner.isAtEnd() && (this.isAlnum(scanner.peek()) || scanner.peek() === '_')) {
      scanner.advance();
    }
    return scanner.input.substring(start, scanner.pos);
  }

  private parseStringLiteral(scanner: Scanner): string {
    const quote = scanner.advance();
    let result = '';
    while (!scanner.isAtEnd()) {
      const c = scanner.advance();
      if (c === '\\') {
        const next = scanner.advance();
        if (next === 'n') result += '\n';
        else if (next === 't') result += '\t';
        else if (next === 'r') result += '\r';
        else result += next;
      } else if (c === quote) {
        break;
      } else {
        result += c;
      }
    }
    return result;
  }

  private parseNumberLiteral(scanner: Scanner): number {
    const start = scanner.pos;
    while (!scanner.isAtEnd() && (this.isDigit(scanner.peek()) || scanner.peek() === '.')) {
      scanner.advance();
    }
    return Number(scanner.input.substring(start, scanner.pos));
  }

  private isAlnum(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
  }

  private isDigit(c: string): boolean {
    return c >= '0' && c <= '9';
  }
}

class Scanner {
  pos = 0;
  constructor(public input: string) {}

  isAtEnd(): boolean {
    return this.pos >= this.input.length;
  }

  peek(offset = 0): string {
    if (this.pos + offset >= this.input.length) return '\0';
    return this.input[this.pos + offset];
  }

  advance(count = 1): string {
    const char = this.input.substring(this.pos, this.pos + count);
    this.pos += count;
    return char;
  }

  match(expected: string): boolean {
    if (this.peek() === expected) {
      this.advance();
      return true;
    }
    return false;
  }

  matches(expected: string): boolean {
    if (this.input.startsWith(expected, this.pos)) {
      return true;
    }
    return false;
  }

  matchesString(expected: string): boolean {
    return this.peek() === expected;
  }

  matchesKeyword(keyword: string): boolean {
    if (this.input.startsWith(keyword, this.pos)) {
      const next = this.peek(keyword.length);
      if (!/[a-zA-Z0-9_]/.test(next)) {
        this.advance(keyword.length);
        return true;
      }
    }
    return false;
  }

  skipWhitespace() {
    while (!this.isAtEnd() && /\s/.test(this.peek())) {
      this.advance();
    }
  }
}

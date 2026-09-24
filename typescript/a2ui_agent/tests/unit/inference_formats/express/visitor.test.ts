/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {CharStream, CommonTokenStream} from 'antlr4ng';
import {describe, expect, it} from 'vitest';

import {ExpressLexer} from '../../../../src/inference_formats/express/generated/ExpressLexer.js';
import {ExpressParser} from '../../../../src/inference_formats/express/generated/ExpressParser.js';
import {
  ExpressAstVisitor,
  type ExpressStatement,
  type ExpressErrorRecord,
  parseExpress,
  unescapeString,
} from '../../../../src/inference_formats/express/visitor.js';

interface VisitorTestCase {
  name: string;
  source: string;
  expected: {
    errors: ExpressErrorRecord[];
    statements: ExpressStatement[];
  };
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/visitor_cases.json');

// visitor_cases.json records the output of main's Python visitor; see fixtures/README.md.
const testCases: VisitorTestCase[] = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('Express AST visitor and parser', () => {
  describe('oracle parity fixture corpus', () => {
    for (const testCase of testCases) {
      it(`matches oracle for case: ${testCase.name}`, () => {
        const result = parseExpress(testCase.source);

        // Statements must match the oracle exactly
        expect(result.statements).toEqual(testCase.expected.statements);

        // Error counts and metadata must match exactly
        expect(result.errors).toHaveLength(testCase.expected.errors.length);
        for (let i = 0; i < result.errors.length; i++) {
          const [actualLine, actualCol, actualMsg, actualIsLexer] = result.errors[i];
          const [expLine, expCol, expMsg, expIsLexer] = testCase.expected.errors[i];
          expect(actualLine).toBe(expLine);
          expect(actualCol).toBe(expCol);
          expect(actualIsLexer).toBe(expIsLexer);

          // Error message texts match Python antlr4 exactly
          expect(actualMsg).toBe(expMsg);
        }
      });
    }
  });

  describe('string unescaping', () => {
    it('resolves standard escape sequences', () => {
      expect(unescapeString('hello\\nworld')).toBe('hello\nworld');
      expect(unescapeString('tab\\ttab')).toBe('tab\ttab');
      expect(unescapeString('return\\rreturn')).toBe('return\rreturn');
      expect(unescapeString('quote\\"quote')).toBe('quote"quote');
      expect(unescapeString('slash\\\\slash')).toBe('slash\\slash');
    });

    it('preserves non-standard escapes as literals', () => {
      expect(unescapeString('hello\\aworld')).toBe('hello\\aworld');
      expect(unescapeString('hello\\zworld')).toBe('hello\\zworld');
    });

    it('preserves unicode astral characters without splitting surrogate pairs', () => {
      expect(unescapeString('emoji \\🚀 and \\🎉')).toBe('emoji \\🚀 and \\🎉');
    });
  });

  describe('visitor error-isolation and exception swallowing', () => {
    it('silently drops a statement that throws inside visitor while keeping others', () => {
      // Python visitor.py:69-70 swallows exceptions thrown during stmt visit
      const source = 'first = 1\nbroken = 2\nthird = 3';
      const lexer = new ExpressLexer(CharStream.fromString(source));
      const parser = new ExpressParser(new CommonTokenStream(lexer));
      const tree = parser.program();

      const visitor = new ExpressAstVisitor();
      // Directly monkey-patch visitAssignment on instance to throw for 'broken'
      const origAssignment = visitor.visitAssignment;
      visitor.visitAssignment = ctx => {
        if (ctx.identifier()?.getText() === 'broken') {
          throw new Error('Simulated failure');
        }
        return origAssignment(ctx);
      };

      const statements = visitor.visit(tree);
      expect(statements).toEqual([
        ['ASSIGN', 'first', 1],
        ['ASSIGN', 'third', 3],
      ]);
    });
  });
});

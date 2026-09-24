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

import {describe, it, expect, vi} from 'vitest';
import {ExpressParser} from '../../../../src/inference_formats/express/parser.js';
import {ExpressCompiler} from '../../../../src/inference_formats/express/compiler.js';
import {basicCatalog} from '../../../../src/types.js';
import {
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
} from '../../../../src/errors.js';
import {
  ExpressCompilerError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressValidationError,
} from '../../../../src/inference_formats/express/errors.js';
import {RawResponsePart} from '../../../../src/parser/response_part.js';

describe('ExpressParser', () => {
  const catalog = basicCatalog('v1.0');
  const parser = new ExpressParser(catalog, 'main', 'v1.0');

  describe('unwrap', () => {
    it('unwraps empty content to empty array', () => {
      expect(parser.unwrap('')).toEqual([]);
    });

    it('unwraps conversational text without tags to a text part', () => {
      // Oracle: oracle.sh parse_response ... <<< "I need the city name before I can draw the forecast."
      const parts = parser.unwrap('I need the city name before I can draw the forecast.');
      expect(parts).toEqual([
        {
          type: 'text',
          text: 'I need the city name before I can draw the forecast.',
          isFinal: true,
        },
      ]);
    });

    it('unwraps a closed a2ui block to an a2ui part', () => {
      const input = '<a2ui>\nroot = Text("Hello")\n</a2ui>';
      const parts = parser.unwrap(input);
      expect(parts).toEqual([
        {
          type: 'a2ui',
          a2uiRaw: 'root = Text("Hello")',
          isFinal: true,
        },
      ]);
    });

    it('unwraps unterminated block as not final', () => {
      const input = '<a2ui>\nroot = Card(body)\nbody = Text("Hello")';
      const parts = parser.unwrap(input);
      expect(parts).toEqual([
        {
          type: 'a2ui',
          a2uiRaw: 'root = Card(body)\nbody = Text("Hello")',
          isFinal: false,
        },
      ]);
    });

    it('preserves order of text and blocks', () => {
      const input = 'First text\n<a2ui>\nroot = Text("1")\n</a2ui>\nSecond text';
      const parts = parser.unwrap(input);
      expect(parts).toEqual([
        {type: 'text', text: 'First text', isFinal: true},
        {type: 'a2ui', a2uiRaw: 'root = Text("1")', isFinal: true},
        {type: 'text', text: 'Second text', isFinal: true},
      ]);
    });
  });

  describe('hasA2uiParts', () => {
    it('returns true when a complete block exists', () => {
      expect(parser.hasA2uiParts('<a2ui>\nroot = Text("Hi")\n</a2ui>')).toBe(true);
    });

    it('returns false when block is unterminated', () => {
      expect(parser.hasA2uiParts('<a2ui>\nroot = Text("Hi")')).toBe(false);
    });

    it('returns false when no block exists', () => {
      expect(parser.hasA2uiParts('No tags here')).toBe(false);
    });
  });

  describe('compile and error wrapping', () => {
    it('compiles valid Express DSL into messages', () => {
      // Oracle: oracle.sh compile <<< 'root = Text("Hello")'
      const messages = parser.compile('root = Text("Hello")');
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
      ]);
    });

    it('wraps ExpressValidationError as A2uiCompilationValidationError', () => {
      // Oracle: oracle.sh compile <<< 'root = Text("hi", invalid_prop="no")'
      // message: "Property 'invalid_prop' is not a valid property of component 'Text'. - Help: Component 'Text' accepts properties: text, variant."
      try {
        parser.compile('root = Text("hi", invalid_prop="no")');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(A2uiCompilationValidationError);
        const err = e as A2uiCompilationValidationError;
        expect(err.name).toBe('A2uiCompilationValidationError');
        expect(err.line).toBeUndefined();
        expect(err.column).toBeUndefined();
        expect(err.helpMessage).toBe("Component 'Text' accepts properties: text, variant, weight.");
        expect(err.cause).toBeInstanceOf(ExpressValidationError);
      }
    });

    it('wraps ExpressSyntaxError as A2uiCompilationParseError with line, col, and default help', () => {
      // Oracle: oracle.sh compile <<< '@'
      // error: "A2uiCompilationParseError"
      // message: "Syntax error at line 1:0: token recognition error at: '@' (line 1) - Line 1, Col 0 - Help: Please correct the syntax error in your Express DSL."
      // help_message: "Please correct the syntax error in your Express DSL."
      try {
        parser.compile('@');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(A2uiCompilationParseError);
        const err = e as A2uiCompilationParseError;
        expect(err.name).toBe('A2uiCompilationParseError');
        expect(err.line).toBe(1);
        expect(err.column).toBe(0);
        expect(err.helpMessage).toBe('Please correct the syntax error in your Express DSL.');
        expect(err.detail).toContain('(line 1)');
        expect(err.cause).toBeInstanceOf(ExpressSyntaxError);
      }
    });

    it('wraps ExpressParseError as A2uiCompilationParseError', () => {
      // Oracle: oracle.sh compile <<< 'x = Text("hi")'
      // error: "A2uiCompilationParseError"
      // message: "Root target 'root' is not defined. - Help: Ensure root component 'root' is assigned in your Express DSL."
      try {
        parser.compile('');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(A2uiCompilationParseError);
        const err = e as A2uiCompilationParseError;
        expect(err.name).toBe('A2uiCompilationParseError');
        expect(err.line).toBeUndefined();
        expect(err.column).toBeUndefined();
        expect(err.helpMessage).toBe(
          "Ensure root component 'root' is assigned in your Express DSL.",
        );
        expect(err.cause).toBeInstanceOf(ExpressParseError);
      }
    });

    it('wraps an error whose cause is ExpressSyntaxError into A2uiCompilationParseError', () => {
      const syntaxCause = new ExpressSyntaxError('Token mismatch', 4, 12, false);
      const customCompilerErr = new ExpressCompilerError('Parsing failed');
      (customCompilerErr as {cause?: unknown}).cause = syntaxCause;

      const spy = vi.spyOn(ExpressCompiler.prototype, 'compile').mockImplementationOnce(() => {
        throw customCompilerErr;
      });

      try {
        parser.compile('anything');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(A2uiCompilationParseError);
        const err = e as A2uiCompilationParseError;
        expect(err.line).toBe(4);
        expect(err.column).toBe(12);
        expect(err.cause).toBe(customCompilerErr);
      } finally {
        spy.mockRestore();
      }
    });

    it('wraps a generic ExpressCompilerError into A2uiCompilationError', () => {
      const genericErr = new ExpressCompilerError('General issue', 'Fix it');
      const spy = vi.spyOn(ExpressCompiler.prototype, 'compile').mockImplementationOnce(() => {
        throw genericErr;
      });

      try {
        parser.compile('anything');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(A2uiCompilationError);
        expect(e).not.toBeInstanceOf(A2uiCompilationParseError);
        expect(e).not.toBeInstanceOf(A2uiCompilationValidationError);
        const err = e as A2uiCompilationError;
        expect(err.name).toBe('A2uiCompilationError');
        expect(err.helpMessage).toBe('Fix it');
        expect(err.cause).toBe(genericErr);
      } finally {
        spy.mockRestore();
      }
    });

    it('propagates non-ExpressCompilerError exceptions unchanged', () => {
      const plainError = new TypeError('Something unexpected');
      expect(() => {
        try {
          throw plainError;
        } catch (e) {
          if (e instanceof ExpressCompilerError) {
            // would wrap
          }
          throw e;
        }
      }).toThrow(plainError);
    });
  });

  describe('decompile and wrap', () => {
    it('decompile delegates to ExpressDecompiler', () => {
      const messages = [
        {
          version: 'v1.0' as const,
          createSurface: {
            surfaceId: 'main',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
      ];
      const dsl = parser.decompile(messages);
      expect(dsl).toBe('surface("main")\nroot = Text("Hello")');
    });

    it('wrap writes text and a2ui blocks in order', () => {
      const blocks: RawResponsePart[] = [
        {type: 'text', text: 'Here is the greeting.', isFinal: true},
        {type: 'a2ui', a2uiRaw: 'root = Text("Hello")', isFinal: true},
      ];
      const wrapped = parser.wrap(blocks);
      expect(wrapped).toBe('Here is the greeting.\n<a2ui>\nroot = Text("Hello")\n</a2ui>');
    });

    it('wrapDecompiledBlocks surrounds blocks with sentinel tags', () => {
      const wrapped = parser.wrapDecompiledBlocks(['root = Text("Hello")']);
      expect(wrapped).toBe('<a2ui>\nroot = Text("Hello")\n</a2ui>');
    });
  });

  describe('streaming', () => {
    it('has supportsStreaming equal to false', () => {
      expect(parser.supportsStreaming).toBe(false);
    });

    it('throws when parseChunk is called', () => {
      expect(() => parser.parseChunk('chunk')).toThrow(
        'Streaming is not supported by ExpressParser',
      );
    });
  });
});

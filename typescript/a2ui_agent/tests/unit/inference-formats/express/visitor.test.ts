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

import {CharStream, CommonTokenStream} from 'antlr4ng';
import {describe, expect, it} from 'vitest';

import {ExpressLexer} from '../../../../src/inference-formats/express/generated/ExpressLexer.js';
import {ExpressParser} from '../../../../src/inference-formats/express/generated/ExpressParser.js';
import {
  ExpressAstVisitor,
  type ExpressStatement,
  parseExpress,
  unescapeString,
} from '../../../../src/inference-formats/express/visitor.js';

/** A source that parses without errors, and the statements it produces. */
interface VisitorCase {
  name: string;
  source: string;
  statements: ExpressStatement[];
}

describe('Express AST visitor and parser', () => {
  describe('parses comments, whitespace and separators', () => {
    it.each([
      {name: 'an empty input', source: '', statements: []},
      {name: 'whitespace only', source: '   \n\t  \n', statements: []},
      {
        name: 'a # comment before a statement',
        source: '# This is a comment\nroot = Text("hi")',
        statements: [['ASSIGN', 'root', {call: 'Text', args: ['hi']}]],
      },
      {
        name: 'a // comment before a statement',
        source: '// This is a slash comment\nroot = Text("hi")',
        statements: [['ASSIGN', 'root', {call: 'Text', args: ['hi']}]],
      },
      {
        name: 'a block comment before a statement',
        source: '/* multi\nline\ncomment */\nroot = Text("hi")',
        statements: [['ASSIGN', 'root', {call: 'Text', args: ['hi']}]],
      },
      {
        name: 'statements separated by semicolons',
        source: 'a = 1; b = 2; c = 3',
        statements: [
          ['ASSIGN', 'a', 1],
          ['ASSIGN', 'b', 2],
          ['ASSIGN', 'c', 3],
        ],
      },
      {
        name: 'trailing semicolons',
        source: 'root = Text("hi");;;;\n',
        statements: [['ASSIGN', 'root', {call: 'Text', args: ['hi']}]],
      },
      {
        name: 'a statement spread over several lines',
        source:
          'root = Column(\n  [\n    Text("First"),\n    Text("Second")\n  ],\n  spacing=16\n)',
        statements: [
          [
            'ASSIGN',
            'root',
            {
              call: 'Column',
              args: [
                [
                  {call: 'Text', args: ['First']},
                  {call: 'Text', args: ['Second']},
                ],
              ],
              kwargs: {spacing: 16},
            },
          ],
        ],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses assignments', () => {
    it.each([
      {
        name: 'a component holding variable references',
        source: 'root = Column([title, content])',
        statements: [
          [
            'ASSIGN',
            'root',
            {call: 'Column', args: [[{variable: 'title'}, {variable: 'content'}]]},
          ],
        ],
      },
      {
        name: 'a map',
        source: 'config = {theme: "dark", showHeader: true, count: 5}',
        statements: [['ASSIGN', 'config', {theme: 'dark', showHeader: true, count: 5}]],
      },
      {
        name: 'a list of mixed values',
        source: 'items = [1, "two", true, null]',
        statements: [['ASSIGN', 'items', [1, 'two', true, null]]],
      },
      {name: 'an integer', source: 'count = 42', statements: [['ASSIGN', 'count', 42]]},
      {name: 'a negative integer', source: 'offset = -17', statements: [['ASSIGN', 'offset', -17]]},
      {name: 'a float', source: 'ratio = 3.14159', statements: [['ASSIGN', 'ratio', 3.14159]]},
      {name: 'a negative float', source: 'temp = -0.5', statements: [['ASSIGN', 'temp', -0.5]]},
      {name: 'true', source: 'isActive = true', statements: [['ASSIGN', 'isActive', true]]},
      {name: 'false', source: 'isDisabled = false', statements: [['ASSIGN', 'isDisabled', false]]},
      {name: 'null', source: 'emptyValue = null', statements: [['ASSIGN', 'emptyValue', null]]},
      {
        name: 'a data path',
        source: 'selectedUser = $/users/active/id',
        statements: [['ASSIGN', 'selectedUser', {path: '/users/active/id'}]],
      },
      {
        name: 'the bare root path',
        source: 'rootPath = $',
        statements: [['ASSIGN', 'rootPath', {path: ''}]],
      },
      {
        name: 'an assignment to a data path',
        source: '$/app/settings/volume = 80',
        statements: [['ASSIGN', '$/app/settings/volume', 80]],
      },
      {
        name: 'an assignment to the bare root path',
        source: '$ = {status: "ok"}',
        statements: [['ASSIGN', '$', {status: 'ok'}]],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses arrays and maps', () => {
    it.each([
      {name: 'an empty array', source: 'emptyList = []', statements: [['ASSIGN', 'emptyList', []]]},
      {
        name: 'an array with one element',
        source: 'single = [1]',
        statements: [['ASSIGN', 'single', [1]]],
      },
      {
        name: 'an array with a trailing comma',
        source: 'colors = ["red", "green", "blue",]',
        statements: [['ASSIGN', 'colors', ['red', 'green', 'blue']]],
      },
      {name: 'an empty map', source: 'emptyMap = {}', statements: [['ASSIGN', 'emptyMap', {}]]},
      {
        name: 'a map with identifier keys',
        source: 'options = {key1: 10, key2: 20}',
        statements: [['ASSIGN', 'options', {key1: 10, key2: 20}]],
      },
      {
        name: 'a map with string keys',
        source: 'headers = {"content-type": "application/json", "x-api-key": "secret"}',
        statements: [
          ['ASSIGN', 'headers', {'content-type': 'application/json', 'x-api-key': 'secret'}],
        ],
      },
      {
        name: 'a map with a trailing comma',
        source: 'coords = {x: 10, y: 20,}',
        statements: [['ASSIGN', 'coords', {x: 10, y: 20}]],
      },
      {
        name: 'arrays and maps nested in each other',
        source: 'matrix = [{row: [1, 2]}, {row: [3, 4]}]',
        statements: [['ASSIGN', 'matrix', [{row: [1, 2]}, {row: [3, 4]}]]],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses calls', () => {
    it.each([
      {
        name: 'a call without arguments',
        source: 'card = Card()',
        statements: [['ASSIGN', 'card', {call: 'Card', args: []}]],
      },
      {
        name: 'a call with positional arguments',
        source: 'label = Text("Hello", "secondary")',
        statements: [['ASSIGN', 'label', {call: 'Text', args: ['Hello', 'secondary']}]],
      },
      {
        name: 'a call with keyword arguments',
        source: 'btn = Button(label="Click", disabled=false)',
        statements: [
          ['ASSIGN', 'btn', {call: 'Button', args: [], kwargs: {label: 'Click', disabled: false}}],
        ],
      },
      {
        name: 'a call mixing positional and keyword arguments, with a trailing comma',
        source: 'btn = Button("Save", variant="primary", elevation=2,)',
        statements: [
          [
            'ASSIGN',
            'btn',
            {call: 'Button', args: ['Save'], kwargs: {variant: 'primary', elevation: 2}},
          ],
        ],
      },
      {
        name: 'a skipped argument',
        source: 'action = Event("submit", _, "onSuccess")',
        statements: [
          ['ASSIGN', 'action', {call: 'Event', args: ['submit', {skipped: true}, 'onSuccess']}],
        ],
      },
      {
        name: 'calls nested in arrays and keyword arguments',
        source: 'layout = Column([Row([Text("A"), Text("B")]), Card(content=Text("C"))])',
        statements: [
          [
            'ASSIGN',
            'layout',
            {
              call: 'Column',
              args: [
                [
                  {
                    call: 'Row',
                    args: [
                      [
                        {call: 'Text', args: ['A']},
                        {call: 'Text', args: ['B']},
                      ],
                    ],
                  },
                  {call: 'Card', args: [], kwargs: {content: {call: 'Text', args: ['C']}}},
                ],
              ],
            },
          ],
        ],
      },
      {
        name: 'an Event call as a keyword argument',
        source: 'btn = Button(onClick=Event("press", action="save"))',
        statements: [
          [
            'ASSIGN',
            'btn',
            {
              call: 'Button',
              args: [],
              kwargs: {onClick: {call: 'Event', args: ['press'], kwargs: {action: 'save'}}},
            },
          ],
        ],
      },
      {
        name: 'a _template call',
        source: 'list = List(template=_template(item, Text(item)))',
        statements: [
          [
            'ASSIGN',
            'list',
            {
              call: 'List',
              args: [],
              kwargs: {
                template: {
                  call: '_template',
                  args: [{variable: 'item'}, {call: 'Text', args: [{variable: 'item'}]}],
                },
              },
            },
          ],
        ],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses checks', () => {
    it.each([
      {
        name: 'a bare check',
        source: 'v = ?required',
        statements: [['ASSIGN', 'v', {check: 'required', args: []}]],
      },
      {
        name: 'a check with empty parentheses',
        source: 'v = ?required()',
        statements: [['ASSIGN', 'v', {check: 'required', args: []}]],
      },
      {
        name: 'a check with an argument',
        source: 'rule = ?minLength(8)',
        statements: [['ASSIGN', 'rule', {check: 'minLength', args: [8]}]],
      },
      {
        name: 'a check with two arguments and a trailing comma',
        source: 'rangeCheck = ?between(1, 100,)',
        statements: [['ASSIGN', 'rangeCheck', {check: 'between', args: [1, 100]}]],
      },
      {
        name: 'a list of checks',
        source: 'rules = [?required, ?email, ?minLength(6)]',
        statements: [
          [
            'ASSIGN',
            'rules',
            [
              {check: 'required', args: []},
              {check: 'email', args: []},
              {check: 'minLength', args: [6]},
            ],
          ],
        ],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses standalone expressions', () => {
    it.each([
      {
        name: 'a surface call',
        source: 'surface("main_surface")',
        statements: [['EXPR', {call: 'surface', args: ['main_surface']}]],
      },
      {
        name: 'a deleteSurface call',
        source: 'deleteSurface("old_surface")',
        statements: [['EXPR', {call: 'deleteSurface', args: ['old_surface']}]],
      },
      {
        name: 'a call to another function',
        source: 'notify("hello", level="warn")',
        statements: [['EXPR', {call: 'notify', args: ['hello'], kwargs: {level: 'warn'}}]],
      },
      {name: 'a bare variable', source: 'myVar', statements: [['EXPR', {variable: 'myVar'}]]},
      {name: 'a bare map', source: '{theme: "light"}', statements: [['EXPR', {theme: 'light'}]]},
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('parses string literals', () => {
    it.each([
      {
        name: 'a triple-quoted string',
        source: 'doc = """line 1\nline 2 with "quotes" and \\t tab"""',
        statements: [['ASSIGN', 'doc', 'line 1\nline 2 with "quotes" and \t tab']],
      },
      {
        name: 'a raw string',
        source: 'regex = r"\\d+\\s+[a-z]"',
        statements: [['ASSIGN', 'regex', '\\d+\\s+[a-z]']],
      },
      {
        name: 'a raw string with an uppercase prefix',
        source: 'regexUpper = R"C:\\Users\\test"',
        statements: [['ASSIGN', 'regexUpper', 'C:\\Users\\test']],
      },
      {
        name: 'a raw triple-quoted string',
        source: 'rawDoc = r"""first \\n second"""',
        statements: [['ASSIGN', 'rawDoc', 'first \\n second']],
      },
      {
        name: 'a raw triple-quoted string with an uppercase prefix',
        source: 'rawDocUpper = R"""first \\t second"""',
        statements: [['ASSIGN', 'rawDocUpper', 'first \\t second']],
      },
    ] as VisitorCase[])('$name', ({source, statements}) => {
      expect(parseExpress(source)).toEqual({statements, errors: []});
    });
  });

  describe('reports syntax errors', () => {
    it('keeps the statements before an unclosed array and reports the line after it', () => {
      expect(parseExpress('a = 1\nb = 2\nc = [broken\nd = 4\ne = 5')).toEqual({
        statements: [
          ['ASSIGN', 'a', 1],
          ['ASSIGN', 'b', 2],
          ['ASSIGN', 'c', [{variable: 'broken'}]],
        ],
        errors: [[4, 0, "mismatched input 'd' expecting {',', ']'}", false]],
      });
    });

    it('drops the statements from the line of a parser error onward', () => {
      expect(parseExpress('a = 1\nb = 2\n= broken\nd = 4\ne = 5')).toEqual({
        statements: [
          ['ASSIGN', 'a', 1],
          ['ASSIGN', 'b', 2],
        ],
        errors: [
          [
            3,
            0,
            "extraneous input '=' expecting {<EOF>, '[', '{', '_', 'null', RAW_TRIPLE_STRING, TRIPLE_STRING, RAW_STRING, STANDARD_STRING, PATH, CHECK, NUMBER, BOOLEAN, IDENTIFIER}",
            false,
          ],
        ],
      });
    });

    it('reports an unexpected character as a lexer error', () => {
      expect(parseExpress('valid = 1\n@invalid = 2')).toEqual({
        statements: [['ASSIGN', 'valid', 1]],
        errors: [[2, 0, "token recognition error at: '@'", true]],
      });
    });

    it('reports a lexer error and a parser error together', () => {
      expect(parseExpress('ok = 1\n~bad_lexer\n broken_parser [')).toEqual({
        statements: [['ASSIGN', 'ok', 1]],
        errors: [
          [2, 0, "token recognition error at: '~'", true],
          [
            3,
            16,
            "mismatched input '<EOF>' expecting {'[', ']', '{', '_', 'null', RAW_TRIPLE_STRING, TRIPLE_STRING, RAW_STRING, STANDARD_STRING, PATH, CHECK, NUMBER, BOOLEAN, IDENTIFIER}",
            false,
          ],
        ],
      });
    });
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

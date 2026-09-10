// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:a2ui_core/src/processing/expressions.dart';
import 'package:test/test.dart';

void main() {
  group('ExpressionParser', () {
    late ExpressionParser parser;

    setUp(() {
      parser = ExpressionParser();
    });

    test('parses literals', () {
      expect(parser.parse('hello'), ['hello']);
    });

    test('parses simple interpolation', () {
      expect(parser.parse('hello \${foo}'), [
        'hello ',
        {'path': 'foo'},
      ]);
    });

    test('parses absolute paths', () {
      expect(parser.parse('value is \${/user/name}'), [
        'value is ',
        {'path': '/user/name'},
      ]);
    });

    test('parses function calls', () {
      expect(parser.parse('sum is \${add(a: 10, b: 20)}'), [
        'sum is ',
        {
          'call': 'add',
          'args': {'a': 10, 'b': 20},
          'returnType': 'any',
        },
      ]);
    });

    test('parses nested interpolation', () {
      expect(parser.parse('\${\${"hello"}}'), ['hello']);
    });

    test('handles escaped interpolation', () {
      expect(parser.parse('escaped \\\${foo}'), ['escaped \${foo}']);
    });

    test('parses complex paths', () {
      expect(parser.parseExpression('my-path.with_underscores'), {
        'path': 'my-path.with_underscores',
      });
    });

    test('parses string literals with spaces', () {
      expect(parser.parseExpression('"hello world"'), 'hello world');
    });

    test('throws on unclosed interpolation', () {
      expect(() => parser.parse('hello \${world'), throwsException);
    });

    test('parses non-ASCII identifiers and paths', () {
      expect(parser.parse(r'${señor}'), [
        {'path': 'señor'},
      ]);
      expect(parser.parse(r'${café/precio}'), [
        {'path': 'café/precio'},
      ]);
      expect(parser.parse(r'${日本}'), [
        {'path': '日本'},
      ]);
      expect(parser.parse(r'hola ${señor} qué tal'), [
        'hola ',
        {'path': 'señor'},
        ' qué tal',
      ]);
    });
  });
}

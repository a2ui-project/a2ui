// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
  });
}

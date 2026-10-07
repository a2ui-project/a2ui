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

import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/primitives/expressions.dart';
import 'package:test/test.dart';

void main() {
  group('ExpressionParser', () {
    late ExpressionParser parser;

    setUp(() {
      parser = ExpressionParser();
    });

    test('returns error on maxDepth exceeded', () {
      expect(
        () => parser.parse('depth', ExpressionParser.maxDepth + 1),
        throwsA(isA<A2uiExpressionError>()),
      );
    });

    test('handles empty identifiers', () {
      expect(parser.parse('\${()}'), [
        {'call': '', 'args': <String, dynamic>{}, 'returnType': 'any'},
      ]);
      expect(parser.parseExpression(''), '');
      expect(parser.parseExpression('()'), {
        'call': '',
        'args': <String, dynamic>{},
        'returnType': 'any',
      });
    });

    test('parses null keyword as null in parseExpression', () {
      expect(parser.parseExpression('null'), isNull);
    });

    test('rejects pathological nesting instead of overflowing the stack', () {
      String nestedCalls(int calls) => '\${${'f(a: ' * calls}1${')' * calls}}';
      String nestedInterpolations(int depth) =>
          '${'\${' * depth}x${'}' * depth}';

      expect(
        parser.parse(nestedCalls(ExpressionParser.maxDepth - 1)),
        hasLength(1),
      );

      // Deep enough to exhaust the stack while the guard was unreachable.
      expect(
        () => parser.parse(nestedCalls(20000)),
        throwsA(isA<A2uiExpressionError>()),
      );
      expect(
        () => parser.parse(nestedInterpolations(20000)),
        throwsA(isA<A2uiExpressionError>()),
      );
    });

    test('rejects template string exceeding maxTemplateLength', () {
      expect(ExpressionParser.maxTemplateLength, 10000);
      final String oversized = 'a' * (ExpressionParser.maxTemplateLength + 1);
      expect(
        () => parser.parse(oversized),
        throwsA(
          isA<A2uiExpressionError>().having(
            (e) => e.message,
            'message',
            contains('exceeds maximum limit'),
          ),
        ),
      );
    });

    test('rejects expression exceeding maxTemplateParts limit', () {
      expect(ExpressionParser.maxTemplateParts, 1000);
      final String manyParts =
          '\${x}' * (ExpressionParser.maxTemplateParts + 1);
      expect(
        () => parser.parse(manyParts),
        throwsA(
          isA<A2uiExpressionError>().having(
            (e) => e.message,
            'message',
            contains('parts count exceeds maximum limit'),
          ),
        ),
      );
    });

    test('throws A2uiExpressionError on trailing backslash before EOF', () {
      for (final input in [r"${'abc\", r'${"abc\']) {
        expect(
          () => parser.parse(input),
          throwsA(
            isA<A2uiExpressionError>().having(
              (e) => e.message,
              'message',
              contains('Unclosed string literal'),
            ),
          ),
          reason: 'parse($input) should throw A2uiExpressionError',
        );
      }

      for (final expr in [r"'abc\", r'"abc\']) {
        expect(
          () => parser.parseExpression(expr),
          throwsA(
            isA<A2uiExpressionError>().having(
              (e) => e.message,
              'message',
              contains('Unclosed string literal'),
            ),
          ),
          reason: 'parseExpression($expr) should throw A2uiExpressionError',
        );
      }
    });

    test('throws A2uiExpressionError on unclosed string literals', () {
      for (final expr in ["'unclosed", '"unclosed', "f(a: 'unclosed)"]) {
        expect(
          () => parser.parseExpression(expr),
          throwsA(
            isA<A2uiExpressionError>().having(
              (e) => e.message,
              'message',
              contains('Unclosed string literal'),
            ),
          ),
          reason: 'parseExpression($expr) should throw A2uiExpressionError',
        );
      }

      for (final input in [r"${'unclosed}", r'${"unclosed}']) {
        expect(
          () => parser.parse(input),
          throwsA(
            isA<A2uiExpressionError>().having(
              (e) => e.message,
              'message',
              contains('Unclosed string literal'),
            ),
          ),
          reason: 'parse($input) should throw A2uiExpressionError',
        );
      }
    });

    test('parses @-prefixed function calls', () {
      expect(parser.parse(r'${@index()}'), [
        {'call': '@index', 'args': <String, dynamic>{}, 'returnType': 'any'},
      ]);
      expect(parser.parse(r'#${@index(offset: 1)}'), [
        '#',
        {
          'call': '@index',
          'args': <String, dynamic>{'offset': 1},
          'returnType': 'any',
        },
      ]);
      expect(parser.parseExpression('@index(offset: 1)'), {
        'call': '@index',
        'args': <String, dynamic>{'offset': 1},
        'returnType': 'any',
      });
    });

    test('rejects bare @ and @ in non-leading or non-function positions', () {
      for (final input in [
        r'${@}',
        r'${@()}',
        r'${@index}',
        r'${@/a}',
        r'${@1}',
        r'${foo@bar()}',
        r'${foo@bar}',
        r'${/a@b}',
      ]) {
        expect(
          () => parser.parse(input),
          throwsA(isA<A2uiExpressionError>()),
          reason: 'parse($input) should throw A2uiExpressionError',
        );
      }

      for (final expr in [
        '@',
        '@()',
        '@index',
        '@/a',
        '@1',
        'foo@bar()',
        'foo@bar',
        '/a@b',
      ]) {
        expect(
          () => parser.parseExpression(expr),
          throwsA(isA<A2uiExpressionError>()),
          reason: 'parseExpression($expr) should throw A2uiExpressionError',
        );
      }
    });

    test('parses ~0 and ~1 JSON Pointer escapes in paths', () {
      expect(parser.parse(r'${/a~1b}'), [
        {'path': '/a~1b'},
      ]);
      expect(parser.parse(r'${/a~0b}'), [
        {'path': '/a~0b'},
      ]);
      expect(parser.parse(r'${/a~0~1b}'), [
        {'path': '/a~0~1b'},
      ]);
      expect(parser.parseExpression('/a~1b'), {'path': '/a~1b'});
      expect(parser.parseExpression('a~0b'), {'path': 'a~0b'});
    });

    test('rejects malformed ~ escapes and ~ in function names', () {
      for (final input in [
        r'${/a~2b}',
        r'${/a~}',
        r'${~}',
        r'${a~b}',
        r'${foo~1bar()}',
        r'${foo~0bar()}',
      ]) {
        expect(
          () => parser.parse(input),
          throwsA(isA<A2uiExpressionError>()),
          reason: 'parse($input) should throw A2uiExpressionError',
        );
      }

      for (final expr in [
        '/a~2b',
        '/a~',
        '~',
        'a~b',
        'foo~1bar()',
        'foo~0bar()',
      ]) {
        expect(
          () => parser.parseExpression(expr),
          throwsA(isA<A2uiExpressionError>()),
          reason: 'parseExpression($expr) should throw A2uiExpressionError',
        );
      }
    });
  });
}

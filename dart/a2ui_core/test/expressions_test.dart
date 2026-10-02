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
import 'package:a2ui_core/src/processing/expressions.dart';
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

    test('parses null keyword as an empty string in parseExpression', () {
      expect(parser.parseExpression('null'), '');
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
  });
}

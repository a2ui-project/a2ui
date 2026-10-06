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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

void main() {
  group('A2uiErrorDetail', () {
    test('stores path, code, and message and serializes to JSON', () {
      const detail = A2uiErrorDetail(
        path: '/components/0/text',
        code: 'INVALID_TYPE',
        message: 'Expected string',
      );

      expect(detail.path, '/components/0/text');
      expect(detail.code, 'INVALID_TYPE');
      expect(detail.message, 'Expected string');
      expect(detail.toJson(), {
        'path': '/components/0/text',
        'code': 'INVALID_TYPE',
        'message': 'Expected string',
      });
    });

    test('implements value equality, hashCode, and toString', () {
      const a = A2uiErrorDetail(
        path: '/components/0',
        code: 'UNALLOWED_CHILD',
        message: 'Child not allowed',
      );
      const b = A2uiErrorDetail(
        path: '/components/0',
        code: 'UNALLOWED_CHILD',
        message: 'Child not allowed',
      );
      const c = A2uiErrorDetail(
        path: '/components/1',
        code: 'UNALLOWED_CHILD',
        message: 'Child not allowed',
      );

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));
      expect(a.toString(), contains('/components/0'));
      expect(a.toString(), contains('UNALLOWED_CHILD'));
      expect(a.toString(), contains('Child not allowed'));
    });
  });

  group('A2uiValidationError', () {
    test('defaults code to VALIDATION_FAILED, path to null, errors to empty',
        () {
      final error = A2uiValidationError('Invalid payload');

      expect(error.message, 'Invalid payload');
      expect(error.code, 'VALIDATION_FAILED');
      expect(error.path, isNull);
      expect(error.errors, isEmpty);
      expect(error.details, isNull);
      expect(error.cause, isNull);
      expect(error.toString(),
          'A2uiValidationError [VALIDATION_FAILED]: Invalid payload');
    });

    test('stores code, path, errors, details, and cause', () {
      const cause = FormatException('bad json');
      const detail = A2uiErrorDetail(
        path: '/components/0/child',
        code: 'UNALLOWED_CHILD',
        message: 'Button cannot contain Card',
      );
      final error = A2uiValidationError(
        'Composition constraint violated',
        code: 'UNALLOWED_CHILD',
        path: '/components/0/child',
        errors: const [detail],
        details: const {'raw': true},
        cause: cause,
      );

      expect(error.message, 'Composition constraint violated');
      expect(error.code, 'UNALLOWED_CHILD');
      expect(error.path, '/components/0/child');
      expect(error.errors, [detail]);
      expect(() => error.errors.add(detail), throwsUnsupportedError);
      expect(error.details, {'raw': true});
      expect(error.cause, same(cause));
      expect(error.toString(), contains('UNALLOWED_CHILD'));
      expect(error.toString(), contains('/components/0/child'));
      expect(error.toString(), contains('Composition constraint violated'));
      expect(error.toString(), contains('bad json'));
    });
  });

  group('A2uiError hierarchy and cause chaining', () {
    test(
        'pins A2uiIntegrityError and A2uiRecursionError under '
        'A2uiValidationError', () {
      final cause = StateError('root cause');
      final integrityError = A2uiIntegrityError(
        'Dangling reference',
        componentIds: const ['c1'],
        path: '/components/0/child',
        cause: cause,
      );
      final recursionError = A2uiRecursionError(
        'Cycle detected',
        cycle: const ['a', 'b', 'a'],
        path: '/components/0',
        cause: cause,
      );

      expect(integrityError, isA<A2uiValidationError>());
      expect(integrityError, isA<A2uiError>());
      expect(integrityError.code, 'INTEGRITY_ERROR');
      expect(integrityError.componentIds, ['c1']);
      expect(
        () => integrityError.componentIds.add('c2'),
        throwsUnsupportedError,
      );
      expect(integrityError.path, '/components/0/child');
      expect(integrityError.cause, same(cause));

      expect(recursionError, isA<A2uiValidationError>());
      expect(recursionError, isA<A2uiError>());
      expect(recursionError.code, 'RECURSION_ERROR');
      expect(recursionError.cycle, ['a', 'b', 'a']);
      expect(() => recursionError.cycle.add('c'), throwsUnsupportedError);
      expect(recursionError.path, '/components/0');
      expect(recursionError.cause, same(cause));
    });

    test('threads cause through all A2uiError subclasses', () {
      final cause = Exception('underlying');

      final baseError = A2uiError('base', cause: cause);
      final catalogError = A2uiCatalogError(
        'catalog',
        catalogId: 'cat-1',
        cause: cause,
      );
      final expressionError = A2uiExpressionError(
        'expr',
        expression: r'${foo}',
        details: 'detail',
        cause: cause,
      );
      final dataError = A2uiDataError(
        'data',
        path: '/a/b',
        cause: cause,
      );
      final stateError = A2uiStateError('state', cause: cause);
      final parseError = A2uiParseError(
        'parse',
        rawContent: '{bad',
        cause: cause,
      );

      for (final err in <A2uiError>[
        baseError,
        catalogError,
        expressionError,
        dataError,
        stateError,
        parseError,
      ]) {
        expect(err.cause, same(cause));
      }

      expect(catalogError.catalogId, 'cat-1');
      expect(expressionError.expression, r'${foo}');
      expect(dataError.path, '/a/b');
      expect(dataError.toString(), contains('(/a/b)'));
      expect(parseError.rawContent, '{bad');
    });
  });
}

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

import 'conformance_harness.dart';

/// Suite-level error categories mapped onto this SDK's exception types.
const Map<String, Type> _categoryToError = {'ParseError': A2uiExpressionError};

/// Joins adjacent literal parts and drops empty ones.
///
/// A template fixes which values a parser produces, not how it happens to
/// split the literal text around them, so both are compared in joined form.
/// An empty literal carries no content either way, and implementations differ
/// on whether they emit one, so it is not something a case should pin.
List<Object?> _joinLiterals(List<Object?> parts) {
  final joined = <Object?>[];
  for (final part in parts) {
    if (part is String && joined.isNotEmpty && joined.last is String) {
      joined[joined.length - 1] = (joined.last as String) + part;
    } else {
      joined.add(part);
    }
  }
  return joined.where((p) => p != '').toList();
}

void main() {
  // The suite's `validate` cases render basic-catalog components on a
  // surface, so `message_processor_conformance_test.dart` runs them.
  final List<ConformanceTestCase> cases = [
    for (final ConformanceTestCase testCase
        in loadConformanceSuite('core/expressions.yaml'))
      if (testCase['action'] != 'validate') testCase,
  ];

  group('expression parser conformance', () {
    late ExpressionParser parser;

    setUp(() {
      parser = ExpressionParser();
    });

    runConformanceSuite(
      cases,
      (testCase) => _runCase(parser, testCase),
    );
  });
}

void _runCase(ExpressionParser parser, ConformanceTestCase testCase) {
  final String action =
      (testCase['action'] as String?) ?? 'parse_expression_template';
  if (action != 'parse_expression_template') {
    fail(
      'Action "$action" in expressions.yaml is not yet supported by '
      'expressions_conformance_test.dart.',
    );
  }
  final input = testCase['input']! as String;
  final Object? expectError =
      testCase['expect_error'] ?? testCase['expectError'];

  if (expectError != null) {
    final error = expectError as Map<String, Object?>;
    final category = error['category'] as String;
    final String message = error['message'] as String? ?? '';
    final Type expectedType = _categoryToError[category] ?? A2uiExpressionError;

    expect(
      () => parser.parse(input),
      throwsA(
        predicate(
          (Object? e) =>
              e.runtimeType == expectedType &&
              RegExp(message).hasMatch(e.toString()),
          'throws $expectedType matching "$message"',
        ),
      ),
    );
    return;
  }

  final expected = testCase['expect']! as List<Object?>;
  expect(_joinLiterals(parser.parse(input)), equals(expected, 1000));
}

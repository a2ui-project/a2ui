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

typedef _RendererCatalog = Catalog<ComponentApi, FunctionImplementation>;

/// Suite-level error categories mapped onto this SDK's exception types.
const Map<String, Type> _categoryToError = {
  'ExpressionError': A2uiExpressionError,
  'ValidationError': A2uiValidationError,
};

/// The reason `validate` cases are skipped: they render basic-catalog
/// components (`Text`, `Column`) on a v1.0 surface and assert resolved
/// component properties, none of which this SDK provides yet.
const String _validateSkipReason = 'Requires basic-catalog components, v1.0 '
    'message processing and resolved component assertions.';

/// The basic catalog a case runs against, chosen by its protocol version.
///
/// A case that names no version runs against v0.9, as in the Python harness,
/// so validators return booleans.
_RendererCatalog _catalogFor(Map<String, Object?> testCase) {
  final String version = caseVersion(testCase) ?? '0.9';
  final String locale = testCase['locale'] as String? ?? 'en-US';
  // Conformance cases only check that a valid URL is accepted, so the
  // callback records nothing.
  void openUrl(Uri _) {}
  return version.startsWith('1')
      ? BasicCatalog.v1_0(locale: locale, openUrl: openUrl)
      : BasicCatalog.v0_9(locale: locale, openUrl: openUrl);
}

Object? _evaluate(Map<String, Object?> testCase) {
  final _RendererCatalog catalog = _catalogFor(testCase);
  final name = testCase['function']! as String;
  final FunctionImplementation? function = catalog.functions[name];
  if (function == null) {
    fail('Function $name is not in ${catalog.id}.');
  }
  final dataModel = DataModel();
  final Object? data = testCase['dataModel'];
  if (data is Map<String, Object?>) {
    for (final MapEntry<String, Object?> entry in data.entries) {
      dataModel.set('/${entry.key}', entry.value);
    }
  }
  final String? version = caseVersion(testCase);
  final context = DataContext(
    dataModel,
    catalog.invoke,
    '/',
    protocolVersion: version == null ? null : 'v$version',
  );
  final args = Map<String, dynamic>.from(
    testCase['args'] as Map<String, Object?>? ?? const {},
  );
  final Object? result = function.execute(args, context);
  return result is ReadonlySignal<Object?> ? result.value : result;
}

void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/functions.yaml',
  );

  group('functions conformance', () {
    for (final testCase in cases) {
      final name = testCase['name']! as String;
      final action = testCase['action']! as String;

      test(name, () {
        switch (action) {
          case 'validate':
            markTestSkipped(_validateSkipReason);
            return;
          case 'evaluate_function':
            final Object? expectError =
                testCase['expectError'] ?? testCase['expect_error'];
            if (expectError is Map<String, Object?>) {
              final category = expectError['category']! as String;
              final Type? expectedType = _categoryToError[category];
              if (expectedType == null) {
                fail('Unmapped error category $category.');
              }
              expect(
                () => _evaluate(testCase),
                throwsA(
                  predicate(
                    (Object? e) => e.runtimeType == expectedType,
                    'throws $expectedType',
                  ),
                ),
              );
              return;
            }
            expect(_evaluate(testCase), equals(testCase['expect']));
          default:
            fail('Unhandled action $action in functions.yaml.');
        }
      });
    }
  });
}

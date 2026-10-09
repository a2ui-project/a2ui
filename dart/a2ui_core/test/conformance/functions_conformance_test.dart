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

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

typedef _RendererCatalog = Catalog<ComponentApi, FunctionImplementation>;

/// Suite-level error categories mapped onto this SDK's exception types.
const Map<String, Type> _categoryToError = {
  'CatalogError': A2uiCatalogError,
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
  return version.startsWith('1')
      ? BasicCatalog.v1_0(locale: _localeOf(testCase), openUrl: _openUrl)
      : BasicCatalog.v0_9(locale: _localeOf(testCase), openUrl: _openUrl);
}

String _localeOf(Map<String, Object?> testCase) =>
    testCase['locale'] as String? ?? 'en-US';

// Conformance cases only check that a valid URL is accepted, so the callback
// records nothing.
void _openUrl(Uri _) {}

/// Sets the case's `dataModel` values on [dataModel] and returns it.
DataModel _withCaseData(DataModel dataModel, Map<String, Object?> testCase) {
  final Object? data = testCase['dataModel'];
  if (data is Map<String, Object?>) {
    for (final MapEntry<String, Object?> entry in data.entries) {
      dataModel.set('/${entry.key}', entry.value);
    }
  }
  return dataModel;
}

Object? _evaluate(Map<String, Object?> testCase) {
  if (testCase['surface'] is Map<String, Object?>) {
    return _evaluateOnSurface(testCase);
  }
  final _RendererCatalog catalog = _catalogFor(testCase);
  final name = testCase['function']! as String;
  final FunctionImplementation? function = catalog.functions[name];
  if (function == null) {
    fail('Function $name is not in ${catalog.id}.');
  }
  final String? version = caseVersion(testCase);
  final context = DataContext(
    _withCaseData(DataModel(), testCase),
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

/// The catalog a document in `catalogPaths` stands for: this SDK's basic
/// catalog for the published basic catalog documents, whose functions run,
/// and otherwise the document's signatures alone.
_RendererCatalog _catalogOf(
  Map<String, Object?> document,
  Map<String, Object?> testCase,
) =>
    switch (document['catalogId']) {
      BasicCatalog.v0_9Id => BasicCatalog.v0_9(
          locale: _localeOf(testCase),
          openUrl: _openUrl,
        ),
      BasicCatalog.v1_0Id => BasicCatalog.v1_0(
          locale: _localeOf(testCase),
          openUrl: _openUrl,
        ),
      _ => rendererCatalog(document),
    };

/// Evaluates a case with a `surface` block as a call on a surface, so the
/// call goes through catalog resolution.
///
/// The surface's available catalogs are those of `catalogPaths` built for
/// the case's protocol version, and `surface.catalogId` names its default.
/// The case-level `catalogId` is the one the call names.
Object? _evaluateOnSurface(Map<String, Object?> testCase) {
  final version = 'v${caseVersion(testCase)!}';
  final bool atLeastV1 =
      A2uiProtocolVersion.fromJson(version).isAtLeast(A2uiProtocolVersion.v1_0);
  final List<_RendererCatalog> available = [
    for (final Object? path in testCase['catalogPaths']! as List<Object?>)
      if (readConformanceJson(path! as String) case final document
          when isAtLeastV1CatalogDocument(document) == atLeastV1)
        _catalogOf(document, testCase),
  ];
  final surfaceBlock = testCase['surface']! as Map<String, Object?>;
  final defaultId = surfaceBlock['catalogId'] as String?;
  final surface = SurfaceModel<ComponentApi>(
    'conformance',
    defaultCatalog: defaultId == null
        ? null
        : available.firstWhere((catalog) => catalog.id == defaultId),
    availableCatalogs: available,
    protocolVersion: version,
  );
  addTearDown(surface.dispose);

  final context = DataContext(
    _withCaseData(surface.dataModel, testCase),
    (name, args, context) =>
        surface.resolveCatalog(null).invoke(name, args, context),
    '/',
    protocolVersion: version,
    invokerForCatalog: (catalogId) => surface.resolveCatalog(catalogId).invoke,
  );
  return context.resolveSync(<String, Object?>{
    atLeastV1 ? '@call' : 'call': testCase['function'],
    if (testCase['catalogId'] case final String catalogId)
      'catalogId': catalogId,
    'args': testCase['args'] ?? const <String, Object?>{},
  });
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
              final message = expectError['message'] as String?;
              expect(
                () => _evaluate(testCase),
                throwsA(
                  predicate(
                    (Object? e) {
                      final bool matchesType = switch (category) {
                        'CatalogError' => e is A2uiCatalogError,
                        'ExpressionError' => e is A2uiExpressionError,
                        'ValidationError' => e is A2uiValidationError,
                        _ => e.runtimeType == expectedType,
                      };
                      return matchesType &&
                          (message == null ||
                              RegExp(message)
                                  .hasMatch((e! as A2uiError).message));
                    },
                    'throws $expectedType'
                    '${message == null ? '' : " matching '$message'"}',
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

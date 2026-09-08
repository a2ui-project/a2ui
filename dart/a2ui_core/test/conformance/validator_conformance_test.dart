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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// Runs the shared `conformance/core/validator.yaml` suite against
/// [A2uiValidator].
///
/// Cases targeting a protocol version this SDK does not implement are skipped
/// with a reason, so the suite doubles as the implementation checklist.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/validator_v0_9.yaml',
  );

  group('conformance core/validator_v0_9.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(
        testCase['name']! as String,
        () => _runCase(testCase),
        skip: _skipReason(testCase),
      );
    }
  });
}

/// Why a case cannot run yet, or null when it can.
String? _skipReason(Map<String, Object?> testCase) {
  final String? version = caseVersion(testCase);
  if (version != null && version != '0.9') {
    return 'Targets protocol v$version; this SDK implements v0.9 only.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final Map<String, String> surfaceCatalogs = {};

  for (final Map<String, Object?> step in _steps(testCase)) {
    final Object? rawPayload = step['messages'] ?? step['payload'];
    if (rawPayload is! List) continue;
    final List<Map<String, Object?>> payload = [
      for (final Object? item in rawPayload)
        (item as Map).cast<String, Object?>(),
    ];

    for (final envelope in payload) {
      final Object? body = envelope['createSurface'];
      if (body is Map<String, Object?>) {
        final Object? surfaceId = body['surfaceId'];
        final Object? catalogId = body['catalogId'];
        if (surfaceId is String && catalogId is String) {
          surfaceCatalogs[surfaceId] = catalogId;
        }
      }
    }

    final catalogs = _loadCatalogs(testCase, payload);
    final commonTypes = _loadCommonTypes(testCase);

    final A2uiValidator<ComponentApi, FunctionApi> validator = A2uiValidator(
      catalogs: catalogs,
      commonTypesSchema: commonTypes,
    );

    final Object? expectError =
        step['expectError'] ??
        step['expect_error'] ??
        testCase['expectError'] ??
        testCase['expect_error'];
    if (expectError != null) {
      expect(
        () => validator.validate(payload, surfaceCatalogs: surfaceCatalogs),
        throwsA(_matchesError(expectError)),
        reason: testCase['name'] as String?,
      );
    } else {
      expect(
        () => validator.validate(payload, surfaceCatalogs: surfaceCatalogs),
        returnsNormally,
        reason: testCase['name'] as String?,
      );
    }
  }
}

List<SchemaCatalog> _loadCatalogs(
  Map<String, Object?> testCase,
  List<Map<String, Object?>> payload,
) {
  final List<Map<String, Object?>> documents = [];
  if (testCase['catalogPaths'] is List) {
    for (final Object? path in testCase['catalogPaths'] as List) {
      if (path is String) {
        documents.add(_document(path));
      }
    }
  } else if (testCase['catalog'] is Map) {
    final catMap = testCase['catalog']! as Map<String, Object?>;
    if (catMap.containsKey('catalog_schema')) {
      documents.add(_document(catMap['catalog_schema']));
    } else {
      documents.add(catMap);
    }
  }

  if (documents.isEmpty) {
    documents.add(_document('specification/v0_9/catalogs/basic/catalog.json'));
  }

  final List<SchemaCatalog> catalogs = [];
  for (final doc in documents) {
    catalogs.addAll(_catalogsFor(doc, payload));
  }
  return catalogs;
}

Map<String, Object?>? _loadCommonTypes(Map<String, Object?> testCase) {
  final catalog = testCase['catalog'];
  if (catalog is Map<String, Object?> &&
      catalog.containsKey('common_types_schema')) {
    return _document(catalog['common_types_schema']);
  }
  return null;
}

/// The steps a case runs, whether it declares one payload or several.
List<Map<String, Object?>> _steps(Map<String, Object?> testCase) {
  final Object? steps = testCase['steps'];
  if (steps is List<Object?>) return steps.cast<Map<String, Object?>>();
  return [testCase];
}

/// Reads a catalog or common-types document, inline or by path.
Map<String, Object?> _document(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is String) {
    final file = File(resolveConformancePath(value));
    if (!file.existsSync()) {
      throw StateError('Conformance schema not found: ${file.path}');
    }
    return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  }
  throw StateError('Case declares no catalog schema.');
}

/// Builds the catalogs a payload needs from the one document a case declares.
///
/// The suite's fixtures name the catalog `standard` in the document but `std`
/// in the payloads that use it. A validator that indexes catalogs by id would
/// reject those payloads outright, which is not what these cases are testing —
/// they are about the component graph. So the document is registered under
/// every id the payload actually names, and the unknown-catalog check keeps
/// its own coverage in `validator_test.dart`.
List<SchemaCatalog> _catalogsFor(
  Map<String, Object?> document,
  List<Map<String, Object?>> payload,
) {
  final ids = <String>{document['catalogId'] as String? ?? 'standard'};
  for (final envelope in payload) {
    final Object? body = envelope['createSurface'];
    if (body is Map<String, Object?> && body['catalogId'] is String) {
      ids.add(body['catalogId']! as String);
    }
  }
  return [
    for (final String id in ids)
      Catalog.fromJson(<String, Object?>{...document, 'catalogId': id}),
  ];
}

/// Matches the error a case expects, by category and message.
///
/// `details` is not asserted. It carries the field path and code a Pydantic
/// model reports, which this SDK does not model; the category and message
/// pin the same behaviour.
Matcher _matchesError(Object? expectError) {
  if (expectError is String) {
    return _messageMatches(expectError);
  }
  final Map<String, Object?> expected = (expectError! as Map)
      .cast<String, Object?>();
  final Matcher category = _categoryMatches(expected['category'] as String?);
  final Object? message = expected['message'];
  if (message is! String) return category;
  return allOf(category, _messageMatches(message));
}

Matcher _categoryMatches(String? category) => switch (category) {
  'ParseError' => isA<A2uiParseError>(),
  'ValidationError' => anyOf(
    isA<A2uiValidationError>(),
    isA<A2uiIntegrityError>(),
    isA<A2uiRecursionError>(),
    isA<A2uiCatalogError>(),
  ),
  'CatalogError' => isA<A2uiCatalogError>(),
  'IntegrityError' => isA<A2uiIntegrityError>(),
  'RecursionError' => isA<A2uiRecursionError>(),
  'CompileError' => isA<A2uiCompileError>(),
  'DataError' => isA<A2uiDataError>(),
  'StateError' => isA<A2uiStateError>(),
  _ => isA<A2uiError>(),
};

Matcher _messageMatches(String pattern) => isA<A2uiError>().having(
  (e) => e.message,
  'message',
  matches(RegExp(_align(pattern), caseSensitive: false)),
);

/// Widens a case's expected message to the wording this SDK uses.
///
/// The suite spells some messages the way the Python SDK's JSON Schema
/// library reports them. The reference harness does the same alignment for
/// Pydantic's wording; this is the Dart column of the same table.
String _align(String pattern) {
  if (pattern.contains('is not of type')) {
    return '($pattern|is not of type)';
  }
  if (pattern.contains('is not reachable from')) {
    return '($pattern|Unreachable components)';
  }
  if (pattern.contains('Dangling reference')) {
    return '($pattern|references non-existent component)';
  }
  if (pattern.contains('Circular component reference')) {
    return '($pattern|Circular reference detected)';
  }
  if (pattern.contains('Self-referencing component')) {
    return '($pattern|Self-reference detected)';
  }
  return pattern;
}

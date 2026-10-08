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
import 'package:collection/collection.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// Runs the shared `conformance/core/catalog.yaml` suite (`from_json` and
/// `catalog_schema` actions) against [Catalog].
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/catalog.yaml',
  );

  group('conformance core/catalog.yaml', () {
    test('suite has cases', () => expect(cases, isNotEmpty));

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
  if (version != null && version != '0.9' && version != '0.9.1') {
    return 'Targets protocol v$version; this harness runs v0.9 cases only.';
  }
  if (testCase.containsKey('expectCatalog')) {
    return 'expectCatalog checks the SDK implementation of the basic '
        'catalog against the specification.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final action = testCase['action'] as String?;
  switch (action) {
    case 'from_json':
      _runFromJsonCase(testCase);
    case 'catalog_schema':
      _runCatalogSchemaCase(testCase);
    default:
      throw StateError('Unsupported catalog conformance action: $action');
  }
}

void _runFromJsonCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> rawCatalog = _document(
    testCase['catalogSchema'] ??
        testCase['catalog'] ??
        testCase['schema'] ??
        testCase['catalogPath'],
  );
  final overrideId = testCase['catalogId'] as String?;
  final input = <String, Object?>{
    ...rawCatalog,
    if (overrideId != null) 'catalogId': overrideId,
  };

  final Object? expectError = testCase['expectError'];
  if (expectError != null) {
    expect(
      () => Catalog.fromJson(input),
      throwsA(isA<A2uiCatalogError>()),
      reason: name,
    );
    return;
  }

  final CatalogApi catalog = Catalog.fromJson(input);
  final Map<String, Object?> expected =
      (testCase['expect'] as Map<String, Object?>?) ?? const {};

  if (expected['catalogId'] case final String expectedId) {
    expect(catalog.id, expectedId, reason: '$name: catalogId');
  }
  if (expected['components'] case final Map<String, Object?> expectedComps) {
    expect(
      catalog.components.keys.toList()..sort(),
      expectedComps.keys.toList()..sort(),
      reason: '$name: components',
    );
    for (final String compName in expectedComps.keys) {
      final Map<String, Object?> schemaValue =
          catalog.components[compName]!.schema.value;
      expect(
        jsonEncode(schemaValue),
        isNot(contains(r'"$ref":"#/$defs/')),
        reason: '$name: local \$defs inlined in $compName',
      );
    }
  }
  if (expected['functions'] case final Map<String, Object?> expectedFuncs) {
    expect(
      catalog.functions.keys.toList()..sort(),
      expectedFuncs.keys.toList()..sort(),
      reason: '$name: functions',
    );
  }
  if (expected['theme'] case final Map<String, Object?> expectedTheme) {
    if (expectedTheme.isNotEmpty) {
      expect(catalog.themeSchema, isNotNull, reason: '$name: themeSchema');
    }
  }
}

void _runCatalogSchemaCase(Map<String, Object?> testCase) {
  final Map<String, Object?> source = _document(
    testCase['catalogSchema'] ??
        testCase['catalog'] ??
        testCase['schema'] ??
        testCase['catalogPath'],
  );
  final CatalogApi catalog = Catalog.fromJson(source);

  final Map<String, Object?> document = catalog.catalogSchema;
  final Map<String, Object?> expect_;
  if (testCase.containsKey('expectFile')) {
    final String expFile =
        resolveConformancePath(testCase['expectFile']! as String);
    expect_ =
        jsonDecode(File(expFile).readAsStringSync()) as Map<String, Object?>;
  } else {
    expect_ = (testCase['expect'] as Map<String, Object?>?) ?? const {};
  }
  final name = testCase['name']! as String;

  if (expect_[r'$schema'] case final String expectedSchema) {
    expect(document[r'$schema'], expectedSchema, reason: '$name: \$schema');
  }
  if (expect_['catalogId'] case final String expectedId) {
    expect(document['catalogId'], expectedId, reason: '$name: catalogId');
  }
  if (expect_['protocolVersion'] case final String expectedVer) {
    expect(
      document['protocolVersion'],
      expectedVer,
      reason: '$name: protocolVersion',
    );
  }
  if (expect_['components'] case final Map<String, Object?> expectedComps) {
    expect(
      document['components'],
      equals(expectedComps),
      reason: '$name: components',
    );
  }
  if (expect_['functions'] case final Map<String, Object?> expectedFuncs) {
    final Map<String, Object?> actualFuncs =
        (document['functions'] as Map?)?.cast<String, Object?>() ?? const {};
    expect(
      actualFuncs.keys.toList()..sort(),
      expectedFuncs.keys.toList()..sort(),
      reason: '$name: function names',
    );
  }
  if (expect_[r'$defs'] case final Map<String, Object?> expectedDefs) {
    final Map<String, Object?> actualDefs =
        (document[r'$defs'] as Map?)?.cast<String, Object?>() ?? const {};
    if (expectedDefs.containsKey('theme')) {
      expect(
        actualDefs['theme'],
        equals(expectedDefs['theme']),
        reason: '$name: \$defs.theme',
      );
    } else {
      expect(
        actualDefs.containsKey('theme'),
        isFalse,
        reason: '$name: \$defs.theme should be omitted',
      );
    }
  }

  _checkUnions(document, name);
  _checkSelfContained(document, name);
  _checkFixedPoint(document, name);
}

/// `anyComponent` and `anyFunction` cover exactly what the document declares.
void _checkUnions(Map<String, Object?> document, String name) {
  final Map<String, Object?> defs =
      (document[r'$defs'] as Map?)?.cast<String, Object?>() ?? {};
  final Iterable<Object?> components =
      ((document['components'] as Map?) ?? const {}).keys;
  final Iterable<Object?> functions =
      ((document['functions'] as Map?) ?? const {}).keys;

  expect(
    _unionTargets(defs['anyComponent'])..sort(),
    [for (final Object? c in components) '#/components/$c']..sort(),
    reason: '$name: anyComponent',
  );

  if (functions.isEmpty) {
    expect(
      defs.containsKey('anyFunction'),
      isFalse,
      reason: '$name: anyFunction with no functions',
    );
  } else {
    expect(
      _unionTargets(defs['anyFunction'])..sort(),
      [for (final Object? f in functions) '#/functions/$f']..sort(),
      reason: '$name: anyFunction',
    );
  }
}

List<String> _unionTargets(Object? union) {
  final Object? oneOf = (union as Map?)?['oneOf'];
  if (oneOf is! List) return const [];
  return [
    for (final Object? branch in oneOf)
      if (branch is Map && branch[r'$ref'] is String)
        branch[r'$ref']! as String,
  ];
}

/// Every reference into the document resolves inside it.
void _checkSelfContained(Map<String, Object?> document, String name) {
  for (final String ref in _localRefs(document)) {
    expect(
      _resolves(ref, document),
      isTrue,
      reason: '$name: dangling reference $ref',
    );
  }
}

Iterable<String> _localRefs(Object? node) sync* {
  if (node is List) {
    for (final Object? item in node) {
      yield* _localRefs(item);
    }
  } else if (node is Map) {
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      if (entry.key == r'$ref' &&
          entry.value is String &&
          (entry.value! as String).startsWith('#/')) {
        yield entry.value! as String;
      }
      yield* _localRefs(entry.value);
    }
  }
}

bool _resolves(String ref, Map<String, Object?> document) {
  Object? current = document;
  for (final String raw in ref.substring(2).split('/')) {
    final String segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current is! Map || !current.containsKey(segment)) return false;
    current = current[segment];
  }
  return true;
}

/// Rebuilding the rebuilt document changes nothing.
void _checkFixedPoint(Map<String, Object?> document, String name) {
  expect(
    const DeepCollectionEquality().equals(
      Catalog.fromJson(document).catalogSchema,
      document,
    ),
    isTrue,
    reason: '$name: rebuilding the rebuilt document is not a fixed point',
  );
}

/// Reads a catalog document, inline or by path.
Map<String, Object?> _document(Object? value) {
  if (value is Map<String, Object?>) {
    return value.containsKey('catalog_schema')
        ? _document(value['catalog_schema'])
        : value;
  }
  if (value is String) {
    final file = File(resolveConformancePath(value));
    if (!file.existsSync()) {
      throw StateError('Conformance catalog not found: ${file.path}');
    }
    return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  }
  throw StateError('Case declares no catalog schema.');
}

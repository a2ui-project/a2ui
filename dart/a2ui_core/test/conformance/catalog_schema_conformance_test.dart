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

/// Runs the shared `catalog_schema` cases in `conformance/core/catalog.yaml`.
///
/// Each case parses a catalog document, rebuilds the document from the parsed
/// catalog, and checks the result against assertions any SDK can make. The
/// cases name a source document rather than an SDK's own bundled catalog, so
/// every implementation converts the same input.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/catalog.yaml',
  ).where((c) => c['action'] == 'catalog_schema').toList();

  group('conformance core/catalog.yaml (catalog_schema)', () {
    test('suite has catalog_schema cases', () => expect(cases, isNotEmpty));

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
  final config = testCase['catalog']! as Map<String, Object?>;
  final SchemaCatalog catalog = Catalog.fromJson(
    _document(config['catalog_schema']),
  );

  final Map<String, Object?> document = catalog.catalogSchema;
  final expect_ = testCase['expect']! as Map<String, Object?>;
  final name = testCase['name']! as String;

  _checkMetadata(document, expect_, name);
  _checkMembers(document, expect_, name);
  if (expect_['unions_cover_all'] == true) _checkUnions(document, name);
  if (expect_['self_contained'] == true) _checkSelfContained(document, name);
  if (expect_['reparses_identically'] == true) _checkFixedPoint(document, name);
}

/// Top-level keys the rebuilt document must carry, and must not carry.
void _checkMetadata(
  Map<String, Object?> document,
  Map<String, Object?> expect_,
  String name,
) {
  final metadata = expect_['metadata'] as Map<String, Object?>?;
  if (metadata != null) {
    for (final MapEntry<String, Object?> entry in metadata.entries) {
      expect(
        document[entry.key],
        entry.value,
        reason: '$name: document ${entry.key}',
      );
    }
  }
  final Object? absent = expect_['absent_metadata'];
  if (absent is List<Object?>) {
    for (final Object? key in absent) {
      expect(
        document.containsKey(key),
        isFalse,
        reason: '$name: document should not declare $key',
      );
    }
  }
}

/// The document declares exactly the expected components and functions.
void _checkMembers(
  Map<String, Object?> document,
  Map<String, Object?> expect_,
  String name,
) {
  final Object? components = expect_['components'];
  if (components is List<Object?>) {
    expect(
      ((document['components'] as Map?) ?? const {}).keys.toList()..sort(),
      components.cast<String>().toList()..sort(),
      reason: '$name: components',
    );
  }
  final Object? functions = expect_['functions'];
  if (functions is List<Object?>) {
    expect(
      ((document['functions'] as Map?) ?? const {}).keys.toList()..sort(),
      functions.cast<String>().toList()..sort(),
      reason: '$name: functions',
    );
  }
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
///
/// References that leave the document, such as the `common_types.json` URLs,
/// are resolved by the validator against the definitions it is given, so they
/// are not the document's to satisfy.
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
  if (value is Map<String, Object?>) return value;
  if (value is String) {
    final file = File(resolveConformancePath(value));
    if (!file.existsSync()) {
      throw StateError('Conformance catalog not found: ${file.path}');
    }
    return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  }
  throw StateError('Case declares no catalog schema.');
}

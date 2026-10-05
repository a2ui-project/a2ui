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

    runConformanceSuite(
      cases,
      _runCase,
      expectedFailures: _expectedFailures,
      skipReason: _skipReason,
    );
  });
}

/// Cases expected to fail.
const Map<String, String> _expectedFailures = {
  'test_v10_catalog_from_json_invalid_uax31_identifier_error':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_argument_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_armenian_hyphen_function_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_component_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_em_dash_property_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_en_dash_component_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_function_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
  'test_v10_uax31_invalid_property_name':
      'v1.0 identifiers are not checked against UAX #31 yet.',
};

/// Why a case cannot run, or null when it can.
String? _skipReason(Map<String, Object?> testCase) =>
    caseVersion(testCase) == '0.8'
        ? 'This SDK does not implement protocol v0.8.'
        : null;

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
  if (testCase['expectCatalog'] case final Map<String, Object?> spec) {
    _runExpectCatalogCase(testCase, spec);
    return;
  }
  final Map<String, Object?> source = _document(
    testCase['catalogSchema'] ??
        testCase['catalog'] ??
        testCase['schema'] ??
        testCase['catalogPath'],
  );
  final CatalogApi catalog = Catalog.fromJson(source);

  final Map<String, Object?> document = catalog.catalogSchema;
  final expect_ = testCase['expect']! as Map<String, Object?>;
  final name = testCase['name']! as String;

  if (expect_.containsKey('metadata') ||
      expect_.containsKey('unions_cover_all')) {
    _checkMetadata(document, expect_, name);
    _checkMembers(document, expect_, name);
  } else {
    if (expect_[r'$schema'] case final String expectedSchema) {
      expect(document[r'$schema'], expectedSchema, reason: '$name: \$schema');
    }
    if (expect_['catalogId'] case final String expectedId) {
      expect(document['catalogId'], expectedId, reason: '$name: catalogId');
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
  }

  _checkUnions(document, name);
  _checkSelfContained(document, name);
  _checkFixedPoint(document, name);
}

/// Checks the SDK's own implementation of a published catalog against that
/// catalog, as the reference harness does.
///
/// The case names the published document by path; the [BasicCatalog] factory
/// with the same `catalogId` is the implementation under test. Both sides are
/// brought to the form [_consolidate] describes and must then be equal.
void _runExpectCatalogCase(
  Map<String, Object?> testCase,
  Map<String, Object?> spec,
) {
  final name = testCase['name']! as String;
  final Map<String, Object?> published = _document(testCase['catalogPath']);
  final Catalog<ComponentApi, FunctionImplementation> catalog =
      switch (published['catalogId']) {
    BasicCatalog.v0_9Id => BasicCatalog.v0_9(),
    BasicCatalog.v1_0Id => BasicCatalog.v1_0(),
    final Object? other => fail('$name: no SDK implementation of $other.'),
  };
  expect(
    compareVersions(catalog.protocolVersion!, caseVersion(testCase)!),
    0,
    reason: '$name: ${catalog.id} implements protocol '
        '${catalog.protocolVersion}',
  );

  final Map<String, Object?> commonTypes = _document(spec['commonTypesPath']);
  expect(
    _consolidate(catalog.catalogSchema, commonTypes),
    equals(_consolidate(_document(spec['catalogPath']), commonTypes)),
    reason: name,
  );
}

/// Brings a catalog document to the form an `expectCatalog` case compares.
///
/// Follows `consolidate_spec_catalog` in the Python harness: every `$ref`
/// into another document becomes local, and the common types the document
/// references, transitively, join its `$defs`. On top of that:
/// - Definitions the document declares for itself, other than `theme` and the
///   `anyComponent` and `anyFunction` unions, are inlined where referenced
///   and dropped, because [Catalog.fromJson] inlines them and
///   [Catalog.catalogSchema] emits only those three.
/// - `$id`, `title`, `description`, `protocolVersion` and `instructions` are
///   dropped. The reference harness drops the first four; [Catalog] does not
///   carry an `instructions` field yet.
/// - A function's own `description` and `requiresUserActivation` (the v1.0
///   `openUrl` declares it) are dropped, because [FunctionApi] carries
///   neither for [Catalog.catalogSchema] to emit.
/// - `enum` and `required` lists are sorted, since their order has no
///   meaning.
Map<String, Object?> _consolidate(
  Map<String, Object?> document,
  Map<String, Object?> commonTypes,
) {
  final consolidated = _localize(document)! as Map<String, Object?>;
  for (final key in [
    r'$id',
    'title',
    'description',
    'protocolVersion',
    'instructions',
  ]) {
    consolidated.remove(key);
  }

  final Map<String, Object?> defs =
      (consolidated[r'$defs'] as Map<String, Object?>?) ?? {};
  const kept = {'theme', 'anyComponent', 'anyFunction'};
  final Map<String, Object?> own = {
    for (final MapEntry<String, Object?> entry in defs.entries)
      if (!kept.contains(entry.key)) entry.key: entry.value,
  };
  defs.removeWhere((key, _) => own.containsKey(key));
  final inlined = _inlineDefs(consolidated, own)! as Map<String, Object?>;
  inlined[r'$defs'] = defs;

  if (inlined['functions'] case final Map<String, Object?> functions) {
    for (final Object? function in functions.values) {
      (function! as Map<String, Object?>)
        ..remove('description')
        ..remove('requiresUserActivation');
    }
  }

  final commonDefs = (_localize(commonTypes)!
      as Map<String, Object?>)[r'$defs']! as Map<String, Object?>;
  final Set<String> pending = _defRefs(inlined);
  while (pending.isNotEmpty) {
    final String def = pending.first;
    pending.remove(def);
    if (!defs.containsKey(def) && commonDefs.containsKey(def)) {
      defs[def] = commonDefs[def];
      pending.addAll(_defRefs(commonDefs[def]));
    }
  }
  return _sortSetKeywords(inlined)! as Map<String, Object?>;
}

/// A deep copy of [node] in which every `$ref` that points into a document,
/// local or not, becomes a local `#/...` reference.
Object? _localize(Object? node) {
  if (node is List) return [for (final Object? item in node) _localize(item)];
  if (node is! Map) return node;
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in node.entries)
      entry.key! as String: entry.key == r'$ref' &&
              entry.value is String &&
              (entry.value! as String).contains('#/')
          ? '#${(entry.value! as String).split('#').last}'
          : _localize(entry.value),
  };
}

/// [node] with each `#/$defs/<name>` reference to one of [defs] replaced by
/// that definition, keywords beside the `$ref` winning as in
/// [Catalog.fromJson].
Object? _inlineDefs(Object? node, Map<String, Object?> defs) {
  if (node is List) {
    return [for (final Object? item in node) _inlineDefs(item, defs)];
  }
  if (node is! Map<String, Object?>) return node;
  final Object? ref = node[r'$ref'];
  if (ref is String && ref.startsWith(r'#/$defs/')) {
    final Object? target = defs[ref.substring(r'#/$defs/'.length)];
    if (target is Map<String, Object?>) {
      return <String, Object?>{
        ...(_inlineDefs(target, defs)! as Map<String, Object?>),
        for (final MapEntry<String, Object?> entry in node.entries)
          if (entry.key != r'$ref') entry.key: _inlineDefs(entry.value, defs),
      };
    }
  }
  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in node.entries)
      entry.key: _inlineDefs(entry.value, defs),
  };
}

/// The names of the definitions [node] references as `#/$defs/<name>`.
Set<String> _defRefs(Object? node) => {
      for (final String ref in _localRefs(node))
        if (ref.startsWith(r'#/$defs/')) ref.substring(r'#/$defs/'.length),
    };

/// [node] with its `enum` and `required` lists sorted.
Object? _sortSetKeywords(Object? node) {
  if (node is List) {
    return [for (final Object? item in node) _sortSetKeywords(item)];
  }
  if (node is! Map<String, Object?>) return node;
  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in node.entries)
      entry.key: (entry.key == 'enum' || entry.key == 'required') &&
              entry.value is List
          ? ([...(entry.value! as List<Object?>)]
            ..sort((a, b) => jsonEncode(a).compareTo(jsonEncode(b))))
          : _sortSetKeywords(entry.value),
  };
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

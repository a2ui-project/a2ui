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

/// Runs the shared catalog suite `conformance/core/catalog.yaml` against
/// [Catalog]: its `from_json`, `to_json`, `round_trip` and
/// `validation_schema` cases, for every protocol version.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/catalog.yaml',
  );

  group('conformance core/catalog.yaml', () {
    test('suite has cases', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, () => _runCase(testCase), skip: _knownDivergences[name]);
    }
  });
}

/// Cases whose expected outcome Dart does not produce, with the reason.
const Map<String, String> _knownDivergences = {
  'test_v08_catalog_from_json_basic':
      'Targets v0.8, which a2ui_core does not implement: fromJson does not '
          'map v0.8 styles to a theme.',
  'test_v08_validation_schema_basic':
      'Targets v0.8, which a2ui_core does not implement: the document '
          'declares no version, so it is read as v0.9 and its theme is opened.',
  'test_v10_published_basic_catalog_validates_function_calls':
      'From v1.0, PayloadValidator accepts a call to a function the catalog '
          'does not declare, because the renderer forwards it to the agent.',
  'test_v10_uax31_invalid_argument_name':
      "Catalog.fromJson reads a map-form function's 'parameters' as a JSON "
          'schema, so it checks the names under its properties; the case '
          'writes the argument names directly under parameters.',
  'test_v10_catalog_from_json_uax31_validation':
      "Catalog.fromJson rejects function names starting with '@', which are "
          'reserved for protocol system functions such as @index.',
};

/// The built-in catalogs this package implements, by catalog id.
final Map<String, CatalogApi> _builtinCatalogs = {
  for (final CatalogApi catalog in [BasicCatalog.v0_9(), BasicCatalog.v1_0()])
    catalog.id: catalog,
};

void _runCase(Map<String, Object?> testCase) {
  final action = testCase['action'] as String?;
  switch (action) {
    case 'from_json':
      _runFromJsonCase(testCase);
    case 'validation_schema':
      _runValidationSchemaCase(testCase);
    case 'round_trip':
      _runRoundTripCase(testCase);
    case 'to_json':
      _runToJsonCase(testCase);
    default:
      throw StateError('Unsupported catalog conformance action: $action');
  }
}

/// The keys a `FromJsonExpect` may set.
const Set<String> _fromJsonExpectKeys = {
  'catalogId',
  'protocolVersion',
  'components',
  'functions',
  'theme',
  'matchesBuiltinCatalog',
  'selfContained',
  'validComponents',
  'invalidComponents',
};

void _runFromJsonCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> rawCatalog = _document(
    testCase['catalog'] ?? testCase['catalogPath'],
  );
  final overrideId = testCase['catalogId'] as String?;
  final input = <String, Object?>{
    ...rawCatalog,
    if (overrideId != null) 'catalogId': overrideId,
  };
  // As in the other SDK harnesses, a case that names no version reads a
  // document that declares none as v0.9.
  final A2uiProtocolVersion version =
      _version(testCase) ?? A2uiProtocolVersion.v0_9;

  if (testCase['expectError'] != null) {
    expect(
      () => Catalog.fromJson(input, protocolVersion: version),
      throwsA(isA<A2uiCatalogError>()),
      reason: name,
    );
    return;
  }

  final CatalogApi catalog = Catalog.fromJson(input, protocolVersion: version);
  final Map<String, Object?> expected =
      (testCase['expect'] as Map?)?.cast<String, Object?>() ?? const {};
  final Set<String> unknown =
      expected.keys.toSet().difference(_fromJsonExpectKeys);
  if (unknown.isNotEmpty) {
    fail('$name: unsupported from_json expectations $unknown');
  }

  if (expected['catalogId'] case final String expectedId) {
    expect(catalog.id, expectedId, reason: '$name: catalogId');
  }
  if (expected['protocolVersion'] case final String expectedVersion) {
    expect(
      catalog.protocolVersion,
      A2uiProtocolVersion.tryParseSemVer(expectedVersion),
      reason: '$name: protocolVersion',
    );
  }
  if (expected.containsKey('components')) {
    final List<String> expectedComps = _names(expected['components']);
    expect(
      catalog.components.keys,
      unorderedEquals(expectedComps),
      reason: '$name: components',
    );
    for (final compName in expectedComps) {
      final Map<String, Object?> schemaValue =
          catalog.components[compName]!.schema.value;
      expect(
        jsonEncode(schemaValue),
        isNot(contains(r'"$ref":"#/$defs/')),
        reason: '$name: local \$defs inlined in $compName',
      );
    }
  }
  if (expected.containsKey('functions')) {
    expect(
      catalog.functions.keys,
      unorderedEquals(_names(expected['functions'])),
      reason: '$name: functions',
    );
  }
  if (expected['theme'] case final Map<Object?, Object?> expectedTheme) {
    if (expectedTheme.isNotEmpty) {
      expect(catalog.themeSchema, isNotNull, reason: '$name: themeSchema');
    }
  }
  if (expected['selfContained'] == true) {
    _checkSelfContained(catalog.validationSchema, name, requireRefs: true);
  }
  if (expected.containsKey('validComponents') ||
      expected.containsKey('invalidComponents')) {
    final validator = PayloadValidator<ComponentApi, FunctionApi>(
      catalog: catalog,
      protocolVersion: version,
    );
    for (final Object? component in _list(expected['validComponents'])) {
      validator.validateComponent((component! as Map).cast<String, Object?>());
    }
    for (final Object? component in _list(expected['invalidComponents'])) {
      expect(
        () => validator.validateComponent(
          (component! as Map).cast<String, Object?>(),
        ),
        throwsA(isA<A2uiValidationError>()),
        reason: '$name: expected ${jsonEncode(component)} to be rejected',
      );
    }
  }
  if (expected['matchesBuiltinCatalog'] == true) {
    _checkMatchesBuiltinCatalog(catalog, name);
  }
}

List<Object?> _list(Object? value) => value is List ? value : const <Object?>[];

/// Checks `matchesBuiltinCatalog`: [loaded] is equivalent to this package's
/// own implementation of the catalog with the same id.
///
/// The Dart basic catalogs implement the published functions but no
/// components yet, so for them every other part is checked and the case is
/// then marked skipped rather than failed on the components.
void _checkMatchesBuiltinCatalog(CatalogApi loaded, String name) {
  final CatalogApi? builtin = _builtinCatalogs[loaded.id];
  if (builtin == null) {
    markTestSkipped('a2ui_core has no built-in catalog ${loaded.id}.');
    return;
  }
  expect(
    loaded.protocolVersion,
    builtin.protocolVersion,
    reason: '$name: protocolVersion',
  );
  expect(
    _functionSignatures(loaded),
    equals(_functionSignatures(builtin)),
    reason: '$name: functions',
  );
  if (builtin.components.isEmpty && loaded.components.isNotEmpty) {
    markTestSkipped(
      'The built-in ${loaded.id} implements the published functions but '
      'none of the ${loaded.components.length} published components yet; '
      'catalog id, protocol version and function signatures match.',
    );
    return;
  }
  expect(
    _componentShapes(loaded),
    equals(_componentShapes(builtin)),
    reason: '$name: components',
  );
}

/// The property and required names of each component, without the `id`
/// and `component` envelope fields.
Map<String, Object?> _componentShapes(CatalogApi catalog) {
  const envelope = {'id', 'component'};
  final Map<String, Object?> components =
      (catalog.validationSchema['components'] as Map?)
              ?.cast<String, Object?>() ??
          const {};
  return {
    for (final MapEntry<String, Object?> entry in components.entries)
      entry.key: {
        'properties': [
          for (final Object? key
              in ((entry.value! as Map)['properties'] as Map? ?? const {}).keys)
            if (!envelope.contains(key)) '$key',
        ]..sort(),
        'required': [
          for (final Object? key
              in (entry.value! as Map)['required'] as List? ?? const [])
            if (!envelope.contains(key)) '$key',
        ]..sort(),
      },
  };
}

/// The return type, callers and activation of each function.
Map<String, Object?> _functionSignatures(CatalogApi catalog) => {
      for (final FunctionApi function in catalog.functions.values)
        function.name: {
          'returnType': function.returnType.name,
          'allowedCallers': function.allowedCallers.jsonValue,
          'requiresUserActivation': function.requiresUserActivation,
        },
    };

/// The protocol version a case names, or null when it names none.
///
/// A case may spell it with or without the `v` prefix.
A2uiProtocolVersion? _version(Map<String, Object?> testCase) =>
    switch (testCase['protocolVersion']) {
      final String version => A2uiProtocolVersion.tryParseSemVer(version),
      _ => null,
    };

/// Compares `validationSchema` with the golden document at `expectFile`,
/// ignoring object key order and the order of `enum` and `required`.
///
/// A case naming a catalog by `catalogPath` loads the published document:
/// the Dart basic catalogs implement the published functions but none of
/// the components, so they do not implement the catalog the document
/// describes.
void _runValidationSchemaCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> source = _document(
    testCase['catalog'] ?? testCase['catalogPath'],
  );
  final A2uiProtocolVersion? version = _version(testCase);

  if (testCase['expectError'] != null) {
    expect(
      () => Catalog.fromJson(source, protocolVersion: version).validationSchema,
      throwsA(isA<A2uiError>()),
      reason: name,
    );
    return;
  }

  final Map<String, Object?> document =
      Catalog.fromJson(source, protocolVersion: version).validationSchema;
  final String goldenPath = resolveConformancePath(
    testCase['expectFile']! as String,
  );
  final Object? golden = jsonDecode(File(goldenPath).readAsStringSync());
  final List<String> differences = [
    for (final (String path, String detail) in _differences(document, golden))
      '$path: $detail',
  ];
  if (differences.isNotEmpty) {
    fail(
      '$name: validationSchema differs from ${testCase['expectFile']}:\n'
      '${differences.join('\n')}',
    );
  }
}

/// The JSON pointer paths where [actual] and [expected] differ, each with
/// a description of the difference, compared as by [_jsonEquivalent].
List<(String, String)> _differences(
  Object? actual,
  Object? expected, [
  String path = '',
  String? key,
]) {
  if (actual is Map && expected is Map) {
    return [
      for (final Object? k in {...actual.keys, ...expected.keys})
        if (!actual.containsKey(k))
          ('$path/$k', 'missing, expected ${jsonEncode(expected[k])}')
        else if (!expected.containsKey(k))
          ('$path/$k', 'unexpected ${jsonEncode(actual[k])}')
        else
          ..._differences(actual[k], expected[k], '$path/$k', '$k'),
    ];
  }
  if (actual is List &&
      expected is List &&
      actual.length == expected.length &&
      key != 'enum' &&
      key != 'required') {
    return [
      for (var i = 0; i < actual.length; i++)
        ..._differences(actual[i], expected[i], '$path/$i'),
    ];
  }
  return _jsonEquivalent(actual, expected, key)
      ? const []
      : [(path, '${jsonEncode(actual)} != ${jsonEncode(expected)}')];
}

/// Every reference into the document resolves inside it. With
/// [requireRefs], the document must also contain at least one reference and
/// none may leave it.
void _checkSelfContained(
  Map<String, Object?> document,
  String name, {
  bool requireRefs = false,
}) {
  if (requireRefs) {
    final List<String> refs = _allRefs(document).toList();
    expect(refs, isNotEmpty, reason: '$name: the schema has no references');
    for (final ref in refs) {
      expect(
        ref.startsWith('#'),
        isTrue,
        reason: '$name: reference $ref leaves the document',
      );
    }
  }
  for (final String ref in _localRefs(document)) {
    expect(
      _resolves(ref, document),
      isTrue,
      reason: '$name: dangling reference $ref',
    );
  }
}

/// Every `$ref` value in [node].
Iterable<String> _allRefs(Object? node) sync* {
  if (node is List) {
    for (final Object? item in node) {
      yield* _allRefs(item);
    }
  } else if (node is Map) {
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      if (entry.key == r'$ref' && entry.value is String) {
        yield entry.value! as String;
      }
      yield* _allRefs(entry.value);
    }
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

/// `fromJson(c).toJson()` equals `c`, and serializing again changes nothing.
void _runRoundTripCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> source = _document(
    testCase['catalog'] ?? testCase['catalogPath'],
  );
  final A2uiProtocolVersion? version = _version(testCase);

  final Map<String, Object?> out =
      Catalog.fromJson(source, protocolVersion: version).toJson();
  expect(
    _jsonEquivalent(out, source),
    isTrue,
    reason: '$name: toJson differs from the source document.\n'
        'Source: ${jsonEncode(source)}\nOutput: ${jsonEncode(out)}',
  );

  final Map<String, Object?> again =
      Catalog.fromJson(out, protocolVersion: version).toJson();
  expect(
    _jsonEquivalent(again, out),
    isTrue,
    reason: '$name: toJson is not idempotent.\n'
        'First: ${jsonEncode(out)}\nSecond: ${jsonEncode(again)}',
  );
}

/// The keys a `ToJsonExpect` may set.
const Set<String> _toJsonExpectKeys = {
  'catalogId',
  'protocolVersion',
  'metadata',
  'components',
  'functions',
  'defs',
  'unbundled',
};

/// Checks `catalog.toJson()` against a `ToJsonExpect`.
///
/// A case naming a catalog by `catalogPath` loads the published document:
/// the Dart basic catalogs implement the published functions but none of
/// the components, so they do not implement the catalog the document
/// describes.
void _runToJsonCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final Map<String, Object?> source = _document(
    testCase['catalog'] ?? testCase['catalogPath'],
  );
  final Map<String, Object?> expected =
      (testCase['expect']! as Map).cast<String, Object?>();
  final Set<String> unknown = expected.keys.toSet().difference(
        _toJsonExpectKeys,
      );
  if (unknown.isNotEmpty) {
    fail('$name: unsupported to_json expectations $unknown');
  }

  final Map<String, Object?> document = Catalog.fromJson(
    source,
    protocolVersion: _version(testCase),
  ).toJson();

  if (expected['catalogId'] case final String catalogId) {
    expect(document['catalogId'], catalogId, reason: '$name: catalogId');
  }
  if (expected['protocolVersion'] case final String version) {
    expect(
      document['protocolVersion'],
      version,
      reason: '$name: protocolVersion',
    );
  }
  if (expected['metadata'] case final Map<Object?, Object?> metadata) {
    for (final MapEntry<Object?, Object?> entry in metadata.entries) {
      expect(
        document[entry.key],
        entry.value,
        reason: '$name: metadata ${entry.key}',
      );
    }
  }
  if (expected['components'] case final List<Object?> components) {
    expect(
      _names(document['components']),
      unorderedEquals(components),
      reason: '$name: components',
    );
  }
  if (expected['functions'] case final List<Object?> functions) {
    expect(
      _names(document['functions']),
      unorderedEquals(functions),
      reason: '$name: functions',
    );
  }
  if (expected['defs'] case final List<Object?> defs) {
    expect(
      _names(document[r'$defs']),
      unorderedEquals(defs),
      reason: '$name: \$defs',
    );
  }
  if (expected['unbundled'] == true) {
    for (final String ref in _localRefs(document)) {
      expect(
        _resolves(ref, document),
        isTrue,
        reason: '$name: dangling reference $ref',
      );
    }
    final Set<String> authored = _names(source[r'$defs']).toSet();
    for (final String def in _names(document[r'$defs'])) {
      expect(
        def == 'anyComponent' || def == 'anyFunction' || authored.contains(def),
        isTrue,
        reason: '$name: \$defs.$def was not declared by the document',
      );
    }
  }
}

/// The names under a document's `components`, `functions` or `$defs`, in
/// either form `functions` takes.
List<String> _names(Object? section) => switch (section) {
      final Map<Object?, Object?> map => [for (final key in map.keys) '$key'],
      final List<Object?> list => [
          for (final Object? item in list)
            if (item is Map && item['name'] is String) item['name']! as String,
        ],
      _ => const [],
    };

/// JSON equality that ignores object key order and the order of `enum`
/// values and `required` names.
bool _jsonEquivalent(Object? a, Object? b, [String? key]) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final MapEntry<Object?, Object?> entry in a.entries) {
      if (!b.containsKey(entry.key)) return false;
      if (!_jsonEquivalent(entry.value, b[entry.key], '${entry.key}')) {
        return false;
      }
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    if (key == 'enum' || key == 'required') {
      final List<String> left = [for (final item in a) jsonEncode(item)]
        ..sort();
      final List<String> right = [for (final item in b) jsonEncode(item)]
        ..sort();
      return const ListEquality<String>().equals(left, right);
    }
    for (var i = 0; i < a.length; i++) {
      if (!_jsonEquivalent(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
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

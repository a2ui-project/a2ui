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

/// Loading the shared agent suites, and moving their cases between the
/// protocol version they are written against and the one this SDK
/// implements.
///
/// The agent suites are written against v1.0 and this SDK implements v0.9,
/// so a harness lowers what a case hands the SDK to v0.9 and lifts what the
/// SDK returns back to v1.0 before comparing:
///
/// - A `version` of `v1.0` becomes `v0.9`, and one of `v0.9` becomes
///   `v1.0`. A case written with `v0.9` means a version other than its
///   catalog's, which for this SDK is v1.0.
/// - A catalog document's `protocolVersion` of `1.0` becomes `0.9`, and any
///   function `returnType` of `validationResult` becomes `boolean`.
/// - Capabilities keyed by `v1.0` are keyed by `v0.9`.
/// - v1.0 lets `createSurface` name no catalog and v0.9 does not, so a case
///   that never names a catalog has the first catalog of the case named in
///   each `createSurface`, and removed again from what the SDK returns.
/// - A v1.0 `createSurface` carrying `components` and `dataModel` is the
///   v0.9 `createSurface` followed by the `updateComponents` and
///   `updateDataModel` that fill it. Lifting joins them back for the formats
///   whose suites use the joined form.
/// - v0.9 `createSurface` states `sendDataModel` even when it is false,
///   which v1.0 leaves out.
/// - v1.0 writes a data binding as `@path` and a function call as `@call`,
///   where v0.9 writes `path` and `call`. Only components and the function a
///   `callRendererFunction` names are renamed: a `ChildList` template
///   (`componentId` beside `path`), the `updateDataModel` envelope's `path`
///   and data model values keep their keys in both versions.
library;

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// Reads the cases of the suite at [path], relative to `conformance/`, as
/// plain Dart maps.
List<Map<String, Object?>> loadSuite(String path) => [
  for (final Object? node
      in loadYaml(File('$conformanceRoot/$path').readAsStringSync())
          as YamlList)
    _plain(node)! as Map<String, Object?>,
];

/// Suite-level error categories mapped onto this SDK's exception types.
final Map<String, Matcher> _errors = {
  'ParseError': isA<A2uiParseError>(),
  'ValidationError': isA<A2uiValidationError>(),
  'CatalogError': isA<A2uiCatalogError>(),
};

/// The matcher for a case's `expect_error`.
Matcher throwsCategory(Object? expectError) {
  final category =
      (expectError! as Map<String, Object?>)['category']! as String;
  return throwsA(_errors[category]!);
}

/// The catalog a suite names by [entry]: a path relative to `conformance/`,
/// or a map with the path under `catalog` and the transformers registered
/// with it under `transformers`.
CatalogConfig catalogConfig(Object? entry) => switch (entry) {
  final String path => CatalogConfig(loadCatalog(path)),
  {'catalog': final String path} => CatalogConfig(
    loadCatalog(path),
    transformers: [
      for (final Object? transformer
          in (entry as Map)['transformers'] as List<Object?>? ?? const [])
        _transformer(transformer),
    ],
  ),
  _ => throw ArgumentError.value(entry, 'entry', 'Not a catalog entry'),
};

/// The catalogs a case names in `args`, each after the transformers
/// registered with it.
List<CatalogApi> caseCatalogs(Map<String, Object?> args) => [
  if (args['catalog'] case final Object catalog)
    catalogConfig(catalog).transformedCatalog,
  if (args['catalogs'] case final List<Object?> entries)
    for (final Object? entry in entries)
      catalogConfig(entry).transformedCatalog,
];

CatalogTransformer _transformer(Object? spec) => switch (spec) {
  {'component_pruning': final List<Object?> names} =>
    ComponentPruningTransformer(names.cast<String>()),
  {'function_pruning': final List<Object?> names} => FunctionPruningTransformer(
    names.cast<String>(),
  ),
  _ => throw ArgumentError.value(spec, 'spec', 'Unknown transformer'),
};

final Map<String, CatalogApi> _catalogCache = {};

/// The catalog document at [path], lowered to v0.9 and loaded by a
/// provider.
///
/// A document that names no catalog is given its path as its id, which a
/// provider supplies the same way an agent would.
CatalogApi loadCatalog(String path) => _catalogCache.putIfAbsent(path, () {
  final Map<String, Object?> document = lowerCatalogDocument(
    jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
        as Map<String, Object?>,
  );
  return InMemoryCatalogProvider(
    document,
    protocolVersion: A2uiProtocolVersion.v0_9,
    catalogId: document.containsKey('catalogId') ? null : path,
  ).load();
});

/// [document] with a `protocolVersion` of `1.0` stated as `0.9`, and any
/// `validationResult` function return type stated as `boolean`.
Map<String, Object?> lowerCatalogDocument(Map<String, Object?> document) {
  if (document['protocolVersion'] != '1.0') return {...document};
  return {
    ...document,
    'protocolVersion': '0.9',
    if (document['functions'] case final Map<Object?, Object?> functions)
      'functions': {
        for (final MapEntry<Object?, Object?> entry in functions.entries)
          entry.key.toString(): switch (entry.value) {
            final Map<Object?, Object?> fn => {
              ...fn,
              if (fn['returnType'] == 'validationResult')
                'returnType': 'boolean',
              if (fn['properties'] case final Map<Object?, Object?> props
                  when (props['returnType'] as Map?)?['const'] ==
                      'validationResult')
                'properties': {
                  ...props,
                  'returnType': {'const': 'boolean'},
                },
            },
            final Object? other => other,
          },
      },
  };
}

/// [version] swapped between the suite's version and this SDK's, in either
/// spelling; any other value is returned as it is.
Object? swapVersion(Object? version) => switch (version) {
  'v1.0' => 'v0.9',
  'v0.9' => 'v1.0',
  _ => version,
};

// A case may write the field in curly quotes, which the parser repairs.
final RegExp _versionField = RegExp(
  '([“"]version[”"]\\s*:\\s*[“"])(v1\\.0|v0\\.9)([”"])',
);

/// [text], a payload a model wrote, lowered to v0.9: each `version` swapped,
/// each `@path` and `@call` key written without its `@`, and each
/// `createSurface` given [catalogId] when it is not null.
String lowerText(String text, {String? catalogId}) {
  final String lowered = text
      .replaceAllMapped(
        _versionField,
        (m) => '${m[1]}${swapVersion(m[2])}${m[3]}',
      )
      .replaceAllMapped(_reservedKeyField, (m) => '"${m[1]}"');
  if (catalogId == null) return lowered;
  return lowered.replaceAll(
    RegExp(r'"createSurface"\s*:\s*\{'),
    '"createSurface": {"catalogId": ${jsonEncode(catalogId)}, ',
  );
}

// A single `@`: a doubled one escapes a literal key and stays as it is.
final RegExp _reservedKeyField = RegExp(r'"@(path|call)"(?=\s*:)');

/// The catalog a harness names in each `createSurface` of a case that names
/// none, or null when the case names one itself.
String? injectedCatalogId(Map<String, Object?> testCase) {
  if (jsonEncode(testCase).contains('catalogId')) return null;
  final List<CatalogApi> catalogs = caseCatalogs(
    testCase['args']! as Map<String, Object?>,
  );
  return catalogs.isEmpty ? null : catalogs.first.id;
}

/// [messages], written against v1.0 as JSON, lowered to v0.9 messages.
///
/// A `createSurface` naming no catalog is given [defaultCatalogId].
List<AgentToRendererMessage> lowerMessages(
  List<Object?> messages, {
  String? defaultCatalogId,
}) {
  final lowered = <Map<String, Object?>>[];
  for (final message in messages) {
    final Map<String, Object?> json = _renameReservedKeys(
      Map<String, Object?>.from(message! as Map),
      lower: true,
    );
    json['version'] = swapVersion(json['version']);
    if (json['createSurface'] case final Map<Object?, Object?> body) {
      final create = Map<String, Object?>.from(body);
      final Object? components = create.remove('components');
      final Object? dataModel = create.remove('dataModel');
      if (defaultCatalogId != null) {
        create.putIfAbsent('catalogId', () => defaultCatalogId);
      }
      final Object? surfaceId = create['surfaceId'];
      lowered.add({'version': json['version'], 'createSurface': create});
      if (components != null) {
        lowered.add({
          'version': json['version'],
          'updateComponents': {
            'surfaceId': surfaceId,
            'components': components,
          },
        });
      }
      if (dataModel != null) {
        lowered.add({
          'version': json['version'],
          'updateDataModel': {
            'surfaceId': surfaceId,
            'path': '/',
            'value': dataModel,
          },
        });
      }
    } else {
      lowered.add(json);
    }
  }
  return AgentToRendererMessage.parseAll(
    lowered,
    protocolVersion: A2uiProtocolVersion.v0_9,
  ).messages;
}

/// The prompt example at [path], relative to `conformance/`, lowered to
/// v0.9.
List<AgentToRendererMessage> loadExample(String path) => lowerMessages(
  jsonDecode(File('$conformanceRoot/$path').readAsStringSync())
      as List<Object?>,
);

/// [messages] as JSON in the v1.0 shape the suites are written in.
///
/// When [join] is true, a surface that v0.9 creates empty and then fills
/// becomes one `createSurface` carrying its components and initial data
/// model. [injectedCatalogId], if given, is removed from each
/// `createSurface` that names it.
List<Object?> liftMessages(
  List<AgentToRendererMessage> messages, {
  bool join = false,
  String? injectedCatalogId,
}) {
  final lifted = <Map<String, Object?>>[];
  for (final message in messages) {
    final Map<String, Object?> json = _renameReservedKeys(
      message.toJson(),
      lower: false,
    );
    final create = lifted.lastOrNull?['createSurface'] as Map<String, Object?>?;
    final Object? surfaceId = create?['surfaceId'];
    switch (json) {
      case {
            'updateComponents': {
              'surfaceId': final Object? id,
              'components': final Object? components,
            },
          }
          when join && id == surfaceId && !create!.containsKey('components'):
        create['components'] = components;
      case {
            'updateDataModel': {
              'surfaceId': final Object? id,
              'path': '/',
              'value': final Object? value,
            },
          }
          when join && id == surfaceId && !create!.containsKey('dataModel'):
        create['dataModel'] = value;
      case {'createSurface': final Map<String, Object?> create}:
        lifted.add({
          'version': swapVersion(json['version']),
          'createSurface': {...create}
            ..removeWhere(
              (key, value) =>
                  (key == 'sendDataModel' && value == false) ||
                  (key == 'catalogId' && value == injectedCatalogId),
            ),
        });
      default:
        lifted.add({...json, 'version': swapVersion(json['version'])});
    }
  }
  return lifted;
}

/// The v1.0 spelling of each key a data binding or function call reserves,
/// mapped to its v0.9 spelling.
const Map<String, String> _reservedKeys = {'@path': 'path', '@call': 'call'};

/// [message] with the reserved keys of its components, and of the function
/// a `callRendererFunction` names, renamed to v0.9 when [lower] is true and
/// to v1.0 otherwise.
Map<String, Object?> _renameReservedKeys(
  Map<String, Object?> message, {
  required bool lower,
}) => {
  for (final MapEntry<String, Object?> entry in message.entries)
    entry.key: switch (entry.value) {
      final Map<String, Object?> body => {
        for (final MapEntry<String, Object?> field in body.entries)
          field.key: field.key == 'components' || field.key == 'callFunction'
              ? _renameKeysIn(field.value, lower: lower)
              : field.value,
      },
      final Object? value => value,
    },
};

/// [node] with each reserved key renamed, except in a `ChildList` template,
/// whose `path` is unprefixed in both versions.
Object? _renameKeysIn(Object? node, {required bool lower}) => switch (node) {
  final List<Object?> list => [
    for (final Object? item in list) _renameKeysIn(item, lower: lower),
  ],
  final Map<String, Object?> map => {
    for (final MapEntry<String, Object?> entry in map.entries)
      (map.containsKey('componentId')
          ? entry.key
          : _renameKey(entry.key, lower)): _renameKeysIn(
        entry.value,
        lower: lower,
      ),
  },
  _ => node,
};

String _renameKey(String key, bool lower) =>
    (lower ? _reservedKeys : _liftedKeys)[key] ?? key;

final Map<String, String> _liftedKeys = {
  for (final MapEntry<String, String> entry in _reservedKeys.entries)
    entry.value: entry.key,
};

/// [parts] in the vocabulary of the suites, with messages lifted to v1.0.
List<Object?> liftParts(
  List<ResponsePart> parts, {
  bool join = false,
  String? injectedCatalogId,
}) => [
  for (final ResponsePart part in parts)
    switch (part) {
      TextPart(:final String text) => {'text': text},
      A2uiPart(:final List<AgentToRendererMessage> a2ui) => {
        'a2ui': liftMessages(
          a2ui,
          join: join,
          injectedCatalogId: injectedCatalogId,
        ),
      },
    },
];

/// Renderer capabilities written against v1.0, lowered to v0.9.
A2uiRendererCapabilities lowerCapabilities(Map<String, Object?> json) =>
    A2uiRendererCapabilities.fromJson({
      for (final MapEntry<String, Object?> entry in json.entries)
        '${swapVersion(entry.key)}': entry.value,
    });

/// Checks the catalog-level assertions of [expected] against [catalog].
///
/// A case's `protocol_version` is not checked, because an `a2ui_core`
/// catalog does not record the version its document declares.
void expectCatalog(CatalogApi catalog, Map<String, Object?> expected) {
  if (expected['catalog_id'] case final String id) expect(catalog.id, id);
  if (expected['components'] case final List<Object?> names) {
    expect(catalog.components.keys, unorderedEquals(names));
  }
  if (expected['functions'] case final List<Object?> names) {
    expect(catalog.functions.keys, unorderedEquals(names));
  }
}

/// Checks a prompt snippet against `expect_contains` and `expect_absent`,
/// or the `prompt_snippet_` forms of them, in [expected].
void expectSnippet(String snippet, Map<String, Object?> expected) {
  for (final key in ['expect_contains', 'prompt_snippet_contains']) {
    for (final Object? text in expected[key] as List<Object?>? ?? const []) {
      expect(snippet, contains(text));
    }
  }
  for (final key in ['expect_absent', 'prompt_snippet_absent']) {
    for (final Object? text in expected[key] as List<Object?>? ?? const []) {
      expect(snippet, isNot(contains(text)));
    }
  }
}

/// [expected] with `is_final: true` dropped, since a part is final unless it
/// says otherwise.
Object? withoutFinalFlags(Object? expected) => switch (expected) {
  List<Object?>() => expected.map(withoutFinalFlags).toList(),
  Map<String, Object?>() => {
    for (final MapEntry<String, Object?> entry in expected.entries)
      if (!(entry.key == 'is_final' && entry.value == true))
        entry.key: entry.value,
  },
  _ => expected,
};

/// [part] in the vocabulary of the suites.
Map<String, Object?> rawPartJson(RawResponsePart part) => switch (part) {
  TextPart(:final String text) => {'text': text},
  RawA2uiPart(:final String a2uiRaw, :final bool isFinal) => {
    'a2ui_raw': a2uiRaw,
    if (!isFinal) 'is_final': false,
  },
};

/// The raw parts a `wrap` case supplies.
List<RawResponsePart> rawParts(List<Object?> parts) => [
  for (final Object? part in parts)
    switch (part) {
      {'text': final String text} => TextPart(text),
      {'a2ui_raw': final String raw} => RawA2uiPart(
        raw,
        isFinal: (part as Map)['is_final'] as bool? ?? true,
      ),
      _ => throw ArgumentError.value(part, 'part'),
    },
];

/// Converts YAML nodes into plain Dart maps, lists and scalars.
Object? _plain(Object? node) => switch (node) {
  YamlMap() => {
    for (final MapEntry<Object?, Object?> entry in node.entries)
      entry.key.toString(): _plain(entry.value),
  },
  YamlList() => node.map(_plain).toList(),
  _ => node,
};

/// The `conformance/` directory, found by walking up from the working
/// directory.
final String conformanceRoot = () {
  Directory dir = Directory.current;
  while (!File(
    '${dir.path}/conformance/conformance_schema.json',
  ).existsSync()) {
    if (dir.parent.path == dir.path) {
      throw StateError('No conformance/ directory above ${Directory.current}.');
    }
    dir = dir.parent;
  }
  return '${dir.path}/conformance';
}();

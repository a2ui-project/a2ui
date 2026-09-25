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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// Runs the shared `conformance/agent/express/` suites against the Express
/// format.
///
/// The suites are written against v1.0, and this SDK compiles to v0.9, so the
/// harness lifts compiled messages into the v1.0 shape before comparing: a
/// `createSurface` followed by the `updateComponents` and `updateDataModel`
/// that fill it becomes one `createSurface` carrying `components` and
/// `dataModel`. The v1.0 catalog fixtures load as they are.
///
/// A case that needs something this SDK does not implement is skipped with
/// the reason.
void main() {
  for (final suite in [
    'compiler',
    'response_parser',
    'prompt_generator',
    'decompiler',
  ]) {
    final path = 'agent/express/$suite.yaml';
    group('conformance $path', () {
      final List<Map<String, Object?>> cases = _loadSuite(path);
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
}

/// Suite-level error categories mapped onto this SDK's exception types.
final Map<String, Matcher> _errors = {
  'ParseError': isA<A2uiParseError>(),
  'ValidationError': isA<A2uiValidationError>(),
  'CatalogError': isA<A2uiCatalogError>(),
};

/// Why this SDK cannot run [testCase], or null if it can.
String? _skipReason(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  switch (testCase['action']) {
    case 'wrap':
      return 'Parser.wrap is not implemented.';
    case 'decompile':
      return 'Express decompilation is not implemented.';
  }
  if (args.containsKey('examples')) {
    return 'Prompt examples are not implemented.';
  }
  if (args.containsKey('allowed_messages')) {
    return 'Message allowlists are not implemented.';
  }
  final Object? catalogs = args['catalogs'];
  if (catalogs is List &&
      catalogs.any((c) => c is Map && c.containsKey('transformers'))) {
    return 'Catalog transformers are not implemented.';
  }
  if (jsonEncode(testCase['expect']).contains('"callRendererFunction"')) {
    return 'Protocol v0.9 has no callRendererFunction message.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final Object? error = testCase['expect_error'];
  if (error != null) {
    final category = (error as Map<String, Object?>)['category']! as String;
    expect(() => _perform(testCase), throwsA(_errors[category]!));
    return;
  }
  final Object? result = _perform(testCase);
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      _checkSnippet(testCase, result! as String);
    case 'compile':
      final messages = result! as List<Object?>;
      for (final Object? pointer
          in (testCase['expect_present'] as List<Object?>?) ?? const []) {
        _removePresent(messages, pointer! as String);
      }
      expect(messages, testCase['expect']);
    default:
      expect(result, _withoutFinalFlags(testCase['expect']));
  }
}

/// Performs the call a case names, with its result in the suite's
/// vocabulary.
Object? _perform(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final InferenceFormat format = const ExpressFormatFactory().createFormat(
    _catalogs(args),
  );
  final input = testCase['input'] as String?;
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      return format.promptGenerator.generate();
    case 'unwrap':
      return [
        for (final RawResponsePart part in format.createParser().unwrap(input!))
          _rawPart(part),
      ];
    case 'compile':
      return _lift(format.createParser().compile(input!));
    case 'parse_response':
      return [
        for (final ResponsePart part in format.createParser().parseResponse(
          input!,
          wrapped: args['wrapped'] as bool? ?? true,
        ))
          switch (part) {
            TextPart(:final String text) => {'text': text},
            A2uiPart(:final List<AgentToRendererMessage> a2ui) => {
              'a2ui': _lift(a2ui),
            },
          },
      ];
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

void _checkSnippet(Map<String, Object?> testCase, String snippet) {
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(snippet, contains(text));
  }
  for (final Object? text
      in (testCase['expect_absent'] as List<Object?>?) ?? const []) {
    expect(snippet, isNot(contains(text)));
  }
  if (testCase['expect_deterministic'] == true) {
    expect(_perform(testCase), snippet);
  }
}

Map<String, Object?> _rawPart(RawResponsePart part) => switch (part) {
  TextPart(:final String text) => {'text': text},
  RawA2uiPart(:final String a2uiRaw, :final bool isFinal) => {
    'a2ui_raw': a2uiRaw,
    if (!isFinal) 'is_final': false,
  },
};

/// [expected] with `is_final: true` dropped, since a part is final unless it
/// says otherwise.
Object? _withoutFinalFlags(Object? expected) => switch (expected) {
  List<Object?>() => expected.map(_withoutFinalFlags).toList(),
  Map<String, Object?>() => {
    for (final MapEntry<String, Object?> entry in expected.entries)
      if (!(entry.key == 'is_final' && entry.value == true))
        entry.key: entry.value,
  },
  _ => expected,
};

/// [messages] as JSON in the v1.0 shape the suites are written in.
///
/// A surface that v0.9 creates empty and then fills becomes one
/// `createSurface` carrying its components and initial data model.
List<Object?> _lift(List<AgentToRendererMessage> messages) {
  final lifted = <Map<String, Object?>>[];
  for (final message in messages) {
    final Map<String, Object?> json = message.toJson();
    final create = lifted.lastOrNull?['createSurface'] as Map<String, Object?>?;
    final Object? surfaceId = create?['surfaceId'];
    switch (json) {
      case {
            'updateComponents': {
              'surfaceId': final Object? id,
              'components': final Object? components,
            },
          }
          when id == surfaceId && !create!.containsKey('components'):
        create['components'] = components;
      case {
            'updateDataModel': {
              'surfaceId': final Object? id,
              'path': '/',
              'value': final Object? value,
            },
          }
          when id == surfaceId && !create!.containsKey('dataModel'):
        create['dataModel'] = value;
      case {'createSurface': final Map<String, Object?> create}:
        lifted.add({
          'version': 'v1.0',
          'createSurface': {...create}
            ..removeWhere(
              (key, value) => key == 'sendDataModel' && value == false,
            ),
        });
      default:
        lifted.add({...json, 'version': 'v1.0'});
    }
  }
  return lifted;
}

/// Asserts that the JSON Pointer [pointer] names a value that is not empty
/// in [messages], and removes it.
void _removePresent(List<Object?> messages, String pointer) {
  final List<String> keys = pointer.split('/').skip(1).toList();
  Object? parent = messages;
  for (final String key in keys.take(keys.length - 1)) {
    parent = parent is List ? parent[int.parse(key)] : (parent! as Map)[key];
  }
  final Object? value = (parent! as Map).remove(keys.last);
  expect(value, isNotNull, reason: '$pointer is present');
  expect(value, isNot(isEmpty), reason: '$pointer is not empty');
}

List<SchemaCatalog> _catalogs(Map<String, Object?> args) => [
  if (args['catalog'] case final String path) _catalog(path),
  if (args['catalogs'] case final List<Object?> entries)
    for (final Object? entry in entries)
      _catalog(switch (entry) {
        {'catalog': final String path} => path,
        _ => entry! as String,
      }),
];

final Map<String, SchemaCatalog> _catalogCache = {};

SchemaCatalog _catalog(String path) => _catalogCache.putIfAbsent(
  path,
  () => Catalog.fromJson(
    jsonDecode(File('$_root/$path').readAsStringSync()) as Map<String, Object?>,
  ),
);

List<Map<String, Object?>> _loadSuite(String path) => [
  for (final Object? node
      in loadYaml(File('$_root/$path').readAsStringSync()) as YamlList)
    _plain(node)! as Map<String, Object?>,
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
final String _root = () {
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

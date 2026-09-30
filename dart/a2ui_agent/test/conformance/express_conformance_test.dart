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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

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
      final List<Map<String, Object?>> cases = loadSuite(path);
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
  if (testCase['action'] == 'decompile') {
    return 'Express decompilation is not implemented.';
  }
  if (testCase['name'] == 'test_express_snippet_omits_a_pruned_component') {
    return 'The Express syntax rules show `root = Card(...)`, so the snippet '
        'contains "Card(" even when Card is pruned.';
  }
  if (args.containsKey('examples')) {
    return 'Prompt examples are not implemented.';
  }
  if (args.containsKey('allowed_messages')) {
    return 'Message allowlists are not implemented.';
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
    case 'wrap':
      _checkWrapped(testCase, result! as String);
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
    case 'wrap':
      return format.createParser().wrap([
        for (final Object? part in testCase['parts']! as List<Object?>)
          switch (part) {
            {'text': final String text} => TextPart(text),
            {'a2ui_raw': final String raw} => RawA2uiPart(
              raw,
              isFinal: (part as Map)['is_final'] as bool? ?? true,
            ),
            _ => throw ArgumentError.value(part, 'part'),
          },
      ]);
    case 'unwrap':
      return _unwrap(format, input!);
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

/// Checks the output of a `wrap` case, and that unwrapping it returns the
/// parts the case supplied when the case asks.
void _checkWrapped(Map<String, Object?> testCase, String output) {
  if (testCase['expect_output'] case final String expected) {
    expect(output, expected);
  }
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(output, contains(text));
  }
  if (testCase['expect_round_trip'] == true) {
    final args = testCase['args']! as Map<String, Object?>;
    final InferenceFormat format = const ExpressFormatFactory().createFormat(
      _catalogs(args),
    );
    expect(_unwrap(format, output), _withoutFinalFlags(testCase['parts']));
  }
}

List<Map<String, Object?>> _unwrap(InferenceFormat format, String content) => [
  for (final RawResponsePart part in format.createParser().unwrap(content))
    _rawPart(part),
];

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

/// The catalogs a case names, each after the transformers registered with
/// it.
List<SchemaCatalog> _catalogs(Map<String, Object?> args) => [
  if (args['catalog'] case final Object catalog)
    catalogConfig(catalog).transformedCatalog,
  if (args['catalogs'] case final List<Object?> entries)
    for (final Object? entry in entries)
      catalogConfig(entry).transformedCatalog,
];

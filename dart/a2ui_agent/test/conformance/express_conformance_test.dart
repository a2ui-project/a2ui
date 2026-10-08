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
/// harness moves messages between the two as `suites.dart` describes. The
/// Express suites write a created surface in the joined v1.0 form, a
/// `createSurface` carrying its `components` and `dataModel`.
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

/// Cases this SDK does not pass yet, with the reason for each.
const Map<String, String> _knownGaps = {
  'test_compile_express_checks_on_uncheckable_component_is_a_validation_error':
      'Does not reject check lists on components without checks '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_compile_express_inline_array_id_collision_is_a_validation_error':
      'Does not reject inline array child IDs colliding with variables '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_compile_express_inline_id_collision_is_a_validation_error':
      'Does not reject inline child IDs colliding with variables '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_compile_express_surface_targeting_names_a_catalog':
      'Multi-catalog Express in Dart compiles to v0.9 and has not been updated '
      'to omit createSurface.catalogId and stamp catalogId per component.',
  'test_decompile_express_check_with_arg_omits_default_message':
      'Does not decompile check rules when value is not bound on the component '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_check_with_custom_message':
      'Does not decompile check rules when value is not bound on the component '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_check_with_default_message_omits_parens':
      'Does not decompile check rules when value is not bound on the component '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_event_action_with_nested_context':
      'Does not recursively format nested maps in Event context '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_raw_triple_quoted_multiline_string':
      'Does not emit raw triple-quoted strings for multiline backslash strings '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_several_checks_in_one_list':
      'Does not decompile check rules when value is not bound on the component '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_two_surfaces_in_two_catalogs':
      'Multi-catalog Express in Dart compiles to v0.9 and has not been updated '
      'to omit createSurface.catalogId and stamp catalogId per component.',
  'test_decompile_express_update_data_model_map_at_path':
      'Does not decompile updateDataModel with a non-root path '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
  'test_decompile_express_update_data_model_scalar_at_path':
      'Does not decompile updateDataModel with a non-root path '
      '(https://github.com/a2ui-project/a2ui/issues/3100).',
};

/// Why this SDK cannot run [testCase], or null if it can.
String? _skipReason(Map<String, Object?> testCase) {
  if (_knownGaps[testCase['name']] case final String reason) return reason;
  if (jsonEncode(testCase).contains('"callRendererFunction"')) {
    return 'Protocol v0.9 has no callRendererFunction message.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final Object? error = testCase['expect_error'];
  if (error != null) {
    expect(() => _perform(testCase), throwsCategory(error));
    return;
  }
  final Object? result = _perform(testCase);
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      _checkSnippet(testCase, result! as String);
    case 'wrap':
      _checkWrapped(testCase, result! as String);
    case 'decompile':
      _checkDecompiled(testCase, result! as String);
    case 'compile':
      final messages = result! as List<Object?>;
      for (final Object? pointer
          in (testCase['expect_present'] as List<Object?>?) ?? const []) {
        _removePresent(messages, pointer! as String);
      }
      expect(messages, testCase['expect']);
    default:
      expect(result, withoutFinalFlags(testCase['expect']));
  }
}

InferenceFormat _format(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  return ExpressFormatFactory(
    allowedMessages: (args['allowed_messages'] as List<Object?>?)
        ?.cast<String>(),
  ).createFormat(
    caseCatalogs(args),
    examples: [
      for (final Object? path in args['examples'] as List<Object?>? ?? const [])
        loadExample(path! as String),
    ],
  );
}

/// Performs the call a case names, with its result in the suite's
/// vocabulary.
Object? _perform(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final InferenceFormat format = _format(testCase);
  final input = testCase['input'] as String?;
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      return format.promptGenerator.generate();
    case 'wrap':
      return format.createParser().wrap(
        rawParts(testCase['parts']! as List<Object?>),
      );
    case 'unwrap':
      return [
        for (final RawResponsePart part in format.createParser().unwrap(input!))
          rawPartJson(part),
      ];
    case 'compile':
      return liftMessages(format.createParser().compile(input!), join: true);
    case 'decompile':
      return format.createParser().decompile(_messages(testCase));
    case 'parse_response':
      return liftParts(
        format.createParser().parseResponse(
          input!,
          wrapped: args['wrapped'] as bool? ?? true,
        ),
        join: true,
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

/// The messages a `decompile` case starts from, lowered to v0.9.
List<AgentToRendererMessage> _messages(Map<String, Object?> testCase) =>
    lowerMessages(testCase['messages']! as List<Object?>);

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
    expect([
      for (final RawResponsePart part in _format(
        testCase,
      ).createParser().unwrap(output))
        rawPartJson(part),
    ], withoutFinalFlags(testCase['parts']));
  }
}

/// Checks the output of a `decompile` case, and that compiling it returns
/// the messages the case started from when the case asks.
void _checkDecompiled(Map<String, Object?> testCase, String output) {
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(output, contains(text));
  }
  if (testCase['expect_round_trip'] == true) {
    expect(
      liftMessages(
        _format(testCase).createParser().compile(output),
        join: true,
      ),
      testCase['messages'],
      reason: 'Express written:\n$output',
    );
  }
}

void _checkSnippet(Map<String, Object?> testCase, String snippet) {
  expectSnippet(snippet, testCase);
  if (testCase['expect_deterministic'] == true) {
    expect(_perform(testCase), snippet);
  }
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

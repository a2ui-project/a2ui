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
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/express/` suites against the Express
/// format, in each [SuiteVersion].
///
/// Lowered to v0.9, the harness moves messages between v1.0 and v0.9 as
/// `suites.dart` describes. The Express suites write a created surface in the
/// joined v1.0 form, a `createSurface` carrying its `components` and
/// `dataModel`.
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
    for (final SuiteVersion version in SuiteVersion.values) {
      group('conformance $path ${version.label}', () {
        final List<Map<String, Object?>> cases = loadSuite(path);
        test('suite is not empty', () => expect(cases, isNotEmpty));
        for (final testCase in cases) {
          test(
            testCase['name']! as String,
            () => _runCase(testCase, version),
            skip: _skipReason(testCase, version),
          );
        }
      });
    }
  }
}

const String _oneCatalogPerSurface =
    'v0.9 names one catalog per surface, so the case runs as written in v1.0 '
    'only.';

/// Cases that state what v0.9 cannot, or that are already written against a
/// v0.9 catalog, so they run in [SuiteVersion.v1_0] (as written) only, with
/// the reason for each.
const Map<String, String> _v1OnlyCases = {
  'test_compile_express_surface_targeting_names_a_catalog':
      _oneCatalogPerSurface,
  'test_decompile_express_two_surfaces_in_two_catalogs': _oneCatalogPerSurface,
  'test_decompile_express_event_action_with_nested_context':
      'A v0.9 DynamicValue holds no map, so a map in an event\'s context runs '
      'as written in v1.0 only.',
  'test_decompile_express_non_identifier_id_before_v1_0_derives_a_variable':
      'Already written against a v0.9 catalog to test pre-v1.0 component id '
      'derivation, so it runs as written without lowering.',
  'test_decompile_express_non_identifier_id_from_v1_0_is_a_validation_error':
      'Before v1.0, component ids that are not UAX 31 identifiers are derived '
      'into variables rather than rejected.',
  'test_compile_express_non_identifier_id_from_v1_0_is_a_validation_error':
      'Before v1.0, component ids need not be UAX 31 identifiers.',
};

/// Why this SDK cannot run [testCase] in [version], or null if it can.
String? _skipReason(Map<String, Object?> testCase, SuiteVersion version) {
  if (version == SuiteVersion.v1_0) return null;
  if (_v1OnlyCases[testCase['name']] case final String reason) return reason;
  if (jsonEncode(testCase).contains('"callRendererFunction"')) {
    return 'Protocol v0.9 has no callRendererFunction message.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  final Object? error = testCase['expect_error'];
  if (error != null) {
    expectThrowsCategory(() => _perform(testCase, version), error);
    return;
  }
  final Object? result = _perform(testCase, version);
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      _checkSnippet(testCase, version, result! as String);
    case 'wrap':
      _checkWrapped(testCase, version, result! as String);
    case 'decompile':
      _checkDecompiled(testCase, version, result! as String);
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

InferenceFormat _format(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  return ExpressFormatFactory(
    allowedMessages: (args['allowed_messages'] as List<Object?>?)
        ?.cast<String>(),
  ).createFormat(
    version.catalogs(args),
    examples: [
      for (final Object? path in args['examples'] as List<Object?>? ?? const [])
        version.example(path! as String),
    ],
  );
}

/// Performs the call a case names, with its result in the suite's
/// vocabulary.
Object? _perform(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  final InferenceFormat format = _format(testCase, version);
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
      return version.messagesJson(
        format.createParser().compile(input!),
        join: true,
      );
    case 'decompile':
      return format.createParser().decompile(
        version.messages(testCase['messages']! as List<Object?>),
      );
    case 'parse_response':
      return version.partsJson(
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

/// Checks the output of a `wrap` case, and that unwrapping it returns the
/// parts the case supplied when the case asks.
void _checkWrapped(
  Map<String, Object?> testCase,
  SuiteVersion version,
  String output,
) {
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
        version,
      ).createParser().unwrap(output))
        rawPartJson(part),
    ], withoutFinalFlags(testCase['parts']));
  }
}

/// Checks the output of a `decompile` case, and that compiling it returns
/// the messages the case started from when the case asks.
void _checkDecompiled(
  Map<String, Object?> testCase,
  SuiteVersion version,
  String output,
) {
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(output, contains(text));
  }
  if (testCase['expect_round_trip'] == true) {
    expect(
      version.messagesJson(
        _format(testCase, version).createParser().compile(output),
        join: true,
      ),
      testCase['messages'],
      reason: 'Express written:\n$output',
    );
  }
  if (testCase['expect_recompiled'] case final Object expected) {
    expect(
      version.messagesJson(
        _format(testCase, version).createParser().compile(output),
        join: true,
      ),
      expected,
      reason: 'Express written:\n$output',
    );
  }
}

void _checkSnippet(
  Map<String, Object?> testCase,
  SuiteVersion version,
  String snippet,
) {
  expectSnippet(snippet, testCase);
  if (testCase['expect_deterministic'] == true) {
    expect(_perform(testCase, version), snippet);
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

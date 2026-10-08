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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/direct_json/` suites against the direct
/// JSON format.
///
/// The suites are written against v1.0, and this SDK reads and writes v0.9,
/// so the harness lowers each payload before the parser reads it and lifts
/// what the parser returns, as `suites.dart` describes. The direct JSON
/// suites write each message on its own, so nothing is joined. A case whose
/// catalog declares v1.0 runs with `bufferIncompleteComponents` on, as a
/// v1.0 agent configures it.
void main() {
  for (final suite in [
    'compiler',
    'decompiler',
    'prompt_generator',
    'response_parser',
    'response_streaming',
  ]) {
    final path = 'agent/direct_json/$suite.yaml';
    group('conformance $path', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        test(testCase['name']! as String, () => _runCase(testCase));
      }
    });
  }
}

void _runCase(Map<String, Object?> testCase) {
  switch (testCase['action']) {
    case 'parse_chunk':
      _runChunks(testCase);
      return;
  }
  final Object? error = testCase['expect_error'];
  if (error != null) {
    expect(() => _perform(testCase), throwsCategory(error));
    return;
  }
  final Object? result = _perform(testCase);
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      expectSnippet(result! as String, testCase);
      if (testCase['expect_deterministic'] == true) {
        expect(_perform(testCase), result);
      }
    case 'wrap':
      _checkWrapped(testCase, result! as String);
    case 'decompile':
      _checkDecompiled(testCase, result! as String);
    default:
      expect(result, withoutFinalFlags(testCase['expect']));
  }
}

InferenceFormat _format(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  return DirectJsonFormatFactory(
    allowedMessages: (args['allowed_messages'] as List<Object?>?)
        ?.cast<String>(),
    progressiveKeys: {
      ...?(args['progressive_keys'] as List<Object?>?)?.cast<String>(),
    },
    bufferIncompleteComponents: caseDeclaresV1(args),
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
  final String? catalogId = injectedCatalogId(testCase);
  final String? input = switch (testCase['input']) {
    final String text => lowerText(text, catalogId: catalogId),
    _ => null,
  };
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      return format.promptGenerator.generate();
    case 'wrap':
      return format.createParser().wrap(
        rawParts(testCase['parts']! as List<Object?>),
      );
    case 'unwrap':
      // Unwrapping keeps the payload as written, so it is not lowered.
      return [
        for (final RawResponsePart part in format.createParser().unwrap(
          testCase['input']! as String,
        ))
          rawPartJson(part),
      ];
    case 'compile':
      return liftMessages(
        format.createParser().compile(input!),
        injectedCatalogId: catalogId,
      );
    case 'decompile':
      return format.createParser().decompile(
        lowerMessages(testCase['messages']! as List<Object?>),
      );
    case 'parse_response':
      return liftParts(
        format.createParser().parseResponse(
          input!,
          wrapped: args['wrapped'] as bool? ?? true,
        ),
        injectedCatalogId: catalogId,
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

/// Feeds the steps of a `parse_chunk` case to one parser, checking what each
/// yields, and then the whole response to another parser in one call when
/// the case asks.
void _runChunks(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final bool wrapped = args['wrapped'] as bool? ?? true;
  final String? catalogId = injectedCatalogId(testCase);
  final Parser parser = _format(testCase).createParser();
  final chunks = <String>[];
  final yielded = <Object?>[];
  for (final (int i, Object? step)
      in (testCase['steps']! as List<Object?>).indexed) {
    final stepCase = step! as Map<String, Object?>;
    final String chunk = lowerText(
      stepCase['input']! as String,
      catalogId: catalogId,
    );
    chunks.add(chunk);
    if (stepCase['expect_error'] case final Object error) {
      expect(
        () => parser.parseChunk(chunk, wrapped: wrapped),
        throwsCategory(error),
        reason: 'step $i',
      );
      return;
    }
    final List<Object?> parts = liftParts(
      parser.parseChunk(chunk, wrapped: wrapped),
      injectedCatalogId: catalogId,
    );
    expect(parts, stepCase['expect'], reason: 'step $i: ${stepCase['input']}');
    yielded.addAll(parts);
  }
  if (testCase['expect_matches_single_shot'] == true) {
    expect(
      liftParts(
        _format(
          testCase,
        ).createParser().parseResponse(chunks.join(), wrapped: wrapped),
        injectedCatalogId: catalogId,
      ),
      yielded,
    );
  }
}

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

void _checkDecompiled(Map<String, Object?> testCase, String output) {
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(output, contains(text));
  }
  if (testCase['expect_round_trip'] == true) {
    final List<AgentToRendererMessage> recompiled = _format(
      testCase,
    ).createParser().compile(output);
    expect(
      liftMessages(recompiled),
      testCase['messages'],
      reason: 'JSON written:\n$output',
    );
  }
}

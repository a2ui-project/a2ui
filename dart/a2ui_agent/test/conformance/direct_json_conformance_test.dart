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
/// v1.0 agent configures it. A streaming case whose catalog declares v0.9
/// already speaks this SDK's version and runs as written, and one whose
/// catalog declares v0.8 is skipped, since this SDK does not implement it.
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
        test(
          testCase['name']! as String,
          () => _runCase(testCase),
          skip: _skipReason(testCase),
        );
      }
    });
  }
}

/// v1.0 streaming cases that rely on what v0.9 cannot state: a component
/// naming its own catalog, or a `createSurface` carrying components and a
/// data model, which only lowering a whole payload can split.
const Set<String> _v1OnlyStreamingCases = {
  'test_stream_create_surface_inline_components_v10',
  'test_stream_create_surface_inline_components_in_small_chunks_v10',
  'test_stream_multi_catalog_resolution_v10',
  'test_stream_component_without_catalog_uses_surface_catalog_v10',
  'test_stream_component_catalog_id_arrives_late_v10',
  'test_stream_catalog_id_split_across_chunks_v10',
};

/// Streaming cases this SDK does not pass yet, each with the behavior it
/// lacks.
const Map<String, String> _knownStreamingGaps = {
  'test_stream_incremental_yielding_v09': _createHeld,
  'test_stream_create_surface_held_until_closed_v09': _createHeld,
  'test_stream_orphan_component_fails_v09': _treeChecked,
  'test_stream_circular_reference_fails_v09': _treeChecked,
  'test_stream_self_reference_fails_v09': _treeChecked,
  'test_stream_update_before_create_surface_fails_v09': _surfaceFirst,
  'test_stream_data_model_before_create_surface_fails_v09': _surfaceFirst,
  'test_stream_cut_surrogate_pair_v09':
      'Known gap: a string cut inside an escaped surrogate pair is healed '
      'with U+FFFD rather than cut before the pair.',
};

const String _createHeld =
    'Known gap: a createSurface is emitted before its object closes, so it '
    'is emitted again as it grows.';
const String _treeChecked =
    'Known gap: a streamed tree is not checked for orphans and cycles when '
    'the block closes.';
const String _surfaceFirst =
    'Known gap: a message for a surface the block has not created yet is '
    'not rejected when the block closes.';

/// Why a case is skipped, or null when it runs.
String? _skipReason(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  if (caseCatalogVersion(args) == '0.8') {
    return 'This SDK does not implement v0.8.';
  }
  if (_v1OnlyStreamingCases.contains(testCase['name'])) {
    return 'This SDK implements v0.9, which cannot state what the case '
        'streams.';
  }
  return _knownStreamingGaps[testCase['name']];
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
///
/// A case whose catalog declares v0.9 is written in this SDK's version, so
/// its chunks and what the parser yields are compared as they are, without
/// lowering or lifting.
void _runChunks(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final bool wrapped = args['wrapped'] as bool? ?? true;
  final asWritten = caseCatalogVersion(args) == '0.9';
  final String? catalogId = asWritten ? null : injectedCatalogId(testCase);
  List<Object?> lift(List<ResponsePart> parts) => asWritten
      ? _partsAsWritten(parts)
      : liftParts(parts, injectedCatalogId: catalogId);
  final Parser parser = _format(testCase).createParser();
  final chunks = <String>[];
  final yielded = <Object?>[];
  for (final (int i, Object? step)
      in (testCase['steps']! as List<Object?>).indexed) {
    final stepCase = step! as Map<String, Object?>;
    final input = stepCase['input']! as String;
    final String chunk = asWritten
        ? input
        : lowerText(input, catalogId: catalogId);
    chunks.add(chunk);
    if (stepCase['expect_error'] case final Object error) {
      expect(
        () => parser.parseChunk(chunk, wrapped: wrapped),
        throwsCategory(error),
        reason: 'step $i',
      );
      return;
    }
    final List<Object?> parts = lift(
      parser.parseChunk(chunk, wrapped: wrapped),
    );
    expect(parts, stepCase['expect'], reason: 'step $i: ${stepCase['input']}');
    yielded.addAll(parts);
  }
  if (testCase['expect_matches_single_shot'] == true) {
    expect(
      lift(
        _format(
          testCase,
        ).createParser().parseResponse(chunks.join(), wrapped: wrapped),
      ),
      yielded,
    );
  }
}

/// [parts] in the vocabulary of the suites, with messages as this SDK writes
/// them, less the `sendDataModel: false` a v0.9 `createSurface` states.
List<Object?> _partsAsWritten(List<ResponsePart> parts) => [
  for (final ResponsePart part in parts)
    switch (part) {
      TextPart(:final String text) => {'text': text},
      A2uiPart(:final List<AgentToRendererMessage> a2ui) => {
        'a2ui': [
          for (final AgentToRendererMessage message in a2ui)
            {
              for (final MapEntry<String, Object?> entry
                  in message.toJson().entries)
                entry.key: switch (entry.value) {
                  final Map<String, Object?> body
                      when entry.key == 'createSurface' =>
                    {...body}..removeWhere(
                      (key, value) => key == 'sendDataModel' && value == false,
                    ),
                  final Object? value => value,
                },
            },
        ],
      },
    },
];

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

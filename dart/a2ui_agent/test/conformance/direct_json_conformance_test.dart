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
/// JSON format, in each [SuiteVersion].
///
/// Lowered to v0.9, the harness lowers each payload before the parser reads
/// it and lifts what the parser returns, as `suites.dart` describes. The
/// direct JSON suites write each message on its own, so nothing is joined. A
/// case whose catalog declares v1.0 runs with `bufferIncompleteComponents`
/// on, so that a v0.9 parser holds components back as a v1.0 parser always
/// does. A streaming case whose catalog declares
/// v0.9 already speaks that version and runs as written, and one whose
/// catalog declares v0.8 is skipped, since this SDK does not implement it.
///
/// As written in v1.0, only the cases whose catalogs target v1.0 run.
const Map<String, Set<String>> _knownKeys = {
  'case:compile': {
    ...caseMetadataKeys,
    'args',
    'expect',
    'expect_error',
    'input',
  },
  'case:decompile': {
    ...caseMetadataKeys,
    'args',
    'expect_contains',
    'expect_round_trip',
    'messages',
  },
  'case:generate_prompt_snippet': {
    ...caseMetadataKeys,
    'args',
    'expect_deterministic',
    'expect_error',
    'expect_file',
  },
  'case:has_format_content': {...caseMetadataKeys, 'args', 'expect', 'input'},
  'case:parse_chunk': {
    ...caseMetadataKeys,
    'args',
    'expect_close',
    'expect_matches_single_shot',
    'steps',
  },
  'case:parse_response': {
    ...caseMetadataKeys,
    'args',
    'expect',
    'expect_error',
    'input',
  },
  'case:unwrap': {...caseMetadataKeys, 'args', 'expect', 'input'},
  'case:wrap': {
    ...caseMetadataKeys,
    'args',
    'expect_contains',
    'expect_output',
    'expect_round_trip',
    'parts',
  },
  'args:compile': {'catalog', 'format'},
  'args:decompile': {'catalog', 'catalogs', 'format'},
  'args:generate_prompt_snippet': {
    'allowed_messages',
    'catalogs',
    'examples',
    'format',
  },
  'args:has_format_content': {'complete', 'format'},
  'args:parse_chunk': {
    'after_rejected_block',
    'catalog',
    'catalogs',
    'format',
    'progressive_keys',
    'wrapped',
  },
  'args:parse_response': {'catalog', 'format', 'wrapped'},
  'args:unwrap': {'format'},
  'args:wrap': {'format'},
  'step:parse_chunk': {
    'expect',
    'expect_error',
    'expect_in_block',
    'expect_partial_results',
    'input',
  },
};

void main() {
  final allCaseNames = <String>{};
  for (final suite in [
    'compiler',
    'decompiler',
    'prompt_generator',
    'response_parser',
    'response_streaming',
  ]) {
    final path = 'agent/direct_json/$suite.yaml';
    for (final SuiteVersion version in SuiteVersion.values) {
      group('conformance $path ${version.label}', () {
        final List<Map<String, Object?>> cases = loadSuite(path);
        test('suite is not empty', () => expect(cases, isNotEmpty));
        for (final testCase in cases) {
          final name = testCase['name']! as String;
          allCaseNames.add(name);
          if (version == SuiteVersion.v1_0 && !_targetsV1(testCase)) continue;
          test(name, () => _runCase(testCase, version));
        }
      });
    }
  }
  verifyNoUnusedEntries('direct_json', allCaseNames, _v1OnlyCases);
}

/// v1.0 streaming cases that rely on what v0.9 cannot state: a component
/// naming its own catalog, or a `createSurface` carrying components and a
/// data model, which only lowering a whole payload can split.
const Set<String> _v1OnlyCases = {
  'test_compile_json_newline_in_create_surface_data_model_preserved',
  'test_parse_response_call_renderer_function_renderer_or_agent_succeeds',
  'test_parse_response_call_renderer_function_agent_only_succeeds',
  'test_parse_response_call_renderer_function_renderer_only_is_validation_error',
  'test_parse_response_call_renderer_function_user_activation_is_validation_error',
  'test_stream_create_surface_inline_components_v10',
  'test_stream_create_surface_inline_components_in_small_chunks_v10',
  'test_stream_multi_catalog_resolution_v10',
  'test_stream_component_catalog_id_arrives_late_v10',
  'test_stream_catalog_id_split_across_chunks_v10',
  'test_stream_second_block_calling_renderer_only_function_fails_v10',
};

/// Whether the catalogs of [testCase] target v1.0, as most cases' do.
bool _targetsV1(Map<String, Object?> testCase) =>
    switch (caseCatalogVersion(testCase['args']! as Map<String, Object?>)) {
      null || '1.0' => true,
      _ => false,
    };

/// Why a case is skipped in [version], or null when it runs.
String? _skipReason(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  if (caseCatalogVersion(args) == '0.8') {
    return 'This SDK does not implement v0.8.';
  }
  if (version == SuiteVersion.v0_9) {
    if (_v1OnlyCases.contains(testCase['name'])) {
      return 'v0.9 cannot state what the case carries.';
    }
    if (testCase['action'] == 'generate_prompt_snippet') {
      return 'The snippet embeds the schemas of the catalogs\' version, so '
          'the case runs as written in v1.0 only.';
    }
  }
  return null;
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  if (_skipReason(testCase, version) case final String reason) {
    markTestSkipped(reason);
    return;
  }
  final action = testCase['action'] as String?;
  final Set<String>? allowedCaseKeys = _knownKeys['case:$action'];
  if (allowedCaseKeys == null) {
    throw UnsupportedError('Unknown action $action');
  }
  assertKnownKeys(testCase, allowedCaseKeys, 'case:$action');
  final args = testCase['args']! as Map<String, Object?>;
  assertKnownKeys(args, _knownKeys['args:$action']!, 'args:$action');
  expect(args['format'], 'direct_json');
  switch (action) {
    case 'parse_chunk':
      _runChunks(testCase, version);
      return;
  }
  final Object? error = testCase['expect_error'];
  if (error != null) {
    expectThrowsCategory(() => _perform(testCase, version), error);
    return;
  }
  final Object? result = _perform(testCase, version);
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      expectSnippet(result! as String, testCase);
      if (testCase['expect_deterministic'] == true) {
        expect(_perform(testCase, version), result);
      }
    case 'wrap':
      _checkWrapped(testCase, version, result! as String);
    case 'decompile':
      _checkDecompiled(testCase, version, result! as String);
    default:
      expect(result, withoutFinalFlags(testCase['expect']));
  }
}

InferenceFormat _format(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  return DirectJsonFormatFactory(
    allowedMessages:
        (args['allowed_messages'] as List<Object?>?)?.cast<String>(),
    progressiveKeys: {
      ...?(args['progressive_keys'] as List<Object?>?)?.cast<String>(),
    },
    bufferIncompleteComponents: caseDeclaresV1(args),
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
  final String? catalogId = version.injectedCatalog(testCase);
  final String? input = switch (testCase['input']) {
    final String text => version.text(text, catalogId: catalogId),
    _ => null,
  };
  switch (testCase['action']) {
    case 'generate_prompt_snippet':
      return format.promptGenerator.generate();
    case 'wrap':
      return format.createParser().wrap(
            rawParts(testCase['parts']! as List<Object?>),
          );
    case 'has_format_content':
      return format.createParser().hasFormatContent(
            testCase['input']! as String,
            complete: args['complete'] as bool? ?? false,
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
      return version.messagesJson(
        compileChecked(format.createParser(), input!),
        injectedCatalogId: catalogId,
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
        injectedCatalogId: catalogId,
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

/// Feeds the steps of a `parse_chunk` case to one stream, checking what each
/// yields, whether the stream is then inside a block, and the partial results
/// of a step that fails. Then checks what closing the stream yields, and
/// parses the whole response with a new parser in one call when the case
/// asks.
///
/// A case with `after_rejected_block: continue` reads through
/// [Parser.openContinuingStream].
///
/// A case whose catalog declares v0.9 is written in that version, so its
/// chunks and what the stream yields are compared as they are, without
/// lowering or lifting.
void _runChunks(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  final bool wrapped = args['wrapped'] as bool? ?? true;
  final SuiteVersion written =
      caseCatalogVersion(args) == '0.9' ? SuiteVersion.v1_0 : version;
  final String? catalogId = written.injectedCatalog(testCase);
  List<Object?> lift(List<StreamPart> parts) =>
      written.partsJson(parts, injectedCatalogId: catalogId);
  final Parser parser = _format(testCase, version).createParser();
  final ResponseReader<StreamPart> stream =
      args['after_rejected_block'] == 'continue'
          ? parser.openContinuingStream(wrapped: wrapped)
          : parser.openStream(wrapped: wrapped);
  void expectInBlock(Map<String, Object?> step, int i) {
    if (step['expect_in_block'] case final bool inBlock) {
      expect(stream.isInBlock, inBlock, reason: 'step $i: in block');
    }
  }

  final chunks = <String>[];
  final yielded = <Object?>[];
  for (final (int i, Object? step)
      in (testCase['steps']! as List<Object?>).indexed) {
    final stepCase = step! as Map<String, Object?>;
    assertKnownKeys(
      stepCase,
      _knownKeys['step:parse_chunk']!,
      'step:parse_chunk',
    );
    final String chunk = written.text(
      stepCase['input']! as String,
      catalogId: catalogId,
    );
    chunks.add(chunk);
    if (stepCase['expect_error'] case final Object error) {
      A2uiError? thrown;
      expectThrowsCategory(
        () {
          try {
            stream.feed(chunk);
          } on A2uiError catch (e) {
            thrown = e;
            rethrow;
          }
        },
        error,
        reason: 'step $i',
      );
      if (stepCase['expect_partial_results'] case final Object partial) {
        expect(
          lift(thrown!.partialResults),
          partial,
          reason: 'step $i: partial results',
        );
      }
      expectInBlock(stepCase, i);
      return;
    }
    final List<Object?> parts = lift(stream.feed(chunk));
    expect(parts, stepCase['expect'], reason: 'step $i: ${stepCase['input']}');
    expectInBlock(stepCase, i);
    yielded.addAll(parts);
  }
  final List<Object?> closed = lift(stream.close());
  if (testCase['expect_close'] case final Object expected) {
    expect(closed, expected, reason: 'close');
  }
  yielded.addAll(closed);
  if (testCase['expect_matches_single_shot'] == true) {
    expect(
      _mergeAdjacentText(yielded),
      _mergeAdjacentText(
        lift(
          _format(
            testCase,
            version,
          ).createParser().parseResponse(chunks.join(), wrapped: wrapped),
        ),
      ),
    );
  }
}

List<Object?> _mergeAdjacentText(List<Object?> parts) {
  final merged = <Object?>[];
  for (final part in parts) {
    if (merged.isNotEmpty &&
        merged.last is Map<String, Object?> &&
        part is Map<String, Object?> &&
        (merged.last as Map<String, Object?>).containsKey('text') &&
        part.containsKey('text')) {
      final lastMap = Map<String, Object?>.from(
        merged.last as Map<String, Object?>,
      );
      lastMap['text'] = '${lastMap['text']}${part['text']}';
      merged[merged.length - 1] = lastMap;
    } else {
      merged.add(part);
    }
  }
  return merged;
}

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
    final List<AgentToRendererMessage> recompiled = compileChecked(
      _format(testCase, version).createParser(),
      output,
    );
    expect(
      version.messagesJson(recompiled),
      testCase['messages'],
      reason: 'JSON written:\n$output',
    );
  }
}

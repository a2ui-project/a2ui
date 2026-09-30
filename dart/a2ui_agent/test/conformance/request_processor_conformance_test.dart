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

/// Runs the shared `conformance/agent/request_processor.yaml` suite against
/// [InferenceFormatFactory.createFormat] and
/// [A2uiGenerator.createProcessor].
///
/// Capabilities, examples and responses are lowered to v0.9, and parsed
/// messages lifted back, as `suites.dart` describes.
void main() {
  const path = 'agent/request_processor.yaml';
  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(
        testCase['name']! as String,
        skip: _skipReason(testCase),
        () => switch (testCase['action']) {
          'create_format' => _createFormat(testCase),
          'create_processor' => _createProcessor(testCase),
          _ => throw UnsupportedError('Unknown action ${testCase['action']}'),
        },
      );
    }
  });
}

String? _skipReason(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  if (testCase['action'] == 'create_processor' &&
      !args.containsKey('renderer_capabilities')) {
    return 'createProcessor requires renderer capabilities, as in the '
        'blueprint, so a request without them cannot be written.';
  }
  return null;
}

InferenceFormatFactory _factory(Object? name) => switch (name) {
  'direct_json' => const DirectJsonFormatFactory(),
  'express' => const ExpressFormatFactory(),
  _ => throw ArgumentError.value(name, 'format'),
};

List<List<AgentToRendererMessage>> _examples(Map<String, Object?> args) => [
  for (final Object? path in args['examples'] as List<Object?>? ?? const [])
    loadExample(path! as String),
];

void _createFormat(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final InferenceFormat format = _factory(
    args['format'],
  ).createFormat(caseCatalogs(args), examples: _examples(args));
  final expected = testCase['expect']! as Map<String, Object?>;
  expectSnippet(format.promptGenerator.generate(), expected);
  if (expected['parsers_are_distinct'] == true) {
    expect(format.createParser(), isNot(same(format.createParser())));
  }
  if (expected['parser_state_isolated'] == true) {
    final List<String> chunks = [
      for (final Object? chunk in args['probe_chunks']! as List<Object?>)
        lowerText(chunk! as String),
    ];
    List<Object?> read(Parser parser) => [
      for (final String chunk in chunks) liftParts(parser.parseChunk(chunk)),
    ];
    final Parser first = format.createParser();
    final List<Object?> firstParts = read(first);
    expect(firstParts.expand((p) => p! as List), isNotEmpty);
    expect(read(format.createParser()), firstParts);
  }
}

void _createProcessor(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final generator = A2uiGenerator(
    catalogs: [
      for (final Object? entry in args['catalogs']! as List<Object?>)
        catalogConfig(entry),
    ],
    examples: _examples(args),
    inferenceFormatFactory: _factory(args['format'] ?? 'direct_json'),
  );
  final List<Object?> before = _describe(generator);
  A2uiRequestProcessor create() => generator.createProcessor(
    lowerCapabilities(args['renderer_capabilities']! as Map<String, Object?>),
    inferenceFormatFactory: switch (args['format_override']) {
      null => null,
      final Object name => _factory(name),
    },
  );

  if (testCase['expect_error'] case final Object error) {
    expect(create, throwsCategory(error));
    return;
  }
  final A2uiRequestProcessor processor = create();
  final expected = testCase['expect']! as Map<String, Object?>;
  if (expected['active_catalog_ids'] case final List<Object?> ids) {
    expect(processor.activeCatalogs.map((c) => c.id), ids);
  }
  for (final (int i, Object? assertion)
      in (expected['catalogs'] as List<Object?>? ?? const []).indexed) {
    expectCatalog(
      processor.activeCatalogs[i],
      assertion! as Map<String, Object?>,
    );
  }
  expectSnippet(processor.promptSnippet, expected);
  if (expected['generator_catalogs_unchanged'] == true) {
    expect(_describe(generator), before);
  }

  if (testCase['then_parse'] case final Map<String, Object?> parse) {
    List<Object?> parseResponse() => liftParts(
      processor.parseResponse(lowerText(parse['input']! as String)),
    );
    if (parse['expect_error'] case final Object error) {
      expect(parseResponse, throwsCategory(error));
    } else {
      expect(parseResponse(), parse['expect']);
    }
  }
}

/// What [generator] holds, to compare before and after a negotiation.
List<Object?> _describe(A2uiGenerator generator) => [
  for (final CatalogConfig config in generator.catalogs)
    [
      config.catalog.id,
      [...config.catalog.components.keys],
      [...config.catalog.functions.keys],
    ],
];

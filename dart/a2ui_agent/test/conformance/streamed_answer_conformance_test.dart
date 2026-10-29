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

/// Runs the shared `conformance/agent/streamed_answer.yaml` suite against
/// [StreamedAnswer], in each [SuiteVersion].
///
/// Lowered to v0.9, the catalogs and each chunk are lowered, as `suites.dart`
/// describes. The parts the suite states hold text, surface ids and error
/// categories, which read the same in both versions, so nothing is lifted.
void main() {
  const path = 'agent/streamed_answer.yaml';
  for (final SuiteVersion version in SuiteVersion.values) {
    group('conformance $path ${version.label}', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        test(testCase['name']! as String, () => _runCase(testCase, version));
      }
    });
  }
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  expect(args['format'], 'direct_json');
  final processor = A2uiRequestProcessor(
    activeCatalogs: version.catalogs(args),
    formatFactory: DirectJsonFormatFactory(
      bufferIncompleteComponents: caseDeclaresV1(args),
    ),
  );
  final renderer = MessageProcessor<ComponentApi>(
    catalogs: [
      for (final CatalogApi catalog in version.catalogs({
        'catalogs': args['renderer_catalogs'] ?? [args['catalog']],
      }))
        catalog.withFunctions(const <FunctionImplementation>[]),
    ],
  );
  StreamedAnswer<ComponentApi> open() =>
      StreamedAnswer(processor, renderer: renderer);

  if (testCase['expect_error'] case final Object error) {
    expectThrowsCategory(open, error);
    return;
  }

  final StreamedAnswer<ComponentApi> answer = open();
  final String? catalogId = version.injectedCatalog(testCase);
  for (final (int i, Object? step)
      in (testCase['steps']! as List<Object?>).indexed) {
    final stepCase = step! as Map<String, Object?>;
    final input = stepCase['input']! as String;
    answer.feed(version.text(input, catalogId: catalogId));
    expect(
      _partsJson(answer, renderer),
      stepCase['expect_parts'],
      reason: 'step $i: $input',
    );
    if (stepCase['expect_in_block'] case final bool inBlock) {
      expect(answer.isInBlock, inBlock, reason: 'step $i: in block');
    }
  }
  answer.close();
  if (testCase['expect_close'] case final Object expected) {
    expect(_partsJson(answer, renderer), expected, reason: 'close');
  }
}

/// The parts of [answer] in the vocabulary of the suite: text, a surface by
/// its id, and an error by its category. Each surface must be the one
/// [renderer] holds.
List<Object?> _partsJson(
  StreamedAnswer<ComponentApi> answer,
  MessageProcessor<ComponentApi> renderer,
) {
  for (final AnswerSurfacePart<ComponentApi>(:surface)
      in answer.parts.whereType<AnswerSurfacePart<ComponentApi>>()) {
    expect(surface, same(renderer.model.getSurface(surface.id)));
  }
  return [
    for (final AnswerPart<ComponentApi> part in answer.parts)
      switch (part) {
        AnswerTextPart(:final String text) => {'text': text},
        AnswerSurfacePart(:final SurfaceModel<ComponentApi> surface) => {
          'surface': surface.id,
        },
        AnswerErrorPart(:final A2uiError error) => errorPartJson(error),
      },
  ];
}

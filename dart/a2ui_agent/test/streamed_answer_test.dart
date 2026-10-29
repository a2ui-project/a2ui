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

void main() {
  final CatalogApi basic = BasicCatalog.v1_0();

  MessageProcessor<ComponentApi> newRenderer() =>
      MessageProcessor<ComponentApi>(
        catalogs: [basic.withFunctions(const <FunctionImplementation>[])],
      );

  StreamedAnswer<ComponentApi> newAnswer([
    MessageProcessor<ComponentApi>? renderer,
  ]) => StreamedAnswer(
    A2uiRequestProcessor(
      activeCatalogs: [basic],
      formatFactory: const DirectJsonFormatFactory(),
    ),
    renderer: renderer ?? newRenderer(),
  );

  String create(String surfaceId) => jsonEncode({
    'version': '1.0',
    'createSurface': {'surfaceId': surfaceId, 'catalogId': basic.id},
  });

  String root(String surfaceId, Map<String, Object?> component) => jsonEncode({
    'version': '1.0',
    'updateComponents': {
      'surfaceId': surfaceId,
      'components': [
        {'id': 'root', ...component},
      ],
    },
  });

  String surfaceBlock(String surfaceId) =>
      '<a2ui-json>[${create(surfaceId)}, '
      '${root(surfaceId, {'component': 'Text', 'text': 'Hi'})}]</a2ui-json>';

  /// The parts of [answer], with each surface by its id and each error by
  /// its type.
  List<Object> describe(StreamedAnswer<ComponentApi> answer) => [
    for (final AnswerPart<ComponentApi> part in answer.parts)
      switch (part) {
        AnswerTextPart(:final String text) => text,
        AnswerSurfacePart(:final SurfaceModel<ComponentApi> surface) => {
          'surface': surface.id,
        },
        AnswerErrorPart(:final A2uiError error) => {'error': error.runtimeType},
      },
  ];

  group('StreamedAnswer', () {
    test('keeps the text and surfaces in the order the model wrote them', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer();

      for (final String chunk in [
        'Here ',
        'it is: ',
        surfaceBlock('a'),
        ' and ',
        surfaceBlock('b'),
        ' Done.',
      ]) {
        answer.feed(chunk);
      }
      answer.close();

      expect(describe(answer), [
        'Here it is:',
        {'surface': 'a'},
        'and',
        {'surface': 'b'},
        'Done.',
      ]);
    });

    test("puts each surface in the renderer's model", () {
      final MessageProcessor<ComponentApi> renderer = newRenderer();
      final StreamedAnswer<ComponentApi> answer = newAnswer(renderer)
        ..feed(surfaceBlock('a'));

      final part = answer.parts.single as AnswerSurfacePart<ComponentApi>;
      expect(part.surface, same(renderer.model.getSurface('a')));
      expect(answer.renderer, same(renderer));
    });

    test('shows a rejected block as an error and goes on after it', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer()
        ..feed(
          'Before <a2ui-json>[${create('bad')}, '
          '${root('bad', {'component': 'Bogus'})}]</a2ui-json> after '
          '${surfaceBlock('good')}',
        )
        ..close();

      // The block arrived whole, so none of it was emitted.
      final List<Object> parts = describe(answer);
      expect(parts.first, 'Before');
      expect((parts[1] as Map)['error'], isNotNull);
      expect(parts.sublist(2), [
        'after',
        {'surface': 'good'},
      ]);
    });

    test('keeps a surface a rejected block created before it was rejected', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer()
        ..feed('<a2ui-json>[${create('a')}, ')
        ..feed('${root('a', {'component': 'Bogus'})}]</a2ui-json> after');

      final List<Object> parts = describe(answer);
      expect(parts.first, {'surface': 'a'});
      expect((parts[1] as Map)['error'], isNotNull);
      expect(parts.last, 'after');
    });

    test('adds an error for a block still open when the answer ends', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer()
        ..feed('Text <a2ui-json>[')
        ..close();

      expect(describe(answer), [
        'Text',
        {'error': A2uiParseError},
      ]);
    });

    test('drops a surface the answer deletes', () {
      final String remove = jsonEncode({
        'version': '1.0',
        'deleteSurface': {'surfaceId': 'a'},
      });
      final StreamedAnswer<ComponentApi> answer = newAnswer()
        ..feed(
          '${surfaceBlock('a')} ${surfaceBlock('b')} '
          '<a2ui-json>$remove</a2ui-json>',
        );

      expect(describe(answer), [
        {'surface': 'b'},
      ]);
    });

    test('replaces its list of parts when they change, and only then', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer()..feed('Hello');
      final List<AnswerPart<ComponentApi>> before = answer.parts;

      answer.feed(' <a2ui');
      expect(answer.parts, same(before));
      answer
        ..feed('-json>')
        ..feed('[${create('a')}]');

      expect(answer.parts, isNot(same(before)));
      expect(describe(answer).first, 'Hello');
      expect(
        () => answer.parts.add(const AnswerTextPart('x')),
        throwsUnsupportedError,
      );

      answer.feed('</a2ui-json>');
      final List<AnswerPart<ComponentApi>> created = answer.parts;
      answer.feed(
        '<a2ui-json>[${root('a', {'component': 'Text', 'text': 'Hi'})}]'
        '</a2ui-json>',
      );
      expect(answer.renderer.model.getSurface('a')!.componentsModel.size, 1);
      expect(answer.parts, same(created));
    });

    test('says whether it ends inside a block', () {
      final StreamedAnswer<ComponentApi> answer = newAnswer()
        ..feed('Text <a2ui-json>[');
      expect(answer.isInBlock, isTrue);

      answer.feed(']</a2ui-json>');
      expect(answer.isInBlock, isFalse);
    });

    test("rejects a renderer whose catalogs are not the processor's", () {
      final renderer = MessageProcessor<ComponentApi>(
        catalogs: [
          BasicCatalog.v0_9().withFunctions(const <FunctionImplementation>[]),
        ],
      );

      expect(() => newAnswer(renderer), throwsA(isA<A2uiCatalogError>()));
    });
  });
}

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

import '../test_catalogs.dart';

/// Marks behaviour the DIRECT_JSON stream processor does not implement yet.
const String pendingStreaming =
    'DirectJsonStreamProcessor is not implemented yet.';

DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> processor({
  Set<String>? progressiveKeys,
}) => DirectJsonStreamProcessor<CatalogComponent, CatalogFunction>(
  catalogs: [basicCatalog()],
  progressiveKeys: progressiveKeys ?? defaultProgressiveKeys,
);

void main() {
  group('DirectJsonStreamProcessor configuration', () {
    test('is bound to its catalogs and progressive keys', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor(progressiveKeys: {'text'});

      expect(p.catalogs.single.id, basicCatalogId);
      expect(p.progressiveKeys, {'text'});
      expect(p.validator.catalogs.keys, [basicCatalogId]);
    });
  });

  group('DirectJsonStreamProcessor.process', () {
    test('yields conversational text as soon as it arrives', () {
      expect(processor().process('Here is your '), [
        const TextPart('Here is your '),
      ]);
    }, skip: pendingStreaming);

    test('buffers a payload until the message is complete', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor();

      expect(p.process('$a2uiJsonOpenTag[{"version": "v0.9",'), isEmpty);

      final List<ResponsePart> parts = p.process(
        '"createSurface": {"surfaceId": "s1", "catalogId": '
        '"$basicCatalogId"}}',
      );

      expect(parts, hasLength(1));
      expect(
        (parts.single as A2uiPart).a2ui.single,
        isA<CreateSurfaceMessage>(),
      );
    }, skip: pendingStreaming);

    test('yields each completed message once', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor()
            ..process('$a2uiJsonOpenTag[')
            ..process(
              '{"version": "v0.9", "createSurface": {"surfaceId": "s1", '
              '"catalogId": "$basicCatalogId"}},',
            );

      final List<ResponsePart> parts = p.process(
        '{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]',
      );

      expect(parts, hasLength(1));
      expect(
        (parts.single as A2uiPart).a2ui.single,
        isA<DeleteSurfaceMessage>(),
      );
    }, skip: pendingStreaming);

    test('heals a string cut mid-token when its key is progressive', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor()..process(
            '$a2uiJsonOpenTag[{"version": "v0.9", "updateComponents": '
            '{"surfaceId": "s1", "components": [{"id": "t", '
            '"component": "Text", "text": "Partial te',
          );

      expect(p.progressiveKeys, contains('text'));
    }, skip: pendingStreaming);

    test('rejects a message declaring another protocol version', () {
      expect(
        () => processor().process(
          '$a2uiJsonOpenTag[{"version": "v1.0", "deleteSurface": '
          '{"surfaceId": "s1"}}]$a2uiJsonCloseTag',
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingStreaming);
  });

  group('DirectJsonStreamProcessor.finish', () {
    test('reports an unterminated payload block', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor()..process('$a2uiJsonOpenTag[{"version"');

      expect(p.finish, throwsA(isA<A2uiParseError>()));
    }, skip: pendingStreaming);

    test('flushes trailing conversational text', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor()..process('Trailing');

      expect(p.finish(), isEmpty);
    }, skip: pendingStreaming);
  });

  group('DirectJsonStreamProcessor.reset', () {
    test('discards buffered state so a new turn can start', () {
      final DirectJsonStreamProcessor<CatalogComponent, CatalogFunction> p =
          processor()..process('$a2uiJsonOpenTag[{"version"');

      p.reset();

      expect(p.process('Fresh turn.'), [const TextPart('Fresh turn.')]);
    }, skip: pendingStreaming);
  });

  group('DirectJsonParser.parseChunk', () {
    test('delegates to the stream processor', () {
      final parser = DirectJsonParser<CatalogComponent, CatalogFunction>(
        catalogs: [basicCatalog()],
      );

      expect(parser.parseChunk('Hello'), [const TextPart('Hello')]);
    }, skip: pendingStreaming);
  });
}

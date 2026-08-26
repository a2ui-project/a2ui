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

/// Marks a test describing behaviour the DIRECT_JSON parser does not implement
/// yet. Remove the skip alongside the implementation.
const String pendingParser = 'DirectJsonParser is not implemented yet.';

DirectJsonParser<CatalogComponent, CatalogFunction> parser({
  Set<String>? progressiveKeys,
}) => DirectJsonParser<CatalogComponent, CatalogFunction>(
  catalogs: [basicCatalog()],
  customProgressiveKeys: progressiveKeys,
);

String wrapped(String payload) => '$a2uiJsonOpenTag$payload$a2uiJsonCloseTag';

const String createSurfaceJson =
    '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": '
    '"$basicCatalogId"}}]';

void main() {
  group('DirectJsonParser configuration', () {
    test('is bound to the catalogs it validates against', () {
      expect(parser().catalogs.single.id, basicCatalogId);
    });

    test('defaults to the shared progressive key set', () {
      expect(parser().progressiveKeys, defaultProgressiveKeys);
    });

    test('honours a custom progressive key set', () {
      expect(parser(progressiveKeys: {'customCuttable'}).progressiveKeys, {
        'customCuttable',
      });
    });

    test('declares streaming support', () {
      expect(parser().supportsStreaming, isTrue);
    });

    test('builds a validator over the same catalogs by default', () {
      expect(parser().validator.catalogs.keys, [basicCatalogId]);
    });

    test('exposes a stream processor bound to its configuration', () {
      final DirectJsonParser<CatalogComponent, CatalogFunction> p = parser(
        progressiveKeys: {'text'},
      );
      expect(p.streamProcessor.progressiveKeys, {'text'});
      expect(p.streamProcessor.catalogs.single.id, basicCatalogId);
    });
  });

  group('DirectJsonParser.unwrap', () {
    test('extracts a single payload block', () {
      final List<RawResponsePart> parts = parser().unwrap(
        wrapped(createSurfaceJson),
      );

      expect(parts, hasLength(1));
      expect(parts.single.part, const RawA2uiPart(createSurfaceJson));
      expect(parts.single.isFinal, isTrue);
    }, skip: pendingParser);

    test('preserves surrounding conversational text in order', () {
      final List<RawResponsePart> parts = parser().unwrap(
        'Before\n${wrapped(createSurfaceJson)}\nAfter',
      );

      expect(parts, hasLength(3));
      expect(parts[0].part, const TextPart('Before'));
      expect(parts[1].part, const RawA2uiPart(createSurfaceJson));
      expect(parts[2].part, const TextPart('After'));
    }, skip: pendingParser);

    test('extracts several payload blocks in order', () {
      final List<RawResponsePart> parts = parser().unwrap(
        '${wrapped("[1]")} middle ${wrapped("[2]")}',
      );

      expect(
        parts.map((p) => p.part).whereType<RawA2uiPart>().map((p) => p.a2uiRaw),
        ['[1]', '[2]'],
      );
    }, skip: pendingParser);

    test('strips a markdown fence inside the payload block', () {
      final List<RawResponsePart> parts = parser().unwrap(
        '$a2uiJsonOpenTag\n```json\n[]\n```\n$a2uiJsonCloseTag',
      );

      expect(parts.single.part, const RawA2uiPart('[]'));
    }, skip: pendingParser);

    test('marks an unterminated block as not final', () {
      final List<RawResponsePart> parts = parser().unwrap(
        '$a2uiJsonOpenTag[{"version"',
      );

      expect(parts.single.isFinal, isFalse);
    }, skip: pendingParser);

    test('rejects a response with no payload block', () {
      expect(
        () => parser().unwrap('Just conversation.'),
        throwsA(isA<A2uiParseError>()),
      );
      expect(() => parser().unwrap(''), throwsA(isA<A2uiParseError>()));
    }, skip: pendingParser);

    test('rejects an empty payload block', () {
      expect(
        () => parser().unwrap(wrapped('')),
        throwsA(isA<A2uiParseError>()),
      );
    }, skip: pendingParser);
  });

  group('DirectJsonParser.compile', () {
    test('compiles a payload into typed messages', () {
      final List<A2uiMessage> messages = parser().compile(createSurfaceJson);

      expect(messages, hasLength(1));
      expect(messages.single, isA<CreateSurfaceMessage>());
      expect((messages.single as CreateSurfaceMessage).surfaceId, 's1');
    }, skip: pendingParser);

    test('repairs a trailing comma', () {
      expect(
        parser().compile(
          '[{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}},]',
        ),
        hasLength(1),
      );
    }, skip: pendingParser);

    test('wraps a bare object in a list', () {
      expect(
        parser().compile(
          '{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}',
        ),
        hasLength(1),
      );
    }, skip: pendingParser);

    test('rejects a message declaring another protocol version', () {
      expect(
        () => parser().compile(
          '[{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}]',
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingParser);

    test('rejects a message that omits the version', () {
      expect(
        () => parser().compile('[{"deleteSurface": {"surfaceId": "s1"}}]'),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingParser);

    test('rejects content that is not JSON', () {
      expect(
        () => parser().compile('not json at all'),
        throwsA(isA<A2uiCompileError>()),
      );
    }, skip: pendingParser);
  });

  group('DirectJsonParser.decompile', () {
    test('renders messages as formatted A2UI JSON', () {
      final String rendered = parser().decompile([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
      ]);

      expect(rendered, contains('"createSurface"'));
      expect(rendered, contains('"surfaceId"'));
      expect(parser().compile(rendered), hasLength(1));
    }, skip: pendingParser);
  });

  group('DirectJsonParser.wrap', () {
    test('re-adds the sentinel tags around payload blocks', () {
      final String content = parser().wrap([
        RawResponsePart(const TextPart('Here you go.')),
        RawResponsePart(const RawA2uiPart('[]')),
      ]);

      expect(content, contains('Here you go.'));
      expect(content, contains(a2uiJsonOpenTag));
      expect(content, contains(a2uiJsonCloseTag));
    }, skip: pendingParser);

    test('round trips through unwrap', () {
      final blocks = [
        RawResponsePart(const TextPart('Hi')),
        RawResponsePart(const RawA2uiPart(createSurfaceJson)),
      ];

      expect(parser().unwrap(parser().wrap(blocks)), blocks);
    }, skip: pendingParser);
  });

  group('DirectJsonParser.parseResponse', () {
    test('returns text and compiled parts in order', () {
      final List<ResponsePart> parts = parser().parseResponse(
        'Here you go.\n${wrapped(createSurfaceJson)}\nAnything else?',
      );

      expect(parts, hasLength(3));
      expect(parts[0], const TextPart('Here you go.'));
      expect((parts[1] as A2uiPart).a2ui.single, isA<CreateSurfaceMessage>());
      expect(parts[2], const TextPart('Anything else?'));
    }, skip: pendingParser);

    test('compiles the whole response when it is not wrapped', () {
      final List<ResponsePart> parts = parser().parseResponse(
        createSurfaceJson,
        wrapped: false,
      );

      expect(parts.single, isA<A2uiPart>());
    }, skip: pendingParser);
  });
}

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

A2uiMessage createSurface(String surfaceId) =>
    CreateSurfaceMessage(surfaceId: surfaceId, catalogId: 'c');

void main() {
  group('TextPart', () {
    test('carries the conversational text', () {
      expect(const TextPart('hello').text, 'hello');
    });

    test('compares by value', () {
      expect(const TextPart('a'), const TextPart('a'));
      expect(const TextPart('a'), isNot(const TextPart('b')));
      expect(const TextPart('a').hashCode, const TextPart('a').hashCode);
    });

    test('elides long text when described', () {
      expect(const TextPart('short').toString(), "TextPart('short')");
      expect(TextPart('x' * 100).toString(), endsWith("...')"));
    });
  });

  group('RawA2uiPart', () {
    test('carries the uncompiled format content', () {
      expect(const RawA2uiPart('[{}]').a2uiRaw, '[{}]');
    });

    test('compares by value', () {
      expect(const RawA2uiPart('[]'), const RawA2uiPart('[]'));
      expect(const RawA2uiPart('[]'), isNot(const RawA2uiPart('[{}]')));
      expect(
        const RawA2uiPart('[]').hashCode,
        const RawA2uiPart('[]').hashCode,
      );
    });
  });

  group('A2uiPart', () {
    test('carries the compiled messages', () {
      final part = A2uiPart([createSurface('s1')]);
      expect(part.a2ui, hasLength(1));
      expect(part.a2ui.single, isA<CreateSurfaceMessage>());
    });

    test('compares by the JSON its messages render to', () {
      expect(A2uiPart([createSurface('s1')]), A2uiPart([createSurface('s1')]));
      expect(
        A2uiPart([createSurface('s1')]),
        isNot(A2uiPart([createSurface('s2')])),
      );
      expect(
        A2uiPart([createSurface('s1')]).hashCode,
        A2uiPart([createSurface('s1')]).hashCode,
      );
    });

    test('describes itself by message count', () {
      expect(
        A2uiPart([createSurface('s1')]).toString(),
        'A2uiPart(1 message(s))',
      );
    });
  });

  group('RawResponsePart', () {
    test('wraps a text part', () {
      final part = RawResponsePart(const TextPart('hi'));
      expect(part.part, const TextPart('hi'));
      expect(part.isFinal, isTrue);
    });

    test('wraps an uncompiled A2UI part and records truncation', () {
      final part = RawResponsePart(const RawA2uiPart('[{'), isFinal: false);
      expect(part.part, const RawA2uiPart('[{'));
      expect(part.isFinal, isFalse);
    });

    test('rejects a compiled part', () {
      expect(
        () => RawResponsePart(A2uiPart([createSurface('s1')])),
        throwsArgumentError,
      );
    });

    test('compares by value', () {
      expect(
        RawResponsePart(const TextPart('a')),
        RawResponsePart(const TextPart('a')),
      );
      expect(
        RawResponsePart(const TextPart('a')),
        isNot(RawResponsePart(const TextPart('a'), isFinal: false)),
      );
      expect(
        RawResponsePart(const TextPart('a')).hashCode,
        RawResponsePart(const TextPart('a')).hashCode,
      );
    });

    test('describes its content and completeness', () {
      expect(
        RawResponsePart(const TextPart('a'), isFinal: false).toString(),
        "RawResponsePart(TextPart('a'), isFinal: false)",
      );
    });
  });

  group('ResponsePart hierarchy', () {
    test('a parsed response holds text and compiled parts', () {
      final parts = <ResponsePart>[
        const TextPart('hello'),
        A2uiPart([createSurface('s1')]),
      ];

      expect(parts.whereType<TextPart>(), hasLength(1));
      expect(parts.whereType<A2uiPart>(), hasLength(1));
    });
  });
}

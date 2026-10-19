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

import 'package:a2ui_agent/src/inference_formats/direct_json/json_reader.dart';
import 'package:test/test.dart';

/// How [readPartialMessages] reads a payload as it arrives when given a
/// [PartialReadCache], which the direct JSON parser keeps across chunks.
void main() {
  /// The messages [text] reads as, with whether each closed, as JSON.
  String read(
    String text, {
    PartialReadCache? cache,
    Set<String> wholeItemKeys = const {},
  }) => jsonEncode([
    for (final (:Object? message, :bool closed) in readPartialMessages(
      text,
      const {'text'},
      wholeItemKeys: wholeItemKeys,
      cache: cache,
    ))
      [message, closed],
  ]);

  group('readPartialMessages with a cache', () {
    final Map<String, String> payloads = {
      'several messages with nested lists and maps': jsonEncode([
        {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's', 'catalogId': 'c'},
        },
        {
          'version': 'v1.0',
          'updateComponents': {
            'surfaceId': 's',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'children': ['a', 'b'],
              },
              {'id': 'a', 'component': 'Text', 'text': 'Hello [{'},
              {
                'id': 'b',
                'component': 'Text',
                'text': r'Say "hi" \ {}',
                'args': {
                  'list': [1, -2.5e3, true, null],
                },
              },
            ],
          },
        },
      ]),
      'a single message': jsonEncode({
        'version': 'v1.0',
        'updateDataModel': {
          'surfaceId': 's',
          'value': {
            'items': [
              {'text': 'One'},
              {'text': 'Two'},
            ],
          },
        },
      }),
      'curly quotes for JSON quotes':
          '[{“version”: “v1.0”, “updateComponents”: {“surfaceId”: “s”, '
          '“components”: [{“id”: “a”, “text”: “Hi”}, {“id”: “b”}]}}]',
    };

    payloads.forEach((String description, String payload) {
      for (final wholeItemKeys in [
        const <String>{},
        const {'components'},
      ]) {
        test('reads each start of $description as without one, '
            'wholeItemKeys: $wholeItemKeys', () {
          final cache = PartialReadCache();
          for (var end = 0; end <= payload.length; end++) {
            final String text = payload.substring(0, end);
            expect(
              read(text, cache: cache, wholeItemKeys: wholeItemKeys),
              read(text, wholeItemKeys: wholeItemKeys),
              reason: text,
            );
          }
        });
      }
    });

    test('reads only the part between start and end', () {
      const payload = '[{"a": [1, 2]}, {"b": "x"}]';
      final cache = PartialReadCache();
      for (var end = 3; end <= payload.length; end++) {
        final text = '```json\n$payload\n```';
        expect(
          jsonEncode([
            for (final (:Object? message, :bool closed) in readPartialMessages(
              text,
              const {},
              cache: cache,
              start: 8,
              end: 8 + end,
            ))
              [message, closed],
          ]),
          read(payload.substring(0, end)),
          reason: payload.substring(0, end),
        );
      }
    });

    test('returns a list or map that closed as the same object', () {
      final cache = PartialReadCache();
      const text = '[{"a": {"b": 1}}, {"c": ';
      final Object? first = readPartialMessages(
        text,
        const {},
        cache: cache,
      ).first.message;
      final Object? again = readPartialMessages(
        '$text 2}]',
        const {},
        cache: cache,
      ).first.message;
      expect(again, same(first));
    });
  });
}

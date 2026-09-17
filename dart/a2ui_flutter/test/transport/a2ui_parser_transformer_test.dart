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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/src/model/generation_events.dart';
import 'package:a2ui_flutter/src/primitives/a2ui_validation_exception.dart';
import 'package:a2ui_flutter/src/transport/a2ui_parser_transformer.dart';
import 'package:async/async.dart';
import 'package:test/test.dart';

void main() {
  group('A2uiParserTransformer', () {
    late StreamController<String> controller;
    late Stream<GenerationEvent> stream;

    setUp(() {
      controller = StreamController<String>();
      stream = controller.stream.transform(const A2uiParserTransformer());
    });

    tearDown(() {
      controller.close();
    });

    test('emits pure text chunks as TextEvents', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);
      controller.add('Hello ');
      controller.add('World');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'Hello '),
      );
      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'World'),
      );
      await queue.cancel();
    });

    test('extracts Markdown JSON block', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Here is a message:\n');
      controller.add('```json\n');
      controller.add(
        '{"version": "v0.9", "createSurface": {"surfaceId": "foo", '
        '"catalogId": "cat"}}\n',
      );
      controller.add('```\n');
      controller.add('End of message.');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having(
          (e) => e.text,
          'text',
          contains('Here is a message:'),
        ),
      );

      final msgEvent = (await queue.next) as A2uiMessageEvent;
      expect(msgEvent.message, isA<core.CreateSurfaceMessage>());
      expect((msgEvent.message as core.CreateSurfaceMessage).surfaceId, 'foo');

      // The text after might be just the newline or "End of message."
      // We accept whatever text comes next, potentially fragmented.
      var lastText = (await queue.next) as TextEvent;
      while (!lastText.text.contains('End of message.')) {
        if (!await queue.hasNext) break;
        final GenerationEvent event = await queue.next;
        if (event is TextEvent) {
          lastText = TextEvent(lastText.text + event.text);
        } else {
          fail(
            'Expected text event containing "End of message.", found $event',
          );
        }
      }
      expect(lastText.text, contains('End of message.'));

      await queue.cancel();
    });

    test('extracts Balanced JSON block split across chunks', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Start ');
      controller.add('{ "version": "v0.9", "deleteSurface": ');
      controller.add('{ "surfaceId": '); // Needs nesting for wrapper
      controller.add('"bar" } }');
      controller.add(' End');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'Start '),
      );

      final msgEvent = (await queue.next) as A2uiMessageEvent;
      expect(msgEvent.message, isA<core.DeleteSurfaceMessage>());
      expect((msgEvent.message as core.DeleteSurfaceMessage).surfaceId, 'bar');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', ' End'),
      );

      await queue.cancel();
    });

    test('extracts JSON containing brackets and braces in strings', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Start ');
      controller.add('{ "version": "v0.9", "deleteSurface": ');
      controller.add('{ "surfaceId": "[{]bar[}]" } }');
      controller.add(' End');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'Start '),
      );

      final msgEvent = (await queue.next) as A2uiMessageEvent;
      expect(msgEvent.message, isA<core.DeleteSurfaceMessage>());
      expect(
        (msgEvent.message as core.DeleteSurfaceMessage).surfaceId,
        '[{]bar[}]',
      );

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', ' End'),
      );

      await queue.cancel();
    });

    test('flushes buffer on done', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Incomplete { json');
      unawaited(controller.close());

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'Incomplete '),
      );
      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', '{ json'),
      );
      expect(await queue.hasNext, isFalse);
    });

    test('emits error for invalid A2UI message', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      // Malformed core.CreateSurfaceMessage (missing required fields)
      controller.add('{"version": "v0.9", "createSurface": {}}');

      // Should emit error
      expect(queue.next, throwsA(isA<A2uiValidationException>()));

      await queue.cancel();
    });

    test('emits text for invalid JSON in Markdown block (no stall)', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Here is bad json:\n');
      controller.add('```json\n{invalid\n```\n');
      controller.add('End.');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having(
          (e) => e.text,
          'text',
          contains('Here is bad json:'),
        ),
      );

      // Should emit the invalid markdown block as text immediately
      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having(
          (e) => e.text,
          'text',
          contains('```json\n{invalid\n```'),
        ),
      );

      // Consume potential newline after the block
      GenerationEvent nextEvent = await queue.next;
      if (nextEvent is TextEvent && nextEvent.text.trim().isEmpty) {
        nextEvent = await queue.next;
      }

      expect(
        nextEvent as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', contains('End.')),
      );

      await queue.cancel();
    });

    test('emits text for invalid JSON in balanced block (no stall)', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add('Start ');
      controller.add('{"key": invalid} '); // Invalid JSON
      controller.add('End');

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'Start '),
      );

      // Should emit the invalid block as text immediately
      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', '{"key": invalid}'),
      );

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', ' '),
      );

      expect(
        (await queue.next) as TextEvent,
        isA<TextEvent>().having((e) => e.text, 'text', 'End'),
      );

      await queue.cancel();
    });

    test('extracts messages from a JSONL stream', () async {
      final StreamQueue<GenerationEvent> queue = StreamQueue(stream);

      controller.add(
        '{"version": "v0.9", "createSurface": '
        '{"surfaceId": "foo", "catalogId": "genui"}'
        '}',
      );

      controller.add('\n');

      controller.add(
        '{"version": "v0.9", "createSurface": '
        '{"surfaceId": "bar", "catalogId": "genui"}'
        '}',
      );

      final firstEvent = (await queue.next) as A2uiMessageEvent;
      expect(firstEvent.message, isA<core.CreateSurfaceMessage>());
      expect(
        (firstEvent.message as core.CreateSurfaceMessage).surfaceId,
        'foo',
      );

      final secondEvent = (await queue.next) as A2uiMessageEvent;
      expect(secondEvent.message, isA<core.CreateSurfaceMessage>());
      expect(
        (secondEvent.message as core.CreateSurfaceMessage).surfaceId,
        'bar',
      );

      await queue.cancel();
    });
  });
}

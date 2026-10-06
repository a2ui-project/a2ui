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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_infra/message_builders.dart';

void main() {
  group('Conversation', () {
    late A2uiTransportAdapter adapter;
    late SurfaceController controller;

    setUp(() {
      adapter = A2uiTransportAdapter();
      controller = SurfaceController(catalogs: []);
    });

    tearDown(() {
      adapter.dispose();
      controller.dispose();
    });

    test('updates isWaiting state during request', () async {
      final completer = Completer<void>();
      adapter = A2uiTransportAdapter(
        onSend: (message) async {
          await completer.future;
        },
      );

      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      expect(conversation.state.value.isWaiting, isFalse);

      final Future<void> future = conversation.sendRequest(
        ChatMessage.user('hi', parts: [UiInteractionPart.create('hi')]),
      );

      expect(conversation.state.value.isWaiting, isTrue);

      completer.complete();
      await future;

      expect(conversation.state.value.isWaiting, isFalse);
      conversation.dispose();
    });

    test('calls onSend with correct message', () async {
      ChatMessage? capturedMessage;

      adapter = A2uiTransportAdapter(
        onSend: (message) async {
          capturedMessage = message;
        },
      );

      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      // Send first message
      final firstMessage = ChatMessage.user('First');
      await conversation.sendRequest(firstMessage);

      expect(capturedMessage, firstMessage);

      // Send second message
      final secondMessage = ChatMessage.user('Second');
      await conversation.sendRequest(secondMessage);

      expect(capturedMessage, secondMessage);

      conversation.dispose();
    });

    test('emits error and resets isWaiting when sendRequest throws', () async {
      adapter = A2uiTransportAdapter(
        onSend: (message) async {
          throw Exception('Network Error');
        },
      );
      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      final events = <ConversationEvent>[];
      conversation.events.listen(events.add);

      await conversation.sendRequest(ChatMessage.user('hi'));
      await Future<void>.delayed(Duration.zero);

      expect(conversation.state.value.isWaiting, isFalse);
      expect(events.any((e) => e is ConversationError), isTrue);

      conversation.dispose();
    });

    test('updates state and emits events on transport text', () async {
      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      final events = <ConversationEvent>[];
      conversation.events.listen(events.add);

      adapter.addChunk('Hello AI');
      await Future<void>.delayed(Duration.zero); // let stream process

      expect(conversation.state.value.latestText, 'Hello AI');
      expect(
        events.any(
          (e) => e is ConversationContentReceived && e.text == 'Hello AI',
        ),
        isTrue,
      );

      conversation.dispose();
    });

    test('updates surfaces state on controller events', () async {
      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      final events = <ConversationEvent>[];
      conversation.events.listen(events.add);

      adapter.addMessage(createSurface(surfaceId: 'surf1', catalogId: 'cat'));
      await Future<void>.delayed(Duration.zero);

      expect(conversation.state.value.surfaces, contains('surf1'));
      expect(
        events.any(
          (e) => e is ConversationSurfaceAdded && e.surfaceId == 'surf1',
        ),
        isTrue,
      );

      // update components
      adapter.addMessage(
        updateComponents(surfaceId: 'surf1', components: const <JsonMap>[]),
      );
      await Future<void>.delayed(Duration.zero);

      expect(
        events.any(
          (e) => e is ConversationComponentsUpdated && e.surfaceId == 'surf1',
        ),
        isTrue,
      );

      // remove surface
      adapter.addMessage(deleteSurface(surfaceId: 'surf1'));
      await Future<void>.delayed(Duration.zero);

      expect(conversation.state.value.surfaces, isNot(contains('surf1')));
      expect(
        events.any(
          (e) => e is ConversationSurfaceRemoved && e.surfaceId == 'surf1',
        ),
        isTrue,
      );

      conversation.dispose();
    });

    test('forwards controller onSubmit to sendRequest', () async {
      ChatMessage? capturedMessage;
      adapter = A2uiTransportAdapter(
        onSend: (message) async => capturedMessage = message,
      );
      final conversation = Conversation(
        transport: adapter,
        controller: controller,
      );

      final event = UserActionEvent(
        sourceComponentId: 'btn',
        name: 'click',
        context: {},
      );
      controller.handleUiEvent(event);
      await Future<void>.delayed(Duration.zero);

      expect(capturedMessage, isNotNull);
      final StandardPart part = capturedMessage!.parts.first;
      expect(part, isA<DataPart>());
      expect(
        (part as DataPart).mimeType,
        'application/vnd.genui.interaction+json',
      );

      conversation.dispose();
    });
  });
}

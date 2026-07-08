// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:genui/genui.dart';
import 'package:genui_a2a/genui_a2a.dart';
import 'package:restaurant_finder_client/src/primitives.dart';
import 'package:restaurant_finder_client/src/session.dart';

class MockAgentConnector implements A2uiAgentConnector {
  final _streamController = StreamController<A2uiMessage>.broadcast();
  final _textStreamController = StreamController<String>.broadcast();
  final _errorStreamController = StreamController<Object>.broadcast();

  @override
  Stream<A2uiMessage> get stream => _streamController.stream;

  @override
  Stream<String> get textStream => _textStreamController.stream;

  @override
  Stream<Object> get errorStream => _errorStreamController.stream;

  bool connectAndSendCalled = false;
  ChatMessage? lastSentMessage;
  FutureOr<String?> Function(ChatMessage)? onConnectAndSend;

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #connectAndSend) {
      connectAndSendCalled = true;
      final ChatMessage msg = invocation.positionalArguments[0] as ChatMessage;
      lastSentMessage = msg;
      if (onConnectAndSend != null) {
        final res = onConnectAndSend!(msg);
        if (res is Future<String?>) {
          return res;
        }
        return Future<String?>.value(res);
      }
      return Future<String?>.value(null);
    }
    return super.noSuchMethod(invocation);
  }

  void emitUiMessage(A2uiMessage message) {
    _streamController.add(message);
  }

  void emitText(String text) {
    _textStreamController.add(text);
  }

  void emitError(Object error) {
    _errorStreamController.add(error);
  }

  bool disposeCalled = false;

  @override
  void dispose() {
    disposeCalled = true;
    _streamController.close();
    _textStreamController.close();
    _errorStreamController.close();
  }
}

void main() {
  group('RestaurantSession Tests', () {
    late MockAgentConnector mockConnector;
    RestaurantSession? session;

    setUp(() {
      mockConnector = MockAgentConnector();
      session = RestaurantSession(connector: mockConnector);
    });

    tearDown(() {
      session?.dispose();
      session = null;
    });

    test('initial state', () {
      expect(session!.isRequesting, isFalse);
      expect(session!.hasSentMessage, isFalse);
      expect(session!.error, isNull);
      expect(session!.activeSurfaceIds, isEmpty);
    });

    test('sendMessage basic flow', () async {
      bool stateChanged = false;
      session!.addListener(() {
        stateChanged = true;
      });

      final completer = Completer<void>();
      mockConnector.onConnectAndSend = (msg) async {
        expect(session!.isRequesting, isTrue);
        expect(session!.hasSentMessage, isTrue);
        completer.complete();
        return null;
      };

      final sendFuture = session!.sendMessage('test query');
      await completer.future;

      await sendFuture;

      expect(session!.isRequesting, isFalse);
      expect(mockConnector.connectAndSendCalled, isTrue);
      expect(mockConnector.lastSentMessage?.text, equals('test query'));
      expect(stateChanged, isTrue);
    });

    test('sendMessage handles error', () async {
      mockConnector.onConnectAndSend = (msg) async {
        throw Exception('connection error');
      };

      await session!.sendMessage('test query');

      expect(session!.isRequesting, isFalse);
      expect(session!.error, contains('connection error'));
    });

    test('session handles agent error events', () async {
      bool errorNotified = false;
      session!.addListener(() {
        if (session!.error != null) {
          errorNotified = true;
        }
      });

      mockConnector.emitError('agent crashed');

      await Future<void>.delayed(Duration.zero);

      expect(session!.error, equals('agent crashed'));
      expect(errorNotified, isTrue);
    });

    test('session updates active surfaces on message', () async {
      // Send a create surface message
      mockConnector.emitUiMessage(
        const CreateSurface(
          surfaceId: 'sidebar',
          catalogId:
              'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        ),
      );

      await Future<void>.delayed(Duration.zero);

      expect(session!.activeSurfaceIds, contains('sidebar'));
    });

    test('dispose cancels all subscriptions and disposes resources', () {
      session!.dispose();
      expect(mockConnector.disposeCalled, isTrue);
      session = null;
    });

    test('session forwards submit events from surface to connector', () async {
      // Emit a submit event on the controller
      (session!.surfaceHost as SurfaceController).handleUiEvent(
        UserActionEvent(
          surfaceId: 'sidebar',
          name: 'submit_name',
          sourceComponentId: 'submit-btn',
          context: const {},
        ),
      );

      await Future<void>.delayed(Duration.zero);

      expect(mockConnector.connectAndSendCalled, isTrue);
      expect(mockConnector.lastSentMessage, isNotNull);
    });

    test('LoadingTexts logic', () {
      final loading = LoadingTexts();
      expect(loading.current, equals('Talking to your concierge...'));
      loading.advance();
      expect(loading.current, equals('Checking availability...'));
      loading.reset();
      expect(loading.current, equals('Talking to your concierge...'));
    });

    test('session handles agent text events', () async {
      mockConnector.emitText('text from agent');
      await Future<void>.delayed(Duration.zero);
    });

    test('sendMessage clears existing surfaces', () async {
      // Emit a surface first
      mockConnector.emitUiMessage(
        const CreateSurface(
          surfaceId: 'sidebar',
          catalogId:
              'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(session!.activeSurfaceIds, contains('sidebar'));

      // Send a new message, which should delete existing active surfaces
      await session!.sendMessage('new request');
      expect(session!.activeSurfaceIds, isEmpty);
    });
  });
}

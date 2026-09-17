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
import 'package:a2ui_flutter/src/transport/a2ui_transport_adapter.dart';
import 'package:test/test.dart';

void main() {
  group('A2uiTransportAdapter', () {
    late A2uiTransportAdapter transportAdapter;

    setUp(() {
      transportAdapter = A2uiTransportAdapter();
    });

    tearDown(() {
      transportAdapter.dispose();
    });

    test('addChunk flows text to textStream', () async {
      final Future<dynamic> textFuture = expectLater(
        transportAdapter.incomingText,
        emitsInOrder(['Hello']),
      );
      transportAdapter.addChunk('Hello');
      await textFuture;
    });

    test('incomingText preserves chunk whitespace', () async {
      final Future<dynamic> textFuture = expectLater(
        transportAdapter.incomingText,
        emitsInOrder(['a variety of friendly ', 'spots']),
      );
      transportAdapter.addChunk('a variety of friendly ');
      transportAdapter.addChunk('spots');
      await textFuture;
    });

    test('addChunk with message updates state', () async {
      // Using JSON block
      final json = '''```json
{"version": "v0.9", "createSurface": {"surfaceId": "test_chunk", "catalogId": "test-cat"}}
```''';

      final Future<dynamic> stateFuture = expectLater(
        transportAdapter.incomingMessages,
        emits(
          isA<core.CreateSurfaceMessage>().having(
            (e) => e.surfaceId,
            'id',
            'test_chunk',
          ),
        ),
      );

      transportAdapter.addChunk(json);
      await stateFuture;
    });

    test('addMessage updates state directly', () async {
      final msg = core.CreateSurfaceMessage(
        surfaceId: 'direct_msg',
        catalogId: 'direct-cat',
      );

      final Future<dynamic> stateFuture = expectLater(
        transportAdapter.incomingMessages,
        emits(
          isA<core.CreateSurfaceMessage>().having(
            (e) => e.surfaceId,
            'id',
            'direct_msg',
          ),
        ),
      );

      transportAdapter.addMessage(msg);
      await stateFuture;
    });

    test('incomingMessages emits parsable JSON messages', () async {
      final adapter = A2uiTransportAdapter();

      final Future<void> expectation = expectLater(
        adapter.incomingMessages,
        emits(
          predicate<core.AgentToRendererMessage>((m) {
            return m is core.UpdateComponentsMessage &&
                m.components.length == 1 &&
                m.components.first['id'] == 'root';
          }),
        ),
      );

      adapter.addChunk('''```json
{"version": "v0.9", "updateComponents": {"surfaceId": "test", "components": [{"id": "root", "component": "Text", "properties": {"text": "Hello"}}]}}
```''');

      await expectation;
    });
  });
}

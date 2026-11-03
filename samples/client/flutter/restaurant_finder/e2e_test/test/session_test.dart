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

// ignore_for_file: avoid_print

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:genui/genui.dart';
import 'package:restaurant_finder_client/main.dart';

import 'test_infra/restaurant_finder.dart';

/// The directory the agent's messages are written to, as a wire recording
/// of the hub scenario this test corresponds to, or empty for no recording.
const String recordDir = String.fromEnvironment('A2UI_E2E_RECORD_DIR');

/// The hub scenario this test follows.
const String scenarioName = 'restaurant_list_booking';

/// One turn of the recording: what the user sent and the messages that came
/// back, each as its wire envelope.
typedef RecordedTurn = ({String userText, List<Map<String, Object?>> messages});

void main() {
  setUp(() async {
    final restaurantFinderClient = TestRestaurantFinderClient();
    addTearDown(restaurantFinderClient.dispose);
    await restaurantFinderClient.startAndVerify();
  });

  test(
    'RestaurantSession can find restaurants and book a reservation.',
    () async {
      final session = RestaurantSession(
        serverUrl: TestRestaurantFinderClient().baseUrl,
      );
      addTearDown(session.dispose);
      final recording = _Recording(session);
      addTearDown(recording.dispose);
      if (recordDir.isNotEmpty) {
        addTearDown(() => recording.writeTo(recordDir, scenarioName));
      }

      expect(session.isRequesting, isFalse);
      expect(session.hasSentMessage, isFalse);
      expect(session.activeSurfaceIds, isEmpty);

      // 1. Ask the agent to find restaurants.
      await recording.send(
        session,
        'Find me 3 italian restaurants in New York.',
      );

      expect(session.hasSentMessage, isTrue);
      expect(session.isRequesting, isFalse);
      expect(session.error, isNull);
      expect(
        session.activeSurfaceIds,
        isNotEmpty,
        reason:
            'Agent should respond with at least one surface listing the '
            'restaurants.',
      );
      // The model picks the ids, so the check is by component type.
      final Map<String, Component> components = session.componentsOf(
        session.activeSurfaceIds.first,
      )!;
      expect(
        components.values.map((component) => component.type),
        contains('Button'),
        reason: 'The restaurant list should offer a button to book with.',
      );

      // 2. Ask the agent to book a table at one of them. This simulates the
      // user tapping "Book Now" — both paths funnel into _sendMessageToAgent.
      await recording.send(
        session,
        'Book a table at the first restaurant on Wednesday, April 29 2026 '
        'at 7:47 PM, for 2 people, dietary requirement: vegan.',
      );

      expect(session.isRequesting, isFalse);
      expect(session.error, isNull);
      expect(
        session.activeSurfaceIds,
        isNotEmpty,
        reason: 'Agent should respond with a booking confirmation surface.',
      );
    },
    timeout: const Timeout(Duration(minutes: 10)),
  );
}

/// Keeps the A2UI messages a session receives, by the turn they answer.
class _Recording {
  _Recording(RestaurantSession session)
    : _subscription = session.a2uiMessages.listen(null) {
    _subscription.onData(
      (message) => _current?.messages.add(_envelope(message)),
    );
  }

  final StreamSubscription<A2uiMessage> _subscription;
  final List<RecordedTurn> turns = [];
  RecordedTurn? _current;

  /// Sends [text] through [session] and keeps the messages its reply holds.
  Future<void> send(RestaurantSession session, String text) async {
    _current = (userText: text, messages: []);
    turns.add(_current!);
    await session.sendMessage(text);
  }

  /// Writes the turns as `{turns: [{userText, messages}]}` to
  /// `<dir>/<scenarioName>.wire.json`.
  Future<void> writeTo(String dir, String scenarioName) async {
    final file = File('$dir/$scenarioName.wire.json');
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert({
        'turns': [
          for (final RecordedTurn turn in turns)
            {'userText': turn.userText, 'messages': turn.messages},
        ],
      }),
    );
    print('=== Recording written to ${file.path}');
  }

  Future<void> dispose() => _subscription.cancel();

  /// [message] as the envelope it came in, `{version, <kind>: payload}`.
  static Map<String, Object?> _envelope(A2uiMessage message) {
    final (String kind, Map<String, dynamic> payload) = switch (message) {
      CreateSurface() => ('createSurface', message.toJson()),
      UpdateComponents() => ('updateComponents', message.toJson()),
      UpdateDataModel() => ('updateDataModel', message.toJson()),
      DeleteSurface() => ('deleteSurface', message.toJson()),
    };
    final Object? version = payload.remove('version');
    return {'version': version, kind: payload};
  }
}

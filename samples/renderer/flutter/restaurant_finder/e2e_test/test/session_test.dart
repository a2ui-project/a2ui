// Copyright 2025 Google LLC
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

// ignore_for_file: avoid_print

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_finder_client/restaurant_finder_client.dart';

import 'test_infra/restaurant_finder.dart';

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

      expect(session.isRequesting, isFalse);
      expect(session.hasSentMessage, isFalse);
      expect(session.activeSurfaceIds, isEmpty);

      // 1. Ask the agent to find restaurants.
      await session.sendMessage('Find me 3 italian restaurants in New York.');

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

      // 2. Ask the agent to book a table at one of them. This simulates the
      // user tapping "Book Now" — both paths funnel into _sendMessageToAgent.
      await session.sendMessage(
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

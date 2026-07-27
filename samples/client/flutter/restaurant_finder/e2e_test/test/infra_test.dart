// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// ignore_for_file: avoid_print

import 'package:flutter_test/flutter_test.dart';

import 'test_infra/ai_client.dart';
import 'test_infra/api_key.dart';
import 'test_infra/restaurant_finder.dart';

void main() {
  test('test can read api key "$geminiApiKeyName"', () {
    final String key = apiKeyForEval();
    expect(key, isNotEmpty);
    print('API Key: ${key.substring(0, 1)}...${key.substring(key.length - 1)}');
  });

  test('test can talk with AI', () async {
    final aiClient = DartanticAiClient();
    addTearDown(aiClient.dispose);

    final String result =
        (await aiClient
                .sendStream('Please, tell me a joke.', history: [])
                .toList())
            .join(' ');
    expect(result, isNotEmpty);
    print('Joke from AI:\n\n$result\n\n');
  });

  test(
    'test can start restaurant_finder',
    () async {
      final restaurantFinderClient = TestRestaurantFinderClient();
      addTearDown(restaurantFinderClient.dispose);
      await restaurantFinderClient.startAndVerify();
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}

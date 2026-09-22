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

  test('test can start restaurant_finder', () async {
    final restaurantFinderClient = TestRestaurantFinderClient();
    addTearDown(restaurantFinderClient.dispose);
    await restaurantFinderClient.startAndVerify();
  }, timeout: const Timeout(Duration(minutes: 5)));
}

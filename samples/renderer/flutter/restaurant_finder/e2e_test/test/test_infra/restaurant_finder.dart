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

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'shell_utils.dart';

const _restaurantFinderDefaultUrl = 'http://127.0.0.1:10002';
const _restaurantFinderAgentCardUrl =
    '$_restaurantFinderDefaultUrl/.well-known/agent-card.json';

const _restaurantFinderCurlMessage =
    '''
curl $_restaurantFinderDefaultUrl \\
  -H 'Content-Type: application/json' \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"text": "How can you help me?"}],
        "messageId": "1"
      }
    }
  }'
''';

final class TestRestaurantFinderClient {
  Process? _process;

  String get baseUrl => _restaurantFinderDefaultUrl;
  String get cardUrl => _restaurantFinderAgentCardUrl;

  /// Tests [start instructions](../../../../samples/agent/adk/restaurant_finder/README.md).
  ///
  /// If the client is already running, it will be restarted.
  Future<void> startAndVerify() async {
    _process?.kill();
    _process = null;
    killProcessesOnPort(10002);

    _process = await startAndVerifyService(
      'uv run .',
      '../../../../../samples/agent/adk/restaurant_finder',
      [
        ShellProbe(
          command: 'curl $_restaurantFinderAgentCardUrl',
          responseChecker: (response) {
            expect(response, contains('capabilities'));
            expect(response, contains('A2UI'));
            print('\nReceived agent card:\n$response\n');
          },
        ),
        ShellProbe(
          command: _restaurantFinderCurlMessage,
          responseChecker: (response) {
            expect(response, contains('"parts":[{"kind":'));
            print('\nReceived agent response:\n$response\n');
          },
        ),
      ],
    );
  }

  void stop() {
    _process?.kill();
    _process = null;
  }

  void dispose() {
    stop();
  }

  void sendMessage(String message) {}
}

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

import 'package:a2ui_flutter_example/llm_client.dart';

/// Passes each request to another [LlmClient], and prints and keeps the
/// user turn it ends with and the reply.
class RecordingClient implements LlmClient {
  RecordingClient(this._client);

  final LlmClient _client;

  /// The user turn each request ended with, in order.
  final List<String> requests = [];

  /// The chunks of each reply, in order.
  final List<List<String>> replies = [];

  /// Reads the whole reply before yielding its chunks, so that a reply the
  /// API breaks off, which it does under load (HTTP 503), is requested again,
  /// up to twice, unless the listener has cancelled. Rethrows the last
  /// failure.
  @override
  Stream<String> generate(String systemPrompt, List<ChatTurn> turns) async* {
    requests.add(turns.last.text);
    print('\n=== User turn ${requests.length}:\n${turns.last.text}');
    final stopwatch = Stopwatch()..start();
    for (var attempt = 1; ; attempt++) {
      try {
        final List<String> chunks = await _client
            .generate(systemPrompt, turns)
            .toList();
        replies.add(chunks);
        print(
          '=== Reply ${replies.length} (${chunks.length} chunks, '
          '${stopwatch.elapsed.inMilliseconds} ms):\n${chunks.join()}',
        );
        yield* Stream.fromIterable(chunks);
        return;
      } on Exception catch (error) {
        print('=== Attempt $attempt failed: $error');
        if (attempt == 3) rethrow;
        await Future<void>.delayed(Duration(seconds: 5 * attempt));
        // Returns here if the listener cancelled during the wait.
        yield* const Stream.empty();
      }
    }
  }
}

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

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;

/// One turn of a conversation with a model.
typedef ChatTurn = ({bool fromUser, String text});

/// A language model that streams its replies.
abstract interface class LlmClient {
  /// Yields the model's reply to [turns], which end with a user turn, under
  /// [systemPrompt], as the model streams it.
  Stream<String> generate(String systemPrompt, List<ChatTurn> turns);
}

/// A Gemini model, reached through `package:dartantic_ai`.
class GeminiClient implements LlmClient {
  GeminiClient({required String apiKey, String modelName = 'gemini-3.6-flash'})
    : _agent = dartantic.Agent.forProvider(
        dartantic.GoogleProvider(apiKey: apiKey),
        chatModelName: modelName,
      );

  final dartantic.Agent _agent;

  /// Retries a failed request twice while nothing has been yielded, since the
  /// API sometimes rejects one under load (HTTP 503), and rethrows the last
  /// failure. Starts no retry once the listener has cancelled.
  @override
  Stream<String> generate(String systemPrompt, List<ChatTurn> turns) async* {
    final List<dartantic.ChatMessage> history = [
      dartantic.ChatMessage.system(systemPrompt),
      for (final ChatTurn turn in turns.take(turns.length - 1))
        turn.fromUser
            ? dartantic.ChatMessage.user(turn.text)
            : dartantic.ChatMessage.model(turn.text),
    ];
    for (var attempt = 1; ; attempt++) {
      var yielded = false;
      try {
        await for (final dartantic.ChatResult<String> result
            in _agent.sendStream(turns.last.text, history: history)) {
          if (result.output.isEmpty) continue;
          yielded = true;
          yield result.output;
        }
        return;
      } on Exception {
        if (yielded || attempt == 3) rethrow;
        await Future<void>.delayed(Duration(seconds: 5 * attempt));
        // Returns here if the listener cancelled during the wait.
        yield* const Stream.empty();
      }
    }
  }
}

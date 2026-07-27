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

import 'dart:async';

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;

import 'api_key.dart';

/// An abstract interface for AI clients.
abstract interface class AiClient {
  /// Sends a message stream request to the AI service.
  ///
  /// [prompt] is the user's message.
  /// [history] is the conversation history.
  Stream<String> sendStream(
    String prompt, {
    required List<dartantic.ChatMessage> history,
  });

  /// Dispose of resources.
  void dispose();
}

/// An implementation of [AiClient] using `package:dartantic_ai`.
class DartanticAiClient implements AiClient {
  DartanticAiClient({String? modelName}) {
    final String apiKey = apiKeyForEval();
    _provider = dartantic.GoogleProvider(apiKey: apiKey);
    _agent = dartantic.Agent.forProvider(
      _provider,
      chatModelName: modelName ?? 'gemini-3-flash-preview',
    );
  }

  late final dartantic.GoogleProvider _provider;
  late final dartantic.Agent _agent;

  @override
  Stream<String> sendStream(
    String prompt, {
    required List<dartantic.ChatMessage> history,
  }) async* {
    final Stream<dartantic.ChatResult<String>> stream = _agent.sendStream(
      prompt,
      history: history,
    );

    await for (final result in stream) {
      if (result.output.isNotEmpty) {
        yield result.output;
      }
    }
  }

  @override
  void dispose() {
    // Dartantic Agent/Provider doesn't strictly require disposal currently,
    // but good to have the hook.
  }
}

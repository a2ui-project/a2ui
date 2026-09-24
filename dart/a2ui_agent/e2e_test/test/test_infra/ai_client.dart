// Copyright 2024 Google LLC
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

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;

import 'api_key.dart';

/// Sends one-turn requests to a Gemini model through `package:dartantic_ai`.
class AiClient {
  AiClient({String modelName = 'gemini-3.8-flash'})
    : _agent = dartantic.Agent.forProvider(
        dartantic.GoogleProvider(apiKey: apiKeyForEval()),
        chatModelName: modelName,
      );

  final dartantic.Agent _agent;

  /// Sends [userMessage] under [systemPrompt] and returns the complete
  /// response.
  Future<String> send(String systemPrompt, String userMessage) async {
    final dartantic.ChatResult<String> result = await _agent.send(
      userMessage,
      history: [dartantic.ChatMessage.system(systemPrompt)],
    );
    return result.output;
  }
}

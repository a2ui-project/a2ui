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
import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;
import 'package:simple_chat/agent/ai_client.dart';

/// A fake implementation of [AiClient] for testing.
class FakeAiClient implements AiClient {
  final StreamController<core.AgentToRendererMessage> _a2uiMessageController =
      StreamController<core.AgentToRendererMessage>.broadcast();

  final StreamController<String> _textResponseController =
      StreamController<String>.broadcast();

  // Queue of responses to send for each request.
  final List<String> _responses = [];

  final List<String> _receivedPrompts = [];
  List<String> get receivedPrompts => List.unmodifiable(_receivedPrompts);

  Stream<core.AgentToRendererMessage> get a2uiMessageStream =>
      _a2uiMessageController.stream;

  Stream<String> get textResponseStream => _textResponseController.stream;

  /// Adds a response to the queue.
  void addResponse(String response) {
    _responses.add(response);
  }

  @override
  Stream<String> sendStream(
    String prompt, {
    required List<dartantic.ChatMessage> history,
  }) async* {
    _receivedPrompts.add(prompt);
    if (_responses.isEmpty) {
      yield 'I have no response for that.';
      return;
    }

    final String response = _responses.removeAt(0);

    // Simulate streaming by yielding characters or chunks
    // For simplicity, we can just yield the whole thing or split it.
    // Let's split it into small chunks to simulate network.
    const chunkSize = 10;
    for (var i = 0; i < response.length; i += chunkSize) {
      final int end = (i + chunkSize < response.length)
          ? i + chunkSize
          : response.length;
      yield response.substring(i, end);
      // tiny delay
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  @override
  void dispose() {
    _a2uiMessageController.close();
    _textResponseController.close();
  }
}

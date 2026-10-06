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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;
import 'package:logging/logging.dart';

import 'ai_client.dart';

typedef ChunkHandler = void Function(String chunk);

class SimpleChatAgent {
  SimpleChatAgent({AiClient? aiClient, required this.onChunkFromAgent})
    : aiClient = aiClient ?? DartanticAiClient();

  final AiClient aiClient;
  final ChunkHandler onChunkFromAgent;
  final List<dartantic.ChatMessage> _history = [];

  final Logger _logger = Logger('SimpleChatAgent');

  void addSystemMessage(String content) {
    _history.add(dartantic.ChatMessage.system(content));
  }

  Future<void> handleRequestFromRenderer(ChatMessage message) async {
    final buffer = StringBuffer();
    for (final dartantic.StandardPart part in message.parts) {
      if (part.isUiInteractionPart) {
        buffer.write(part.asUiInteractionPart!.interaction);
      } else if (part is TextPart) {
        buffer.write(part.text);
      }
    }
    final text = buffer.toString();
    if (text.isEmpty) return;

    _history.add(dartantic.ChatMessage.user(text));

    try {
      final Stream<String> stream = aiClient.sendStream(
        text,
        history: List.of(_history),
      );
      final fullResponseBuffer = StringBuffer();

      await for (final chunk in stream) {
        if (chunk.isNotEmpty) {
          fullResponseBuffer.write(chunk);
          onChunkFromAgent(chunk);
        }
      }

      _history.add(dartantic.ChatMessage.model(fullResponseBuffer.toString()));
    } catch (exception, stackTrace) {
      _logger.severe('Error sending request', exception, stackTrace);
      rethrow;
    }
  }
}

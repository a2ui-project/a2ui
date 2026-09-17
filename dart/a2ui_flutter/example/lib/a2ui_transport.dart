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
import 'package:a2ui_flutter/a2ui_flutter.dart';

import 'agent/agent.dart';
import 'agent/ai_client.dart';

/// A [Transport] that communicates with [SimpleChatAgent].
class SimpleChatA2aTransport implements Transport {
  SimpleChatA2aTransport({AiClient? aiClient}) {
    _agent = SimpleChatAgent(
      aiClient: aiClient,
      onChunkFromAgent: _adapter.addChunk,
    );
  }

  late final SimpleChatAgent _agent;
  final A2uiTransportAdapter _adapter = A2uiTransportAdapter();

  @override
  Stream<core.AgentToRendererMessage> get incomingMessages =>
      _adapter.incomingMessages;

  @override
  Stream<String> get incomingText => _adapter.incomingText;

  @override
  Future<void> sendRequest(ChatMessage message) async {
    await _agent.handleRequestFromRenderer(message);
  }

  @override
  void dispose() => _adapter.dispose();

  /// Adds a system message to the history.
  void addSystemMessage(String content) => _agent.addSystemMessage(content);
}

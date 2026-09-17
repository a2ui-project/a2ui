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

import '../model/chat_message.dart';

/// An interface for transporting messages between GenUI and an AI service.
///
/// This unifies the concept of incoming streams (text chunks and A2UI messages)
/// and outgoing requests.
abstract interface class Transport {
  /// A stream of raw text chunks received from the AI service.
  ///
  /// This is typically used for "streaming" responses where the text is built
  /// up over time.
  Stream<String> get incomingText;

  /// A stream of parsed [core.AgentToRendererMessage]s received from the AI
  /// service.
  Stream<core.AgentToRendererMessage> get incomingMessages;

  /// Sends a request to the AI service.
  Future<void> sendRequest(ChatMessage message);

  /// Disposes of any resources used by this transport.
  void dispose();
}

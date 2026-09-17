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

import 'package:a2ui_core/a2ui_core.dart' as core;

/// A base class for events related to the GenUI generation process.
sealed class GenerationEvent {
  const GenerationEvent();
}

/// An event containing a text chunk from the LLM.
class TextEvent extends GenerationEvent {
  /// Creates a [TextEvent] with the given [text].
  const TextEvent(this.text);

  /// The text content.
  final String text;
}

/// An event containing a parsed [core.AgentToRendererMessage].
class A2uiMessageEvent extends GenerationEvent {
  /// Creates an [A2uiMessageEvent] with the given [message].
  const A2uiMessageEvent(this.message);

  /// The parsed message.
  final core.AgentToRendererMessage message;
}

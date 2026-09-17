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

import '../interfaces/transport.dart';
import '../model/chat_message.dart';
import '../model/generation_events.dart';
import 'a2ui_parser_transformer.dart';

export '../model/generation_events.dart'
    show A2uiMessageEvent, GenerationEvent, TextEvent;

/// A manual sender callback.
typedef ManualSendCallback = Future<void> Function(ChatMessage message);

/// The primary high-level API for typical Flutter application development.
///
/// It wraps the [A2uiParserTransformer] to provide an imperative, push-based
/// interface that is easier to integrate into imperative loops.
///
/// Use [addChunk] to feed text chunks from an LLM.
/// Use [addMessage] to feed raw A2UI messages.
class A2uiTransportAdapter implements Transport {
  /// Creates a [A2uiTransportAdapter].
  ///
  /// The [onSend] callback is required if [sendRequest] will be called.
  A2uiTransportAdapter({this.onSend}) {
    _pipeline = _inputStream.stream
        .transform(const A2uiParserTransformer())
        .asBroadcastStream();
  }

  /// The callback to invoke when [sendRequest] is called.
  final ManualSendCallback? onSend;

  final StreamController<String> _inputStream = StreamController();
  final StreamController<core.AgentToRendererMessage> _messageStream =
      StreamController.broadcast();
  late final Stream<GenerationEvent> _pipeline;
  StreamSubscription<GenerationEvent>? _pipelineSubscription;

  /// Feeds a chunk of text from the LLM to the controller.
  ///
  /// The controller buffers and parses this internally using the transformer.
  void addChunk(String text) {
    _pipelineSubscription ??= _pipeline.listen((event) {
      if (event is A2uiMessageEvent) {
        _messageStream.add(event.message);
      }
    });
    _inputStream.add(text);
  }

  /// Feeds a raw A2UI message (e.g. from a tool output or separate channel).
  void addMessage(core.AgentToRendererMessage message) {
    _messageStream.add(message);
  }

  /// A stream of sanitizer text for the chat UI.
  ///
  /// Chunk whitespace is preserved as emitted, so consumers can concatenate
  /// chunks without words smashing together across chunk boundaries.
  @override
  Stream<String> get incomingText => _pipeline
      .where((e) => e is TextEvent)
      .cast<TextEvent>()
      .map((e) => e.text)
      .where((text) => text.isNotEmpty);

  /// A stream of A2UI messages parsed from the input.
  @override
  Stream<core.AgentToRendererMessage> get incomingMessages =>
      _messageStream.stream;

  @override
  Future<void> sendRequest(ChatMessage message) async {
    if (onSend == null) {
      throw StateError(
        'A2uiTransportAdapter.onSend must be provided to use sendRequest.',
      );
    }
    await onSend!(message);
  }

  Future<void> flush() async {
    await _inputStream.close();
    await _pipelineSubscription?.asFuture<void>();
  }

  /// Closes the controller and cleans up resources.
  @override
  void dispose() {
    _inputStream.close();
    _messageStream.close();
    _pipelineSubscription?.cancel();
  }
}

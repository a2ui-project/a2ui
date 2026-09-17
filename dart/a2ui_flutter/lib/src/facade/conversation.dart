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

import 'package:flutter/foundation.dart';

import '../engine/surface_controller.dart' show SurfaceController;
import '../engine/surface_controller.dart';
import '../interfaces/transport.dart';
import '../model/chat_message.dart';
import '../model/ui_models.dart';

/// Events emitted by [Conversation] to notify listeners of changes.
sealed class ConversationEvent {}

/// Fired when a new surface is added.
final class ConversationSurfaceAdded extends ConversationEvent {
  /// Creates a [ConversationSurfaceAdded] event.
  ConversationSurfaceAdded(this.surfaceId, this.definition);

  /// The ID of the added surface.
  final String surfaceId;

  /// The definition of the added surface.
  final SurfaceDefinition definition;
}

/// Fired when components are updated on a surface.
final class ConversationComponentsUpdated extends ConversationEvent {
  /// Creates a [ConversationComponentsUpdated] event.
  ConversationComponentsUpdated(this.surfaceId, this.definition);

  /// The ID of the updated surface.
  final String surfaceId;

  /// The new definition of the surface.
  final SurfaceDefinition definition;
}

/// Fired when a surface is removed.
final class ConversationSurfaceRemoved extends ConversationEvent {
  /// Creates a [ConversationSurfaceRemoved] event.
  ConversationSurfaceRemoved(this.surfaceId);

  /// The ID of the removed surface.
  final String surfaceId;
}

/// Fired when new content (text) is received from the LLM.
final class ConversationContentReceived extends ConversationEvent {
  /// Creates a [ConversationContentReceived] event.
  ConversationContentReceived(this.text);

  /// The text content received.
  final String text;
}

/// Fired when a request is sent to the LLM and the conversation is waiting
/// for an AI response.
final class ConversationWaiting extends ConversationEvent {}

/// Fired when an error occurs during the conversation.
final class ConversationError extends ConversationEvent {
  /// Creates a [ConversationError] event.
  ConversationError(this.error, [this.stackTrace]);

  /// The error that occurred.
  final Object error;

  /// The stack trace associated with the error, if any.
  final StackTrace? stackTrace;
}

/// State of the conversation.
class ConversationState {
  /// Creates a [ConversationState].
  const ConversationState({
    required this.surfaces,
    required this.latestText,
    required this.isWaiting,
  });

  /// The list of active surface IDs.
  final List<String> surfaces;

  /// The latest text received.
  final String latestText;

  /// Whether we are waiting for a response.
  final bool isWaiting;

  /// Creates a copy of this state with the given fields replaced.
  ConversationState copyWith({
    List<String>? surfaces,
    String? latestText,
    bool? isWaiting,
  }) {
    return ConversationState(
      surfaces: surfaces ?? this.surfaces,
      latestText: latestText ?? this.latestText,
      isWaiting: isWaiting ?? this.isWaiting,
    );
  }
}

/// Facade for managing a GenUI conversation.
///
/// Orchestrates communication between the [SurfaceController] and the
/// [Transport]. Manages the conversation state, including active surfaces, the
/// latest text response, and waiting status.
interface class Conversation {
  /// Creates a [Conversation].
  ///
  /// The [controller] manages the state of the UI surfaces.
  /// The [transport] handles sending and receiving messages.
  Conversation({required this.controller, required this.transport}) {
    _transportSubscription = transport.incomingMessages.listen(
      controller.handleMessage,
    );

    // Listen to transport text and emit events
    _textSubscription = transport.incomingText.listen((text) {
      _eventController.add(ConversationContentReceived(text));
      _updateState((s) => s.copyWith(latestText: text));
    });

    // Listen to controller updates and emit events
    _engineSubscription = controller.surfaceUpdates.listen((update) {
      switch (update) {
        case SurfaceAdded(:final surfaceId, :final definition):
          _eventController.add(ConversationSurfaceAdded(surfaceId, definition));
          _updateState((s) {
            if (!s.surfaces.contains(surfaceId)) {
              return s.copyWith(surfaces: [...s.surfaces, surfaceId]);
            }
            return s;
          });
        case ComponentsUpdated(:final surfaceId, :final definition):
          _eventController.add(
            ConversationComponentsUpdated(surfaceId, definition),
          );
        case SurfaceRemoved(:final surfaceId):
          _eventController.add(ConversationSurfaceRemoved(surfaceId));
          _updateState(
            (s) => s.copyWith(
              surfaces: s.surfaces.where((id) => id != surfaceId).toList(),
            ),
          );
      }
    });

    // Listen for controller submissions (e.g. errors or user actions) and
    // forward them.
    _engineSubmitSubscription = controller.onSubmit.listen(sendRequest);
  }

  /// The controller that manages the surfaces.
  final SurfaceController controller;

  /// The transport layer for sending and receiving messages.
  final Transport transport;

  final StreamController<ConversationEvent> _eventController =
      StreamController.broadcast();

  final ValueNotifier<ConversationState> _stateNotifier = ValueNotifier(
    const ConversationState(surfaces: [], latestText: '', isWaiting: false),
  );

  StreamSubscription<dynamic>? _transportSubscription;
  StreamSubscription<dynamic>? _textSubscription;
  StreamSubscription<dynamic>? _engineSubscription;
  StreamSubscription<dynamic>? _engineSubmitSubscription;

  /// A stream of events emitted by the conversation.
  Stream<ConversationEvent> get events => _eventController.stream;

  /// The current state of the conversation.
  ValueListenable<ConversationState> get state => _stateNotifier;

  /// Sends a request to the LLM.
  Future<void> sendRequest(ChatMessage message) async {
    _eventController.add(ConversationWaiting());
    _updateState((s) => s.copyWith(isWaiting: true));
    try {
      await transport.sendRequest(message);
    } catch (exception, stackTrace) {
      _eventController.add(ConversationError(exception, stackTrace));
    } finally {
      _updateState((s) => s.copyWith(isWaiting: false));
    }
  }

  void _updateState(ConversationState Function(ConversationState) updater) {
    _stateNotifier.value = updater(_stateNotifier.value);
  }

  /// Disposes of the conversation and releases resources.
  void dispose() {
    _transportSubscription?.cancel();
    _textSubscription?.cancel();
    _engineSubscription?.cancel();
    _engineSubmitSubscription?.cancel();
    _eventController.close();
    _stateNotifier.dispose();
  }
}

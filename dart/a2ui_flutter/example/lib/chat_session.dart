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
import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

import 'a2ui_transport.dart';
import 'agent/agent.dart';
import 'agent/ai_client.dart';
import 'primitives/app_mode.dart';
import 'primitives/climbing/a2ui_components/climbing.dart';
import 'primitives/message.dart';

export 'agent/ai_client.dart' show AiClient;

/// System prompts used to configure the chat sessions in this example.
abstract final class Prompts {
  Prompts._();

  static const String summary =
      'You are a helpful assistant who chats with a user.';

  static final String choicePicker =
      '''
When you need additional information from the user, try to use the component '${BasicCatalogItems.choicePicker.name}' to ask for it.
''';

  static final String textFieldFallback =
      '''
If there is no way to itemize all the options, either use the component '${BasicCatalogItems.textField.name}' or add option 'Other' to the '${BasicCatalogItems.choicePicker.name}'.
''';

  static final String climbingLocations =
      '''
If the user is asking about climbing locations, use the 'listClimbingLocations' tool to get a list of climbing locations.
Always use the component named '${climbingLocationItem.name}' to display the locations. The '${climbingLocationItem.name}' component already includes a 'Learn more' button; do not add any extra submit/confirmation buttons next to it.
When the user clicks 'Learn more' on a '${climbingLocationItem.name}', a UI action named 'learnMoreAboutLocation' will be sent with the location's identifier and name in its context. Respond with detailed information about that specific location.

When user asks about climbing locations, never use other components.
''';
}

final Catalog _basicCatalog =
    BasicCatalogItems.asCatalog(
      systemPromptFragments: [Prompts.choicePicker, Prompts.textFieldFallback],
    ).copyWithout(
      itemsToRemove: [
        BasicCatalogItems.audioPlayer,
        BasicCatalogItems.image,
        BasicCatalogItems.video,
      ],
    );

final Catalog _customCatalog = _basicCatalog.copyWith(
  systemPromptFragments: [
    Prompts.climbingLocations,
    ..._basicCatalog.systemPromptFragments,
  ],
  newItems: [climbingLocationItem],
);

PromptBuilder _promptBuilderFor(Catalog catalog) => PromptBuilder.chat(
  catalog: catalog,
  systemPromptFragments: [
    Prompts.summary,
    PromptFragments.acknowledgeUser(),
    PromptFragments.requireAtLeastOneSubmitElement(
      prefix: PromptBuilder.defaultImportancePrefix,
    ),
    PromptFragments.uiGenerationRestriction(
      prefix: PromptBuilder.defaultImportancePrefix,
    ),
  ],
);

sealed class ChatSession extends ChangeNotifier {
  ChatSession._();

  factory ChatSession({AiClient? aiClient, required AppMode mode}) {
    return switch (mode) {
      AppMode.customCatalog => A2uiChatSession(
        aiClient: aiClient,
        catalog: _customCatalog,
      ),
      AppMode.basicCatalog => A2uiChatSession(
        aiClient: aiClient,
        catalog: _basicCatalog,
      ),
      AppMode.textOnly => TextOnlyChatSession(aiClient: aiClient),
    };
  }

  final List<Message> _messages = [];
  List<Message> get messages => List.unmodifiable(_messages);

  bool _isProcessing = false;
  bool get isProcessing => _isProcessing;

  /// The surface host for rendering generative UI surfaces, or `null` if this
  /// session does not produce surfaces (e.g. text-only chat).
  SurfaceHost? get surfaceController => null;

  final Logger _logger = Logger('ChatSession');

  Message? _currentAiMessage;

  Future<void> sendMessage(String text);

  void _addUserMessage(String text) {
    _messages.add(Message(isUser: true, text: 'You: $text'));
    notifyListeners();
  }

  void _updateAiMessage(String chunk) {
    if (_currentAiMessage == null) {
      _currentAiMessage = Message(isUser: false, text: '');
      _messages.add(_currentAiMessage!);
    }
    _currentAiMessage!.text = (_currentAiMessage!.text ?? '') + chunk;
    notifyListeners();
  }

  void _reportError(Object error, {required bool showInChat}) {
    _logger.severe('Error in conversation', error);
    if (showInChat) {
      _messages.add(Message(isUser: false, text: 'Error: $error'));
      notifyListeners();
    }
  }

  Future<void> _runRequest(Future<void> Function() body) async {
    if (_isProcessing) return;

    // TODO(https://github.com/a2ui-project/a2ui/issues/2236):
    // disable input when isProcessing is true.

    // The response streams in through `_updateAiMessage`, which starts a new
    // bubble when `_currentAiMessage` is null and appends to that bubble
    // otherwise. Clearing it here is what gives the coming response a bubble of
    // its own. Every request runs through here, both typed messages and the
    // ones a surface submits when the user taps a button, so a button's reply
    // does not end up appended to the previous response.
    _currentAiMessage = null;
    _isProcessing = true;
    notifyListeners();
    try {
      await body();
    } catch (exception, stackTrace) {
      _logger.severe('Error sending request', exception, stackTrace);
      _reportError(exception, showInChat: true);
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }
}

/// A chat session that only supports text messages.
class TextOnlyChatSession extends ChatSession {
  TextOnlyChatSession({AiClient? aiClient}) : super._() {
    _agent = SimpleChatAgent(
      aiClient: aiClient,
      onChunkFromAgent: _updateAiMessage,
    );
    _agent.addSystemMessage(Prompts.summary);
  }

  late final SimpleChatAgent _agent;

  @override
  Future<void> sendMessage(String text) async {
    if (text.isEmpty) return;

    _addUserMessage(text);

    await _runRequest(
      () => _agent.handleRequestFromRenderer(ChatMessage.user(text)),
    );
  }
}

/// A chat session that supports generative UI.
class A2uiChatSession extends ChatSession {
  A2uiChatSession({AiClient? aiClient, required Catalog catalog})
    : _catalog = catalog,
      super._() {
    _transport = SimpleChatA2aTransport(aiClient: aiClient);
    _surfaceController = SurfaceController(catalogs: [catalog]);
    _init();
  }

  final Catalog _catalog;

  late final SimpleChatA2aTransport _transport;
  late final SurfaceController _surfaceController;

  @override
  SurfaceController get surfaceController => _surfaceController;

  late final StreamSubscription<core.AgentToRendererMessage> _messageSub;
  late final StreamSubscription<String> _textSub;
  late final StreamSubscription<ChatMessage> _submitSub;
  late final StreamSubscription<SurfaceUpdate> _surfaceSub;

  void _init() {
    _messageSub = _transport.incomingMessages.listen(
      _surfaceController.handleMessage,
    );
    _textSub = _transport.incomingText.listen(_updateAiMessage);
    _submitSub = _surfaceController.onSubmit.listen(
      (message) => _runRequest(() => _transport.sendRequest(message)),
    );
    _surfaceSub = _surfaceController.surfaceUpdates.listen(_onSurfaceUpdate);

    final PromptBuilder pb = _promptBuilderFor(_catalog);
    _transport.addSystemMessage(pb.systemPromptJoined());
  }

  void _onSurfaceUpdate(SurfaceUpdate update) {
    switch (update) {
      case SurfaceAdded(:final surfaceId):
        _addSurfaceMessage(surfaceId);
      case SurfaceRemoved(:final surfaceId):
        _reportError(
          'Surface $surfaceId removed, that should not happen in chat.',
          showInChat: false,
        );
      case ComponentsUpdated():
        break;
    }
  }

  void _addSurfaceMessage(String surfaceId) {
    final bool exists = _messages.any((m) => m.surfaceId == surfaceId);
    if (!exists) {
      _messages.add(Message(isUser: false, text: null, surfaceId: surfaceId));
      notifyListeners();
    }
  }

  @override
  Future<void> sendMessage(String text) async {
    if (text.isEmpty) return;

    _addUserMessage(text);

    await _runRequest(() => _transport.sendRequest(ChatMessage.user(text)));
  }

  @override
  void dispose() {
    _messageSub.cancel();
    _textSub.cancel();
    _submitSub.cancel();
    _surfaceSub.cancel();
    _surfaceController.dispose();
    _transport.dispose();
    super.dispose();
  }
}

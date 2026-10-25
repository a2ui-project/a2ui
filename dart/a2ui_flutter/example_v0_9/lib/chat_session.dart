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
import 'dart:convert';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'llm_client.dart';

/// What the app tells the model, ahead of the agent SDK's prompt snippet.
const String appInstructions = '''
You are the assistant of a chat app that renders A2UI. Answer in a sentence or
two, and show forms, choices, lists and cards as A2UI surfaces.

- Give each new surface a new surfaceId, and set "sendDataModel": true on a
  surface with inputs.
- Bind each input to a data model path. Give a submit button an event action
  whose context reads those paths.
- When the user acts on a surface, the next user turn is JSON whose "a2ui"
  holds the renderer's v0.9 messages, {"messages": [...]}. A message is an
  action, with its name and resolved context, or an error the renderer met.
- Once a surface is created with sendDataModel, a user turn carries
  "metadata": {"a2uiClientDataModel": ...}, which holds the data model of each
  such surface: beside "a2ui" in the JSON of an action or error turn, or as
  JSON after the text of a typed turn.
- Answer an action by updating its surface, or with a new surface. Answer an
  error by correcting the surface it names.
''';

/// The basic catalog, which opens URLs with url_launcher.
/// The model can open a URL without the user acting. The demo trusts it to.
final CatalogImplementation _catalog = basicCatalog(openUrl: launchUrl);

/// What a [ChatEntry] shows.
enum ChatEntryKind {
  /// Text the user typed.
  user,

  /// Text the model wrote outside its A2UI payloads.
  model,

  /// A surface the model created.
  surface,

  /// A turn the app sent the model for the user, named by its actions and
  /// errors.
  sent,

  /// An error the renderer met, or a failed request to the model.
  error,
}

/// One entry of the conversation.
class ChatEntry {
  ChatEntry(this.kind, this.text) : surface = null;

  ChatEntry.surface(SurfaceModel<ComponentImplementation> this.surface)
    : kind = ChatEntryKind.surface,
      text = '';

  final ChatEntryKind kind;

  /// The entry's text, which grows while the model streams it.
  String text;

  final SurfaceModel<ComponentImplementation>? surface;
}

/// A conversation in which a model answers with text and A2UI surfaces.
///
/// The model is prompted for the basic catalog the renderer supports. Its
/// reply is parsed and rendered as it streams. Actions on its surfaces, and
/// errors the renderer meets, go back to it as the next user turn.
class ChatSession extends ChangeNotifier {
  ChatSession({required this.client}) {
    processor.model.onSurfaceCreated.subscribe(_addSurface);
    processor.model.onSurfaceDeleted.subscribe(_removeSurface);
    processor.model.onAction.subscribe(_sendAction);
  }

  final LlmClient client;

  /// The renderer's message processor, with the checks that a half-streamed
  /// surface would fail turned off.
  final MessageProcessor<ComponentImplementation> processor = MessageProcessor(
    catalogs: [_catalog],
    defaultVersion: A2uiProtocolVersion.v0_9,
    validationConfig: ValidationConfig.relaxed,
  );

  static final String _version = A2uiProtocolVersion.v0_9.jsonValue;

  static const _format = DirectJsonFormatFactory(
    progressiveKeys: {'text', 'label'},
  );

  final A2uiRequestProcessor _agent =
      A2uiGenerator(
        catalogs: [CatalogConfig(_catalog)],
        inferenceFormatFactory: _format,
      ).createProcessor(
        A2uiRendererCapabilities.forCatalogIds([
          BasicCatalog.v0_9Id,
        ], version: A2uiProtocolVersion.v0_9),
      );

  /// The surfaces the model's replies have created, as the agent SDK checks
  /// each reply against them.
  late final RendererState _state = _agent.createState();

  /// [appInstructions] and the agent SDK's prompt snippet for the catalogs
  /// the renderer supports.
  late final String systemPrompt = '$appInstructions\n${_agent.promptSnippet}';

  /// The conversation as the user sees it.
  final List<ChatEntry> entries = [];

  final List<ChatTurn> _turns = [];
  Future<void> _queue = Future.value();
  int _queued = 0;
  StreamIterator<String>? _reading;
  bool _disposed = false;

  /// Whether a turn is waiting for, or reading, the model's reply.
  bool get busy => _queued > 0;

  /// Sends [text] to the model with the renderer data model as it is when the
  /// turn starts, and completes once its reply is applied.
  Future<void> send(String text) {
    entries.add(ChatEntry(ChatEntryKind.user, text));
    _errorTurns = 0;
    return _enqueue(() {
      final Map<String, Object?> metadata = _metadata();
      return _runTurn(
        metadata.isEmpty ? text : '$text\n\n${jsonEncode(metadata)}',
      );
    });
  }

  /// Runs [turn] once the turns queued before it end, and shows what it
  /// throws as an error. Does nothing once the session is disposed.
  Future<void> _enqueue(Future<void> Function() turn) {
    if (_disposed) return Future.value();
    _queued++;
    _notify();
    return _queue = _queue
        .then((_) => turn())
        .catchError((Object error) {
          _addEntry(ChatEntryKind.error, 'The turn failed: $error');
        })
        .whenComplete(() {
          _queued--;
          _notify();
        });
  }

  ChatEntry? _modelText;

  Future<void> _runTurn(String userTurn) async {
    if (_disposed) return;
    _turns.add((fromUser: true, text: userTurn));
    _reported.clear();
    ResponseStream? stream = _agent.openStream(state: _state);
    final reply = StringBuffer();
    var complete = true;
    _modelText = null;
    final StreamIterator<String> chunks = _reading = StreamIterator(
      client.generate(systemPrompt, List.of(_turns)),
    );
    try {
      while (await chunks.moveNext()) {
        if (_disposed) break;
        reply.write(chunks.current);
        stream = _read(stream, (s) => s.feed(chunks.current));
        _notify();
      }
    } on Object catch (error) {
      complete = false;
      entries.add(ChatEntry(ChatEntryKind.error, 'The request failed: $error'));
    }
    _reading = null;
    if (_disposed) return;
    if (complete) {
      _read(stream, (s) => s.close());
    } else {
      // What closing the cut-off reply throws adds nothing to the failure
      // already shown.
      try {
        stream?.close();
      } on Object catch (_) {}
    }
    if (reply.isEmpty) {
      _turns.removeLast();
      if (complete) {
        entries.add(ChatEntry(ChatEntryKind.error, 'The model gave no reply.'));
      }
    } else {
      _turns.add((fromUser: false, text: '$reply'));
    }
  }

  /// Shows the text and processes the messages that [read] gets from
  /// [stream], and returns [stream], or null once it rejects part of the
  /// reply. That failure is reported, and the rest of the reply is not read.
  ResponseStream? _read(
    ResponseStream? stream,
    List<ResponsePart> Function(ResponseStream stream) read,
  ) {
    if (stream == null) return null;
    try {
      for (final ResponsePart part in read(stream)) {
        switch (part) {
          case TextPart(:final String text):
            _showText(text);
          case A2uiPart(:final List<AgentToRendererMessage> a2ui):
            a2ui.forEach(_process);
        }
      }
      return stream;
    } on Object catch (error) {
      _reportFailure(error, '');
      return null;
    }
  }

  void _showText(String text) {
    (_modelText ??= _addEntry(ChatEntryKind.model)).text += text;
  }

  void _process(AgentToRendererMessage message) {
    _modelText = null;
    try {
      processor.processMessages(AgentToRendererMessagePayload.of(message));
    } on Object catch (error) {
      final String surfaceId = switch (message) {
        CreateSurfaceMessage(:final String surfaceId) ||
        UpdateComponentsMessage(:final String surfaceId) ||
        UpdateDataModelMessage(:final String surfaceId) ||
        DeleteSurfaceMessage(:final String surfaceId) => surfaceId,
        _ => '',
      };
      _reportFailure(error, surfaceId);
    }
  }

  ChatEntry _addEntry(ChatEntryKind kind, [String text = '']) {
    final entry = ChatEntry(kind, text);
    entries.add(entry);
    return entry;
  }

  void _addSurface(SurfaceModel<ComponentImplementation> surface) {
    surface.onError.subscribe(_report);
    entries.add(ChatEntry.surface(surface));
    _modelText = null;
    _notify();
  }

  void _removeSurface(String surfaceId) {
    entries.removeWhere((entry) => entry.surface?.id == surfaceId);
    _notify();
  }

  void _sendAction(A2uiRendererAction action) {
    _errorTurns = 0;
    final String turn = _clientTurn([
      ActionMessage(version: _version, action: action),
    ]);
    unawaited(_enqueue(() => _runTurn(turn)));
  }

  /// [messages] as a v0.9 payload under `a2ui`, with [_metadata] beside it,
  /// written as a user turn.
  String _clientTurn(List<RendererToAgentMessage> messages) {
    final String turn = jsonEncode({
      'a2ui': RendererToAgentMessagePayload(messages).toJson(),
      ..._metadata(),
    });
    _addEntry(
      ChatEntryKind.sent,
      [
        for (final RendererToAgentMessage message in messages)
          switch (message) {
            ActionMessage(:final A2uiRendererAction action) =>
              'action ${action.name}',
            ErrorMessage(:final A2uiRendererError error) =>
              'error ${error.code}',
            _ => message.runtimeType.toString(),
          },
      ].join(', '),
    );
    return turn;
  }

  /// The renderer data model as transport metadata, or nothing when no surface
  /// was created with `sendDataModel`.
  Map<String, Object?> _metadata() {
    final Map<String, dynamic>? dataModel = processor.getRendererDataModel();
    return {
      if (dataModel != null) 'metadata': {'a2uiClientDataModel': dataModel},
    };
  }

  final Set<String> _reported = {};
  final List<A2uiRendererError> _unsent = [];
  int _errorTurns = 0;

  /// How many turns of errors in a row go to the model before the user's
  /// next turn.
  static const int maxErrorTurns = 2;

  /// Reports [error], thrown reading or processing a message of the surface
  /// [surfaceId], under its code and with its path, or as `UNKNOWN_ERROR` if
  /// it is not an [A2uiError] or is a validation failure with no path.
  ///
  /// [surfaceId] is empty for an error thrown reading the reply, which comes
  /// with no message to take the id from.
  void _reportFailure(Object error, String surfaceId) {
    final A2uiError failure = error is A2uiError ? error : A2uiError('$error');
    final String? path = failure is A2uiValidationError ? failure.path : null;
    final bool pathless =
        failure.code == A2uiRendererError.validationFailedCode &&
        (path == null || path.isEmpty);
    _report(
      A2uiRendererError(
        code: pathless ? 'UNKNOWN_ERROR' : failure.code,
        surfaceId: surfaceId,
        message: failure.message,
        path: pathless ? null : path,
      ),
    );
  }

  /// Shows [error] and sends it to the model once the current turn ends.
  ///
  /// An error already reported since the current turn started is ignored.
  void _report(A2uiRendererError error) {
    if (!_reported.add(jsonEncode(error))) return;
    _addEntry(
      ChatEntryKind.error,
      '${error.code} on "${error.surfaceId}": ${error.message}',
    );
    _modelText = null;
    _unsent.add(error);
    _notify();
    unawaited(_enqueue(_sendErrors));
  }

  Future<void> _sendErrors() async {
    if (_disposed || _unsent.isEmpty) return;
    final List<RendererToAgentMessage> errors = [
      for (final A2uiRendererError error in _unsent)
        ErrorMessage(version: _version, error: error),
    ];
    _unsent.clear();
    if (_errorTurns >= maxErrorTurns) return;
    _errorTurns++;
    await _runTurn(_clientTurn(errors));
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Stops reading the current reply and runs no turn after it.
  @override
  void dispose() {
    _disposed = true;
    unawaited(_reading?.cancel());
    processor.dispose();
    _state.dispose();
    super.dispose();
  }
}

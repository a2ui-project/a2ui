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

import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';
import 'package:uuid/uuid.dart';

const String _a2uiExtensionUri = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

/// Connects to an A2A agent endpoint and streams A2UI v0.9 messages over SSE.
class A2uiAgentConnector {
  A2uiAgentConnector({required this.url, http.Client? client})
    : _client = client ?? http.Client(),
      _ownsClient = client == null;

  final Uri url;
  final http.Client _client;
  final bool _ownsClient;
  final Logger _logger = Logger('A2uiAgentConnector');
  final Uuid _uuid = const Uuid();

  final StreamController<AgentToRendererMessage> _messageController =
      StreamController<AgentToRendererMessage>.broadcast();
  final StreamController<String> _textController =
      StreamController<String>.broadcast();
  final StreamController<Object> _errorController =
      StreamController<Object>.broadcast();

  String? _taskId;
  String? _contextId;
  StreamSubscription<String>? _activeStreamSub;

  Stream<AgentToRendererMessage> get stream => _messageController.stream;
  Stream<String> get textStream => _textController.stream;
  Stream<Object> get errorStream => _errorController.stream;

  /// Sends a text turn to the A2A agent and streams its response.
  Future<void> sendText(
    String text, {
    Map<String, Object?>? clientCapabilities,
  }) => _sendParts([
    {'kind': 'text', 'text': text},
  ], clientCapabilities: clientCapabilities);

  /// Sends a resolved A2UI data payload (e.g. an action) to the A2A agent.
  Future<void> sendData(
    Map<String, Object?> data, {
    Map<String, Object?>? clientCapabilities,
  }) => _sendParts([
    {'kind': 'data', 'data': data},
  ], clientCapabilities: clientCapabilities);

  Future<void> _sendParts(
    List<Map<String, Object?>> parts, {
    Map<String, Object?>? clientCapabilities,
  }) async {
    final Map<String, Object?> message = {
      'messageId': _uuid.v4(),
      'role': 'user',
      'parts': parts,
      if (_taskId != null) 'referenceTaskIds': [_taskId],
      if (_contextId != null) 'contextId': _contextId,
      if (clientCapabilities != null)
        'metadata': {'a2uiClientCapabilities': clientCapabilities},
    };

    final Map<String, Object?> rpcRequest = {
      'jsonrpc': '2.0',
      'id': _uuid.v4(),
      'method': 'message/stream',
      'params': {'message': message},
    };

    final request = http.Request('POST', url)
      ..headers.addAll({
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'X-A2A-Extensions': _a2uiExtensionUri,
      })
      ..body = jsonEncode(rpcRequest);

    final http.StreamedResponse response = await _client
        .send(request)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode >= 400) {
      final String body = await response.stream.bytesToString();
      throw StateError(
        'A2A HTTP ${response.statusCode} ${response.reasonPhrase}: $body',
      );
    }

    final Stream<String> lines = response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter());
    final dataLines = <String>[];
    final completer = Completer<void>();

    await _activeStreamSub?.cancel();
    _activeStreamSub = lines.listen(
      (line) {
        if (line.isEmpty) {
          if (dataLines.isNotEmpty) {
            _handleSseEvent(dataLines.join('\n'));
            dataLines.clear();
          }
          return;
        }
        if (line.startsWith('data:')) {
          dataLines.add(line.substring(5).trimLeft());
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        if (!completer.isCompleted) {
          completer.completeError(error, stackTrace);
        }
      },
      onDone: () {
        if (dataLines.isNotEmpty) {
          _handleSseEvent(dataLines.join('\n'));
        }
        if (!completer.isCompleted) {
          completer.complete();
        }
      },
      cancelOnError: true,
    );

    try {
      await completer.future;
    } finally {
      _activeStreamSub = null;
    }
  }

  void _handleSseEvent(String rawData) {
    final Object? decoded;
    try {
      decoded = jsonDecode(rawData);
    } on FormatException catch (e, st) {
      _logger.warning('Failed to decode SSE event JSON: $e', e, st);
      if (!_errorController.isClosed) {
        _errorController.add('A2A Error: Failed to parse event: $e');
      }
      return;
    }
    if (decoded is! Map<String, Object?>) return;

    if (decoded['error'] case final Object error) {
      if (!_errorController.isClosed) {
        _errorController.add('A2A Error: $error');
      }
      return;
    }

    final Object? result = decoded['result'];
    if (result is! Map<String, Object?>) return;

    if (result['taskId'] case final String taskId) {
      _taskId = taskId;
    } else if (result['id'] case final String id) {
      _taskId = id;
    }
    if (result['contextId'] case final String contextId) {
      _contextId = contextId;
    }

    final Object? statusObj = result['status'];
    if (statusObj is Map<String, Object?>) {
      final Object? state = statusObj['state'];
      if (state == 'failed' || state == 'canceled' || state == 'rejected') {
        final errorMessage = 'A2A Error: $state: ${statusObj['message']}';
        _logger.severe(errorMessage);
        if (!_errorController.isClosed) {
          _errorController.add(errorMessage);
        }
        return;
      }
      if (statusObj['message'] case final Map<String, Object?> message) {
        _processMessageParts(message);
      }
    } else if (result['parts'] is List) {
      _processMessageParts(result);
    }
  }

  void _processMessageParts(Map<String, Object?> message) {
    final Object? parts = message['parts'];
    if (parts is! List) return;

    for (final Object? part in parts) {
      if (part is! Map<String, Object?>) continue;
      if (part['data'] case final Object data) {
        _emitA2uiData(data);
      } else if (part['text'] case final String text) {
        final String trimmed = text.trim();
        if (trimmed.isNotEmpty && !_textController.isClosed) {
          _textController.add(trimmed);
        }
      }
    }
  }

  void _emitA2uiData(Object data) {
    if (data is List) {
      for (final Object? item in data) {
        if (item != null) _emitA2uiData(item);
      }
      return;
    }
    if (data is! Map<String, Object?>) return;

    try {
      final message = AgentToRendererMessage.fromJson(data);
      if (!_messageController.isClosed) {
        _messageController.add(message);
      }
    } on Object catch (e, st) {
      _logger.warning('Skipping non-A2UI data part: $e', e, st);
    }
  }

  void dispose() {
    unawaited(_activeStreamSub?.cancel());
    _activeStreamSub = null;
    _messageController.close();
    _textController.close();
    _errorController.close();
    if (_ownsClient) {
      _client.close();
    }
  }
}

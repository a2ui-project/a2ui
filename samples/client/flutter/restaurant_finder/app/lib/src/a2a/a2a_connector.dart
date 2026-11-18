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

import 'package:a2a/a2a.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:logging/logging.dart';
import 'package:uuid/uuid.dart';

const String _a2uiExtensionUri = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

/// Transport glue that connects to the A2A restaurant finder agent using
/// `package:a2a` and streams A2UI v0.9 messages over SSE.
///
/// A2UI is transport-agnostic—this file is only needed to talk to the sample's
/// A2A backend, and you can replace it with any transport you prefer.
class A2uiAgentConnector {
  A2uiAgentConnector({
    required this.url,
    A2AClient? client,
    this.streamTimeout = const Duration(seconds: 60),
  }) : _client =
           client ??
           A2AClient(
             url.toString(),
             customHeaders: const {'X-A2A-Extensions': _a2uiExtensionUri},
             agentCardBackgroundFetch: false,
           );

  final Uri url;
  final Duration streamTimeout;
  final A2AClient _client;
  final Logger _logger = Logger('A2uiAgentConnector');
  final Uuid _uuid = const Uuid();

  bool _agentCardFetched = false;
  String? _taskId;
  String? _contextId;

  /// Sends a text turn to the A2A agent and yields its A2UI messages.
  Stream<AgentToRendererMessage> sendText(
    String text, {
    Map<String, Object?>? clientCapabilities,
  }) => _sendParts([
    A2ATextPart()..text = text,
  ], clientCapabilities: clientCapabilities);

  /// Sends a resolved A2UI data payload (e.g. an action) to the A2A agent.
  Stream<AgentToRendererMessage> sendData(
    Map<String, Object?> data, {
    Map<String, Object?>? clientCapabilities,
  }) => _sendParts([
    A2ADataPart()..data = data,
  ], clientCapabilities: clientCapabilities);

  Stream<AgentToRendererMessage> _sendParts(
    List<A2APart> parts, {
    Map<String, Object?>? clientCapabilities,
  }) async* {
    if (!_agentCardFetched) {
      await _client.getAgentCard().timeout(const Duration(seconds: 30));
      _agentCardFetched = true;
    }

    final message = A2AMessage()
      ..messageId = _uuid.v4()
      ..role = 'user'
      ..parts = parts
      ..referenceTaskIds = _taskId == null ? null : [_taskId!]
      ..contextId = _contextId
      ..metadata = clientCapabilities == null
          ? null
          : {'a2uiClientCapabilities': clientCapabilities};

    final params = A2AMessageSendParams()
      ..message = message
      ..extensions = [_a2uiExtensionUri];

    await for (final A2ASendStreamMessageResponse event
        in _client.sendMessageStream(params).timeout(streamTimeout)) {
      for (final AgentToRendererMessage msg in _handleEvent(event)) {
        yield msg;
      }
    }
  }

  Iterable<AgentToRendererMessage> _handleEvent(
    A2ASendStreamMessageResponse event,
  ) sync* {
    if (event.isError) {
      final A2AError? error = event is A2AJSONRPCErrorResponseSSM
          ? event.error
          : null;
      final int? code = error?.rpcErrorCode;
      final Object detail = code == null
          ? (error ?? event)
          : A2AError.asString(code);
      throw StateError('A2A Error: $detail');
    }

    if (event is! A2ASendStreamMessageSuccessResponse) {
      return;
    }
    final Object? result = event.result;

    if (result is A2ATaskStatusUpdateEvent) {
      _taskId = result.taskId;
      _contextId = result.contextId;
      final A2ATaskStatus? status = result.status;
      final A2ATaskState? state = status?.state;
      if (state == A2ATaskState.failed ||
          state == A2ATaskState.canceled ||
          state == A2ATaskState.rejected) {
        throw StateError('A2A Error: $state: ${status?.message}');
      }
      if (status?.message case final A2AMessage message) {
        yield* _processParts(message.parts);
      }
    } else if (result is A2ATask) {
      _taskId = result.id;
      _contextId = result.contextId;
      if (result.status.message case final A2AMessage message) {
        yield* _processParts(message.parts);
      }
      if (result.artifacts case final List<A2AArtifact> artifacts) {
        for (final artifact in artifacts) {
          yield* _processParts(artifact.parts);
        }
      }
    } else if (result is A2AMessage) {
      yield* _processParts(result.parts);
    }
  }

  Iterable<AgentToRendererMessage> _processParts(List<A2APart> parts) sync* {
    for (final part in parts) {
      if (part is A2ADataPart) {
        yield* _decodeA2uiData(part.data);
      } else if (part is A2ATextPart) {
        final String trimmed = part.text.trim();
        if (trimmed.isNotEmpty) {
          _logger.info('Text from agent: $trimmed');
        }
      }
    }
  }

  Iterable<AgentToRendererMessage> _decodeA2uiData(Object data) sync* {
    if (data case final List<Object?> items) {
      for (final item in items) {
        if (item != null) yield* _decodeA2uiData(item);
      }
      return;
    }
    if (data case final Map<String, Object?> map) {
      try {
        yield AgentToRendererMessage.fromJson(map);
      } on Object catch (e, st) {
        _logger.warning('Skipping non-A2UI data part: $e', e, st);
      }
    }
  }
}

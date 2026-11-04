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

import 'package:a2ui_core/a2ui_core.dart';

import 'agent_function_registry.dart';

/// A callback that receives one kind of message a renderer sent, such as an
/// [ActionMessage]. It may return a [Future], which is awaited.
///
/// Returning `false` declines the message: the processor then reports it as
/// not handled, so the caller passes it on, for example to the model's turn.
/// Returning `true` or `null` (or nothing, from a block body) means the
/// callback handled it.
typedef RendererMessageCallback<T extends RendererToAgentMessage> =
    FutureOr<bool?> Function(T message);

/// What [RendererToAgentMessageProcessor.processMessage] did with a message.
final class ProcessResult {
  /// Whether the processor handled the message: it answered a
  /// `callAgentFunction`, or passed the message to a callback that didn't
  /// decline it.
  ///
  /// False for an `action`, `error` or `rendererFunctionResponse` that has no
  /// callback, or whose callback returned `false`, which the caller passes
  /// on, for example to the model's turn.
  final bool handled;

  /// The messages to send back to the renderer: one
  /// [AgentFunctionResponseMessage] for a `callAgentFunction`, and none for
  /// any other message.
  final List<AgentToRendererMessage> replies;

  /// Creates a result. [replies] is copied into an unmodifiable list.
  ProcessResult({
    required this.handled,
    Iterable<AgentToRendererMessage> replies = const [],
  }) : replies = List<AgentToRendererMessage>.unmodifiable(replies);

  @override
  String toString() =>
      'ProcessResult(handled: $handled, replies: ${replies.length})';
}

/// Processes the v1.0 messages a renderer sends an agent.
///
/// The agent-side counterpart of `a2ui_core`'s `MessageProcessor`:
///
/// - A `callAgentFunction` is always handled. The processor runs the matching
///   [AgentFunction] of its catalogs and replies with exactly one
///   `agentFunctionResponse`, carrying the value or an error.
/// - An `action`, `error` or `rendererFunctionResponse` goes to its callback,
///   [onAction], [onError] or [onRendererFunctionResponse], once validated
///   against the v1.0 schema. A callback may return `false` to decline the
///   message. With no callback set, the message is left unhandled, so the
///   caller can pass it on.
///
/// The processor keeps no state between messages, so one instance can serve
/// every conversation of an agent, or one can be built per request from the
/// catalogs that are active. It processes one message at a time; a caller
/// with several runs [processMessage] on each, and so decides how they run
/// together and what to do when one fails.
///
/// ```dart
/// final processor = RendererToAgentMessageProcessor(
///   catalogs: [catalog.copyWith(agentFunctions: [fetchQuote])],
///   onAction: (action) => action.action.name == 'refresh' ? true : false,
/// );
/// final ProcessResult result = await processor.processMessage(message);
/// if (!result.handled) {
///   // Pass the message on to the model.
/// }
/// sendToRenderer(result.replies);
/// ```
class RendererToAgentMessageProcessor {
  /// Called with each validated `action` message.
  final RendererMessageCallback<ActionMessage>? onAction;

  /// Called with each validated `error` message.
  final RendererMessageCallback<ErrorMessage>? onError;

  /// Called with each validated `rendererFunctionResponse` message.
  final RendererMessageCallback<RendererFunctionResponseMessage>?
  onRendererFunctionResponse;

  final AgentFunctionRegistry _agentFunctions;

  /// Creates a processor that answers calls to the agent functions of
  /// [catalogs] (see [Catalog.agentFunctions]).
  ///
  /// A handler that runs longer than [agentFunctionTimeout] is answered with
  /// an `EXECUTION_ERROR`, and its result is ignored. By default there is no
  /// limit.
  ///
  /// Throws [ArgumentError] if [agentFunctionTimeout] is not positive, and
  /// [A2uiCatalogError] if two of [catalogs] have the same id.
  RendererToAgentMessageProcessor({
    required Iterable<CatalogApi> catalogs,
    Duration? agentFunctionTimeout,
    this.onAction,
    this.onError,
    this.onRendererFunctionResponse,
  }) : _agentFunctions = AgentFunctionRegistry(
         catalogs,
         timeout: agentFunctionTimeout,
       );

  /// Processes one renderer-to-agent [message].
  ///
  /// [message] is a decoded JSON envelope (a `Map`) or a
  /// [RendererToAgentMessage], and must declare version `'1.0'`.
  ///
  /// Throws [A2uiValidationError] when [message] is not an object, when its
  /// version is missing or isn't `'1.0'`, when it carries no message key,
  /// more than one, or one the protocol doesn't define, when a
  /// `callAgentFunction` has no non-empty `functionCallId`, or when a message
  /// that has a callback breaks the v1.0 schema. An exception from a callback
  /// propagates.
  Future<ProcessResult> processMessage(Object? message) async {
    final Object? version = switch (message) {
      RendererToAgentMessage(:final String version) => version,
      Map<Object?, Object?>() => message['version'],
      _ => A2uiProtocolVersion.v1_0.jsonValue,
    };
    if (version != A2uiProtocolVersion.v1_0.jsonValue) {
      throw A2uiValidationError(
        "A renderer-to-agent message must declare version '"
        "${A2uiProtocolVersion.v1_0.jsonValue}', got "
        "${version == null ? 'none' : "'$version'"}.",
      );
    }
    switch (message) {
      case CallAgentFunctionMessage():
        return _answer(message);
      case ActionMessage():
        return _dispatch(message, onAction);
      case ErrorMessage():
        return _dispatch(message, onError);
      case RendererFunctionResponseMessage():
        return _dispatch(message, onRendererFunctionResponse);
      case RendererToAgentMessage():
        throw A2uiValidationError(
          'Unknown renderer-to-agent message type ${message.runtimeType}.',
        );
      case final Map<Object?, Object?> json:
        return _processJson(json);
      default:
        throw A2uiValidationError(
          'A renderer-to-agent message must be an object, got '
          '${message.runtimeType}.',
        );
    }
  }

  Future<ProcessResult> _processJson(Map<Object?, Object?> json) {
    final List<Object?> keys = [
      for (final Object? key in json.keys)
        if (key != 'version') key,
    ];
    if (keys.length != 1) {
      throw A2uiValidationError(
        'A renderer-to-agent message must carry exactly one of '
        "${_messageKeys.join(', ')}; got ${keys.isEmpty ? 'none' : keys}.",
      );
    }
    switch (keys.single) {
      case 'callAgentFunction':
        return _answer(json);
      case 'action':
        return _dispatchJson(json, onAction);
      case 'error':
        return _dispatchJson(json, onError);
      case 'rendererFunctionResponse':
        return _dispatchJson(json, onRendererFunctionResponse);
      default:
        throw A2uiValidationError(
          "Unknown renderer-to-agent message key '${keys.single}'; expected "
          "one of ${_messageKeys.join(', ')}.",
        );
    }
  }

  Future<ProcessResult> _answer(Object message) async {
    final AgentFunctionResponseMessage response = await _agentFunctions.handle(
      message,
    );
    return ProcessResult(handled: true, replies: [response]);
  }

  Future<ProcessResult> _dispatch<T extends RendererToAgentMessage>(
    T message,
    RendererMessageCallback<T>? callback,
  ) async {
    if (callback == null) return ProcessResult(handled: false);
    _parseV1(message.toJson());
    return ProcessResult(handled: await callback(message) != false);
  }

  Future<ProcessResult> _dispatchJson<T extends RendererToAgentMessage>(
    Map<Object?, Object?> json,
    RendererMessageCallback<T>? callback,
  ) async {
    if (callback == null) return ProcessResult(handled: false);
    final RendererToAgentMessage parsed = _parseV1(json);
    return ProcessResult(handled: await callback(parsed as T) != false);
  }

  /// Parses [json], whose version is `'1.0'`, as a renderer-to-agent message.
  static RendererToAgentMessage _parseV1(Map<Object?, Object?> json) {
    final stringKeyed = <String, dynamic>{};
    for (final MapEntry<Object?, Object?> entry in json.entries) {
      final Object? key = entry.key;
      if (key is! String) {
        throw A2uiValidationError(
          'A renderer-to-agent message must have string keys, got $key.',
        );
      }
      stringKeyed[key] = entry.value;
    }
    return RendererToAgentMessage.fromJson(stringKeyed);
  }

  static const List<String> _messageKeys = [
    'action',
    'error',
    'callAgentFunction',
    'rendererFunctionResponse',
  ];
}

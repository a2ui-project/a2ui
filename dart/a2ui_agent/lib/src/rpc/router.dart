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
import 'renderer_function_calls.dart';

/// Routes incoming renderer-to-agent function RPC messages
/// (`callAgentFunction` and `rendererFunctionResponse`) to an
/// [AgentFunctionRegistry] and/or [RendererFunctionCalls] instance.
class RendererMessageRouter {
  /// The registry used to handle incoming `callAgentFunction` messages.
  final AgentFunctionRegistry? agentFunctions;

  /// The tracker used to resolve incoming `rendererFunctionResponse` messages.
  final RendererFunctionCalls? rendererCalls;

  const RendererMessageRouter({this.agentFunctions, this.rendererCalls});

  /// Returns true if [message] is a v1.0 `callAgentFunction` or
  /// `rendererFunctionResponse` message (either a typed
  /// [RendererToAgentMessage] or a raw JSON `Map` envelope).
  bool handles(Object? message) => _classify(message) != _RouteKind.none;

  /// Dispatches [message] to [agentFunctions] or [rendererCalls] and returns
  /// any outbound [AgentToRendererMessage]s produced.
  ///
  /// - For a `callAgentFunction` message, invokes
  ///   [AgentFunctionRegistry.handle] and returns a single-element list
  ///   containing the [AgentFunctionResponseMessage]. Throws [StateError] if
  ///   [agentFunctions] is null.
  /// - For a `rendererFunctionResponse` message, invokes
  ///   [RendererFunctionCalls.resolve] and returns an empty list. Throws
  ///   [StateError] if [rendererCalls] is null.
  /// - For any other message (`action`, `error`, v0.9 envelopes, etc.), returns
  ///   an empty list without throwing.
  Future<List<AgentToRendererMessage>> dispatch(Object message) async {
    final _RouteKind kind = _classify(message);
    switch (kind) {
      case _RouteKind.callAgentFunction:
        final AgentFunctionRegistry? registry = agentFunctions;
        if (registry == null) {
          throw StateError(
            'Received callAgentFunction message, but no AgentFunctionRegistry '
            'is configured on this RendererMessageRouter.',
          );
        }
        final AgentFunctionResponseMessage response = await registry.handle(
          message,
        );
        return <AgentToRendererMessage>[response];
      case _RouteKind.rendererFunctionResponse:
        final RendererFunctionCalls? calls = rendererCalls;
        if (calls == null) {
          throw StateError(
            'Received rendererFunctionResponse message, but no '
            'RendererFunctionCalls is configured on this '
            'RendererMessageRouter.',
          );
        }
        calls.resolve(message);
        return const <AgentToRendererMessage>[];
      case _RouteKind.none:
        return const <AgentToRendererMessage>[];
    }
  }

  static _RouteKind _classify(Object? message) {
    if (message is CallAgentFunctionMessage) {
      return _RouteKind.callAgentFunction;
    }
    if (message is RendererFunctionResponseMessage) {
      return _RouteKind.rendererFunctionResponse;
    }
    if (message is! Map) return _RouteKind.none;
    if (message.length != 2 || !message.containsKey('version')) {
      return _RouteKind.none;
    }
    final Object? version = message['version'];
    if (version != '1.0' && version != 'v1.0') {
      return _RouteKind.none;
    }
    if (message['callAgentFunction'] is Map) {
      return _RouteKind.callAgentFunction;
    }
    if (message['rendererFunctionResponse'] is Map) {
      return _RouteKind.rendererFunctionResponse;
    }
    return _RouteKind.none;
  }
}

enum _RouteKind { callAgentFunction, rendererFunctionResponse, none }

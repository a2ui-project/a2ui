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

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';

/// Validates a raw renderer-to-agent message against the versioned wire schema.
///
/// Throws [A2uiValidationError] when [data] is not a JSON object map, violates
/// the envelope structure, mismatches [version], or fails schema validation.
RendererToAgentMessage parseInboundMessage(
  Object? data, [
  A2uiProtocolVersion version = A2uiProtocolVersion.v1_0,
]) {
  if (data is! Map) {
    throw A2uiValidationError(
      'Inbound renderer message must be a JSON object map.',
    );
  }
  final envelope = <String, Object?>{};
  for (final MapEntry<Object?, Object?> entry in data.entries) {
    if (entry.key is! String) {
      throw A2uiValidationError(
        'Inbound renderer message keys must be strings.',
      );
    }
    envelope[entry.key as String] = entry.value;
  }

  return RendererToAgentMessage.parseAll([
    envelope,
  ], protocolVersion: version).messages.single;
}

/// Returns the discriminated kind of a validated [RendererToAgentMessage].
String getInboundMessageKind(RendererToAgentMessage message) {
  if (message is ActionMessage) {
    return 'action';
  }
  if (message is ErrorMessage) {
    return 'error';
  }
  if (message is CallAgentFunctionMessage) {
    return 'callAgentFunction';
  }
  if (message is RendererFunctionResponseMessage) {
    return 'rendererFunctionResponse';
  }
  throw A2uiValidationError(
    'Unrecognized inbound message type: ${message.runtimeType}.',
  );
}

/// Formats an inbound [ActionMessage] or [ErrorMessage] for LLM context input.
///
/// Returns `null` for RPC messages ([CallAgentFunctionMessage] and
/// [RendererFunctionResponseMessage]) handled by the orchestration layer.
String? formatInboundForModel(RendererToAgentMessage message) {
  if (message is ActionMessage) {
    final A2uiRendererAction action = message.action;
    return "User triggered action '${action.name}' on surface "
        "'${action.surfaceId}' (component '${action.sourceComponentId}') "
        'with context: ${jsonEncode(action.context)}';
  }

  if (message is ErrorMessage) {
    final A2uiRendererError error = message.error;
    if (error.path != null && error.surfaceId != null) {
      return "Renderer reported error '${error.code}' on surface "
          "'${error.surfaceId}' at path '${error.path}': ${error.message}";
    }
    if (error.surfaceId != null) {
      return "Renderer reported error '${error.code}' on surface "
          "'${error.surfaceId}': ${error.message}";
    }
    if (error.functionCallId != null) {
      return "Renderer reported error '${error.code}' for function call "
          "'${error.functionCallId}': ${error.message}";
    }
    return 'Renderer reported error: ${jsonEncode(error.toJson())}';
  }

  if (message is CallAgentFunctionMessage ||
      message is RendererFunctionResponseMessage) {
    return null;
  }

  throw A2uiValidationError(
    'Unrecognized inbound message type: ${message.runtimeType}.',
  );
}

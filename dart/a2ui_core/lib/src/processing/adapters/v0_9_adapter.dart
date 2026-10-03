// Copyright 2026 Google LLC
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

import '../../core/messages.dart';
import '../../primitives/protocol_version.dart';
import '../operations.dart';
import 'version_adapter.dart';

/// The [VersionAdapter] for protocol v0.9, which also serves the
/// wire-compatible v0.9.1.
///
/// v0.9 defines `createSurface` (with a required `catalogId` and an optional
/// `theme`), `updateComponents`, `updateDataModel` and `deleteSurface`. It
/// rejects the v1.0 function-call messages.
///
/// Outbound bindings and function calls use the legacy `path` and `call` keys.
// Named for the protocol release it serves, as in the other SDKs.
// ignore: camel_case_types
class V0_9Adapter extends VersionAdapter {
  const V0_9Adapter();

  @override
  A2uiProtocolVersion get version => A2uiProtocolVersion.v0_9;

  @override
  Set<A2uiProtocolVersion> get versions => const {
        A2uiProtocolVersion.v0_9,
        A2uiProtocolVersion.v0_9_1,
      };

  @override
  List<InternalOperation> operationsFor(AgentToRendererMessage message) {
    final A2uiProtocolVersion declared = servedVersionOf(message);
    return switch (message) {
      CreateSurfaceMessage() => [
          CreateSurfaceOp(
            version: declared,
            surfaceId: message.surfaceId,
            catalogId: message.catalogId,
            theme: message.theme,
            sendDataModel: message.sendDataModel,
          ),
        ],
      UpdateComponentsMessage() => [
          UpdateComponentsOp(
            version: declared,
            surfaceId: message.surfaceId,
            components: [
              for (final Map<String, dynamic> c in message.components)
                c.cast<String, Object?>(),
            ],
          ),
        ],
      UpdateDataModelMessage() => [
          UpdateDataModelOp(
            version: declared,
            surfaceId: message.surfaceId,
            path: message.path,
            value: message.value,
          ),
        ],
      DeleteSurfaceMessage() => [
          DeleteSurfaceOp(version: declared, surfaceId: message.surfaceId),
        ],
      CallRendererFunctionMessage() => rejectMessage('callRendererFunction'),
      AgentFunctionResponseMessage() => rejectMessage('agentFunctionResponse'),
      _ => rejectMessage(message.runtimeType.toString()),
    };
  }

  @override
  Map<String, Object?> fromRendererMessage(RendererToAgentMessage message) {
    checkServes(A2uiProtocolVersion.fromJson(message.version));
    return switch (message) {
      ActionMessage() || ErrorMessage() => message.toJson(),
      CallAgentFunctionMessage() => rejectMessage('callAgentFunction'),
      RendererFunctionResponseMessage() =>
        rejectMessage('rendererFunctionResponse'),
      _ => rejectMessage(message.runtimeType.toString()),
    };
  }
}

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

/// The [VersionAdapter] for protocol v1.0.
///
/// v1.0 adds inline `components`, `dataModel` and `metadata` to
/// `createSurface`, makes its `catalogId` optional, drops `theme`, and adds
/// the `callRendererFunction` and `agentFunctionResponse` messages.
///
/// Outbound bindings and function calls use the reserved `@path` and `@call`
/// keys.
// Named for the protocol release it serves, as in the other SDKs.
// ignore: camel_case_types
class V1_0Adapter extends VersionAdapter {
  const V1_0Adapter();

  @override
  A2uiProtocolVersion get version => A2uiProtocolVersion.v1_0;

  @override
  List<InternalOperation> operationsFor(AgentToRendererMessage message) {
    final A2uiProtocolVersion declared = servedVersionOf(message);
    return switch (message) {
      CreateSurfaceMessage() => [
          CreateSurfaceOp(
            version: declared,
            surfaceId: message.surfaceId,
            catalogId: message.catalogId,
            sendDataModel: message.sendDataModel,
            components: message.components,
            dataModel: message.dataModel,
            metadata: message.metadata,
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
      CallRendererFunctionMessage() => [
          CallRendererFunctionOp(
            version: declared,
            functionCallId: message.functionCallId,
            callFunction: message.callFunction,
          ),
        ],
      AgentFunctionResponseMessage() => [
          AgentFunctionResponseOp(
            version: declared,
            response: message.response,
          ),
        ],
      _ => rejectMessage(message.runtimeType.toString()),
    };
  }

  @override
  Map<String, Object?> fromRendererMessage(RendererToAgentMessage message) {
    checkServes(A2uiProtocolVersion.fromJson(message.version));
    return message.toJson();
  }
}

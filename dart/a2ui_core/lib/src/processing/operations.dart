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

import '../core/messages.dart';
import '../primitives/protocol_version.dart';

/// One version-independent step a `MessageProcessor` applies to its state.
///
/// A `VersionAdapter` turns each agent-to-renderer message of the versions it
/// serves into operations, so the processor executes one vocabulary whatever
/// version the agent speaks. Each operation records the [version] of the
/// message it came from, which is what lets one processor hold surfaces of
/// different versions side by side.
///
/// The set is sealed: a processor handles every kind, and an adapter for a
/// new version maps its messages onto these rather than adding kinds.
sealed class InternalOperation {
  const InternalOperation({required this.version});

  /// The protocol version of the message this operation came from.
  final A2uiProtocolVersion version;

  /// The wire name of the message this operation came from, such as
  /// `createSurface`, as `ValidationConfig.allowedMessages` lists it.
  String get messageType;
}

/// Creates a surface, optionally with its initial data model, components and
/// metadata, which from v1.0 may arrive inline.
final class CreateSurfaceOp extends InternalOperation {
  const CreateSurfaceOp({
    required super.version,
    required this.surfaceId,
    this.catalogId,
    this.theme,
    this.sendDataModel = false,
    this.components,
    this.dataModel,
    this.metadata,
  });

  final String surfaceId;

  /// The surface's default catalog, or null when the message names none.
  final String? catalogId;

  /// The surface theme. Defined before v1.0 only.
  final Map<String, Object?>? theme;

  final bool sendDataModel;

  /// The surface's initial components. Defined from v1.0 only.
  final List<Map<String, Object?>>? components;

  /// The surface's initial root data model. Defined from v1.0 only.
  final Map<String, Object?>? dataModel;

  /// Surface-level metadata. Defined from v1.0 only.
  final Map<String, Object?>? metadata;

  @override
  String get messageType => 'createSurface';
}

/// Adds or replaces components on an existing surface.
final class UpdateComponentsOp extends InternalOperation {
  const UpdateComponentsOp({
    required super.version,
    required this.surfaceId,
    required this.components,
  });

  final String surfaceId;
  final List<Map<String, Object?>> components;

  @override
  String get messageType => 'updateComponents';
}

/// Writes [value] at [path] in a surface's data model; a null [value] deletes
/// it.
final class UpdateDataModelOp extends InternalOperation {
  const UpdateDataModelOp({
    required super.version,
    required this.surfaceId,
    this.path,
    this.value,
  });

  final String surfaceId;

  /// The JSON Pointer to write at, or null for the root.
  final String? path;
  final Object? value;

  @override
  String get messageType => 'updateDataModel';
}

/// Removes a surface.
final class DeleteSurfaceOp extends InternalOperation {
  const DeleteSurfaceOp({required super.version, required this.surfaceId});

  final String surfaceId;

  @override
  String get messageType => 'deleteSurface';
}

/// Asks the renderer to run a function on the agent's behalf. Defined from
/// v1.0 only.
final class CallRendererFunctionOp extends InternalOperation {
  const CallRendererFunctionOp({
    required super.version,
    required this.functionCallId,
    required this.callFunction,
  });

  final String functionCallId;

  /// The function call, in the wire form of [version].
  final Map<String, Object?> callFunction;

  @override
  String get messageType => 'callRendererFunction';
}

/// Answers a function call the renderer made to the agent. Defined from v1.0
/// only.
final class AgentFunctionResponseOp extends InternalOperation {
  const AgentFunctionResponseOp({
    required super.version,
    required this.response,
  });

  final A2uiFunctionResponse response;

  @override
  String get messageType => 'agentFunctionResponse';
}

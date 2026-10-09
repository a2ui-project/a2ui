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

/// Version-neutral operation vocabulary consumed by ``MessageProcessor``.
///
/// Produced exclusively by ``VersionAdapter`` implementations so downstream state
/// mutation and RPC routing remain agnostic of wire protocol syntax differences.
public enum InternalOperation: Sendable, Equatable {
  case createSurface(InternalCreateSurfaceOp)
  case updateComponents(InternalUpdateComponentsOp)
  case updateDataModel(InternalUpdateDataModelOp)
  case deleteSurface(InternalDeleteSurfaceOp)
  case callRendererFunction(InternalCallRendererFunctionOp)
  case agentFunctionResponse(InternalAgentFunctionResponseOp)

  /// All valid operation discriminator names.
  public static let allOperationTypes: [String] = [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callRendererFunction",
    "agentFunctionResponse",
  ]

  /// The canonical operation discriminator string.
  public var type: String {
    switch self {
    case .createSurface:
      return "createSurface"
    case .updateComponents:
      return "updateComponents"
    case .updateDataModel:
      return "updateDataModel"
    case .deleteSurface:
      return "deleteSurface"
    case .callRendererFunction:
      return "callRendererFunction"
    case .agentFunctionResponse:
      return "agentFunctionResponse"
    }
  }

  /// The target surface ID for this operation, if applicable.
  public var surfaceID: String? {
    switch self {
    case .createSurface(let op):
      return op.surfaceID
    case .updateComponents(let op):
      return op.surfaceID
    case .updateDataModel(let op):
      return op.surfaceID
    case .deleteSurface(let op):
      return op.surfaceID
    case .callRendererFunction:
      return nil
    case .agentFunctionResponse:
      return nil
    }
  }
}

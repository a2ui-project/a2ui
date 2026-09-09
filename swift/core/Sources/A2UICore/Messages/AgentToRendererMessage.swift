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

import Foundation

/// A container message enclosing one of the supported incoming agent-to-renderer commands.
///
/// Matches `specification/v1_0/json/agent_to_renderer.json`.
public enum AgentToRendererMessage: Codable, Sendable, Equatable {
  case createSurface(CreateSurfaceMessage)
  case updateComponents(UpdateComponentsMessage)
  case updateDataModel(UpdateDataModelMessage)
  case deleteSurface(DeleteSurfaceMessage)
  case callRendererFunction(CallRendererFunctionMessage)
  case agentFunctionResponse(AgentFunctionResponseMessage)

  private enum CodingKeys: String, CodingKey {
    case version
    case createSurface
    case updateComponents
    case updateDataModel
    case deleteSurface
    case callRendererFunction
    case agentFunctionResponse
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(String.self, forKey: .version)
    guard version == "v0.9" || version == "v0.9.1" || version == "v1.0" else {
      throw DecodingError.dataCorruptedError(
        forKey: .version,
        in: container,
        debugDescription: "Unsupported version: \(version)"
      )
    }

    let actionKeys = container.allKeys.filter { $0 != .version }
    guard actionKeys.count == 1, let actionKey = actionKeys.first else {
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription:
          "AgentToRendererMessage must contain exactly one action, found \(actionKeys.count)"
      )
      throw DecodingError.dataCorrupted(context)
    }

    switch actionKey {
    case .createSurface:
      self = .createSurface(try container.decode(CreateSurfaceMessage.self, forKey: .createSurface))
    case .updateComponents:
      self = .updateComponents(
        try container.decode(UpdateComponentsMessage.self, forKey: .updateComponents))
    case .updateDataModel:
      self = .updateDataModel(
        try container.decode(UpdateDataModelMessage.self, forKey: .updateDataModel))
    case .deleteSurface:
      self = .deleteSurface(try container.decode(DeleteSurfaceMessage.self, forKey: .deleteSurface))
    case .callRendererFunction:
      self = .callRendererFunction(
        try container.decode(CallRendererFunctionMessage.self, forKey: .callRendererFunction))
    case .agentFunctionResponse:
      self = .agentFunctionResponse(
        try container.decode(AgentFunctionResponseMessage.self, forKey: .agentFunctionResponse))
    case .version:
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription: "Internal error: version key was not filtered out"
      )
      throw DecodingError.dataCorrupted(context)
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("v1.0", forKey: .version)
    switch self {
    case .createSurface(let message):
      try container.encode(message, forKey: .createSurface)
    case .updateComponents(let message):
      try container.encode(message, forKey: .updateComponents)
    case .updateDataModel(let message):
      try container.encode(message, forKey: .updateDataModel)
    case .deleteSurface(let message):
      try container.encode(message, forKey: .deleteSurface)
    case .callRendererFunction(let message):
      try container.encode(message, forKey: .callRendererFunction)
    case .agentFunctionResponse(let message):
      try container.encode(message, forKey: .agentFunctionResponse)
    }
  }

  /// The surface ID targeted by this message, if applicable.
  public var surfaceID: String? {
    switch self {
    case .createSurface(let message):
      return message.surfaceID
    case .updateComponents(let message):
      return message.surfaceID
    case .updateDataModel(let message):
      return message.surfaceID
    case .deleteSurface(let message):
      return message.surfaceID
    case .callRendererFunction:
      return nil
    case .agentFunctionResponse:
      return nil
    }
  }
}

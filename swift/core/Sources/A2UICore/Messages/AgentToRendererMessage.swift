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
import OrderedJSON

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

  /// Validates and parses a raw `JSONValue` envelope (single message object, array of messages,
  /// or `{"messages": [...]}` wrapper) into an array of ``AgentToRendererMessage`` values without
  /// requiring a ``Catalog`` or ``MessageProcessor``.
  ///
  /// - Parameters:
  ///   - payload: The raw JSON payload to validate and parse.
  ///   - protocolVersion: Optional explicit protocol version to enforce. When `nil`, the version
  ///     is resolved from the payload's `"version"` field.
  /// - Returns: The parsed array of ``AgentToRendererMessage`` instances.
  /// - Throws: ``A2UIValidationError`` (or its subclasses) if the envelope is invalid.
  public static func parseAll(
    _ payload: JSONValue,
    protocolVersion: A2UIProtocolVersion? = nil
  ) throws -> [AgentToRendererMessage] {
    if case .null = payload {
      return []
    }

    let adapter: any VersionAdapter
    if let protocolVersion {
      adapter = VersionAdapterFactory.getAdapter(for: protocolVersion)
    } else {
      adapter = try VersionAdapterFactory.resolveFromPayload(payload)
    }

    _ = try adapter.extractOperations(from: payload)

    let items: [JSONValue]
    switch payload {
    case .array(let array):
      items = array
    case .object(let dict):
      if let messages = dict["messages"]?.arrayValue {
        items = messages
      } else {
        items = [payload]
      }
    default:
      items = []
    }

    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    return try items.map { item in
      let data = try encoder.encode(item)
      do {
        return try decoder.decode(AgentToRendererMessage.self, from: data)
      } catch let error as A2UIValidationError {
        throw error
      } catch {
        throw A2UIValidationError(error.localizedDescription)
      }
    }
  }

  /// Validates and parses raw UTF-8 JSON `Data` into an array of ``AgentToRendererMessage``
  /// values without requiring a ``Catalog`` or ``MessageProcessor``.
  public static func parseAll(
    from data: Data,
    protocolVersion: A2UIProtocolVersion? = nil
  ) throws -> [AgentToRendererMessage] {
    let payload: JSONValue
    do {
      payload = try JSONDecoder().decode(JSONValue.self, from: data)
    } catch {
      throw A2UIValidationError(error.localizedDescription)
    }
    return try parseAll(payload, protocolVersion: protocolVersion)
  }

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
    let version = try container.decode(A2UIProtocolVersion.self, forKey: .version)

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
      let message = try CreateSurfaceMessage(
        from: container.superDecoder(forKey: .createSurface),
        version: version
      )
      if version.isAtLeastV10, message.theme != nil {
        throw DecodingError.dataCorruptedError(
          forKey: .createSurface,
          in: container,
          debugDescription: "Property 'theme' is not allowed in \(version.rawValue) createSurface"
        )
      }
      if version.isV09Family {
        if message.metadata != nil {
          throw DecodingError.dataCorruptedError(
            forKey: .createSurface,
            in: container,
            debugDescription: "Property 'metadata' requires protocol version v1.0"
          )
        }
        if message.components != nil || message.dataModel != nil {
          throw DecodingError.dataCorruptedError(
            forKey: .createSurface,
            in: container,
            debugDescription: "Inline 'components' and 'dataModel' require protocol version v1.0"
          )
        }
      }
      self = .createSurface(message)
    case .updateComponents:
      self = .updateComponents(
        try UpdateComponentsMessage(
          from: container.superDecoder(forKey: .updateComponents),
          version: version
        )
      )
    case .updateDataModel:
      self = .updateDataModel(
        try UpdateDataModelMessage(
          from: container.superDecoder(forKey: .updateDataModel),
          version: version
        )
      )
    case .deleteSurface:
      self = .deleteSurface(
        try DeleteSurfaceMessage(
          from: container.superDecoder(forKey: .deleteSurface),
          version: version
        )
      )
    case .callRendererFunction:
      guard version.isAtLeastV10 else {
        throw DecodingError.dataCorruptedError(
          forKey: .callRendererFunction,
          in: container,
          debugDescription: "'callRendererFunction' requires protocol version v1.0"
        )
      }
      self = .callRendererFunction(
        try CallRendererFunctionMessage(
          from: container.superDecoder(forKey: .callRendererFunction),
          version: version
        )
      )
    case .agentFunctionResponse:
      guard version.isAtLeastV10 else {
        throw DecodingError.dataCorruptedError(
          forKey: .agentFunctionResponse,
          in: container,
          debugDescription: "'agentFunctionResponse' requires protocol version v1.0"
        )
      }
      self = .agentFunctionResponse(
        try AgentFunctionResponseMessage(
          from: container.superDecoder(forKey: .agentFunctionResponse),
          version: version
        )
      )
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
    let targetVersion =
      (encoder.userInfo[.a2uiProtocolVersion] as? A2UIProtocolVersion) ?? self.version
    try container.encode(targetVersion, forKey: .version)
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

  private var versionedPayload: any ProtocolVersioned {
    switch self {
    case .createSurface(let payload): return payload
    case .updateComponents(let payload): return payload
    case .updateDataModel(let payload): return payload
    case .deleteSurface(let payload): return payload
    case .callRendererFunction(let payload): return payload
    case .agentFunctionResponse(let payload): return payload
    }
  }

  /// The protocol version associated with this wire message.
  public var version: A2UIProtocolVersion {
    versionedPayload.version
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

// MARK: - Deprecated Typealiases

@available(*, deprecated, renamed: "AgentToRendererMessage")
public typealias ServerToClientMessage = AgentToRendererMessage

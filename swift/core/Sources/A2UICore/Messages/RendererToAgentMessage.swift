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

/// Top-level envelope for renderer-to-agent messages (actions, RPC, responses, or errors).
///
/// Matches `specification/v1_0/json/renderer_to_agent.json`.
public enum RendererToAgentMessage: Equatable, Codable, Sendable {
  case action(RendererAction)
  case callAgentFunction(CallAgentFunctionMessage)
  case rendererFunctionResponse(RendererFunctionResponseMessage)
  case error(RendererError)

  private enum CodingKeys: String, CodingKey {
    case version
    case action
    case callAgentFunction
    case rendererFunctionResponse
    case error
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(A2UIProtocolVersion.self, forKey: .version)

    let payloadKeys = container.allKeys.filter { $0 != .version }
    guard payloadKeys.count == 1, let payloadKey = payloadKeys.first else {
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription:
          "RendererToAgentMessage must contain exactly one payload, found \(payloadKeys.count)"
      )
      throw DecodingError.dataCorrupted(context)
    }

    switch payloadKey {
    case .action:
      self = .action(
        try RendererAction(from: container.superDecoder(forKey: .action), version: version)
      )
    case .callAgentFunction:
      guard version.isAtLeastV10 else {
        throw DecodingError.dataCorruptedError(
          forKey: .callAgentFunction,
          in: container,
          debugDescription: "'callAgentFunction' requires protocol version v1.0"
        )
      }
      self = .callAgentFunction(
        try CallAgentFunctionMessage(
          from: container.superDecoder(forKey: .callAgentFunction),
          version: version
        )
      )
    case .rendererFunctionResponse:
      guard version.isAtLeastV10 else {
        throw DecodingError.dataCorruptedError(
          forKey: .rendererFunctionResponse,
          in: container,
          debugDescription: "'rendererFunctionResponse' requires protocol version v1.0"
        )
      }
      self = .rendererFunctionResponse(
        try RendererFunctionResponseMessage(
          from: container.superDecoder(forKey: .rendererFunctionResponse),
          version: version
        )
      )
    case .error:
      self = .error(
        try RendererError(from: container.superDecoder(forKey: .error), version: version)
      )
    case .version:
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription: "Internal error: version key was not filtered out"
      )
      throw DecodingError.dataCorrupted(context)
    }
  }

  private var versionedPayload: any ProtocolVersioned {
    switch self {
    case .action(let payload): return payload
    case .callAgentFunction(let payload): return payload
    case .rendererFunctionResponse(let payload): return payload
    case .error(let payload): return payload
    }
  }

  /// The protocol version associated with this wire message.
  public var version: A2UIProtocolVersion {
    versionedPayload.version
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    let targetVersion =
      (encoder.userInfo[.a2uiProtocolVersion] as? A2UIProtocolVersion) ?? self.version
    try container.encode(targetVersion, forKey: .version)

    switch self {
    case .action(let action):
      try container.encode(action, forKey: .action)
    case .callAgentFunction(let call):
      try container.encode(call, forKey: .callAgentFunction)
    case .rendererFunctionResponse(let response):
      try container.encode(response, forKey: .rendererFunctionResponse)
    case .error(let error):
      try container.encode(error, forKey: .error)
    }
  }
}

// MARK: - Deprecated Typealiases

@available(*, deprecated, renamed: "RendererToAgentMessage")
public typealias ClientToServerMessage = RendererToAgentMessage

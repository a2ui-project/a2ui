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
    _ = try container.decode(A2UIProtocolVersion.self, forKey: .version)

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
      self = .action(try container.decode(RendererAction.self, forKey: .action))
    case .callAgentFunction:
      self = .callAgentFunction(
        try container.decode(CallAgentFunctionMessage.self, forKey: .callAgentFunction))
    case .rendererFunctionResponse:
      self = .rendererFunctionResponse(
        try container.decode(
          RendererFunctionResponseMessage.self, forKey: .rendererFunctionResponse))
    case .error:
      self = .error(try container.decode(RendererError.self, forKey: .error))
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
    try container.encode(A2UIProtocolVersion.default, forKey: .version)

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

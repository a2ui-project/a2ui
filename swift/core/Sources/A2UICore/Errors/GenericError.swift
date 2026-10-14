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

/// Represents a generic processing or runtime error.
public struct GenericError: Error, Equatable, Codable, Sendable, ProtocolVersioned {
  public let code: String
  /// Stored as a sum type so a value with both or neither ID cannot be represented.
  private let target: Target
  public let message: String
  /// The expression that failed, e.g. the function name of an `EXPRESSION_ERROR`.
  public let expression: String?
  public var version: A2UIProtocolVersion

  public var surfaceID: String? {
    if case .surface(let id) = target { return id }
    return nil
  }

  public var functionCallID: String? {
    if case .functionCall(let id) = target { return id }
    return nil
  }

  /// The entity this error refers to: exactly one surface or one function call.
  private enum Target: Equatable, Sendable {
    case surface(String)
    case functionCall(String)
  }

  private enum CodingKeys: String, CodingKey {
    case code
    case surfaceID = "surfaceId"
    case functionCallID = "functionCallId"
    case message
    case expression
  }

  public init(
    code: String,
    surfaceID: String,
    message: String,
    expression: String? = nil,
    version: A2UIProtocolVersion
  ) {
    self.code = code
    self.target = .surface(surfaceID)
    self.message = message
    self.expression = expression
    self.version = version
  }

  public init(
    code: String,
    functionCallID: String,
    message: String,
    expression: String? = nil,
    version: A2UIProtocolVersion
  ) {
    self.code = code
    self.target = .functionCall(functionCallID)
    self.message = message
    self.expression = expression
    self.version = version
  }

  public init(from decoder: Decoder, version: A2UIProtocolVersion) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    code = try container.decode(String.self, forKey: .code)
    let surfaceID = try container.decodeIfPresent(String.self, forKey: .surfaceID)
    let functionCallID = try container.decodeIfPresent(String.self, forKey: .functionCallID)
    message = try container.decode(String.self, forKey: .message)
    expression = try container.decodeIfPresent(String.self, forKey: .expression)
    self.version = version

    switch (surfaceID, functionCallID) {
    case (let surfaceID?, nil):
      target = .surface(surfaceID)
    case (nil, let functionCallID?):
      target = .functionCall(functionCallID)
    default:
      throw DecodingError.dataCorrupted(
        DecodingError.Context(
          codingPath: decoder.codingPath,
          debugDescription:
            "GenericError must specify either surfaceId or functionCallId, not both or neither."
        )
      )
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(code, forKey: .code)
    switch target {
    case .surface(let surfaceID):
      try container.encode(surfaceID, forKey: .surfaceID)
    case .functionCall(let functionCallID):
      try container.encode(functionCallID, forKey: .functionCallID)
    }
    try container.encode(message, forKey: .message)
    try container.encodeIfPresent(expression, forKey: .expression)
  }
}

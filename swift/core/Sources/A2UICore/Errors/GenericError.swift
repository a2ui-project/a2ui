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
public struct GenericError: Error, Equatable, Codable, Sendable {
  public let code: String
  public let surfaceID: String?
  public let functionCallID: String?
  public let message: String

  private enum CodingKeys: String, CodingKey {
    case code
    case surfaceID = "surfaceId"
    case functionCallID = "functionCallId"
    case message
  }

  public init(code: String, surfaceID: String, message: String) {
    self.code = code
    self.surfaceID = surfaceID
    self.functionCallID = nil
    self.message = message
  }

  public init(code: String, functionCallID: String, message: String) {
    self.code = code
    self.surfaceID = nil
    self.functionCallID = functionCallID
    self.message = message
  }

  public init(
    code: String,
    surfaceID: String? = nil,
    functionCallID: String? = nil,
    message: String
  ) {
    self.code = code
    self.surfaceID = surfaceID
    self.functionCallID = functionCallID
    self.message = message
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    code = try container.decode(String.self, forKey: .code)
    surfaceID = try container.decodeIfPresent(String.self, forKey: .surfaceID)
    functionCallID = try container.decodeIfPresent(String.self, forKey: .functionCallID)
    message = try container.decode(String.self, forKey: .message)

    let hasSurface = surfaceID != nil
    let hasFunctionCall = functionCallID != nil
    if (!hasSurface && !hasFunctionCall) || (hasSurface && hasFunctionCall) {
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
    try container.encodeIfPresent(surfaceID, forKey: .surfaceID)
    try container.encodeIfPresent(functionCallID, forKey: .functionCallID)
    try container.encode(message, forKey: .message)
  }
}

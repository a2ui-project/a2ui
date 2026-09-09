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

/// Response returned by the agent for a function invocation requested by the renderer.
public struct AgentFunctionResponseMessage: Codable, Sendable, Equatable {
  public let functionCallID: String
  public let value: JSONValue?
  public let error: FunctionErrorPayload?

  private enum CodingKeys: String, CodingKey {
    case functionCallID = "functionCallId"
    case value
    case error
  }

  public init(functionCallID: String, value: JSONValue) {
    self.functionCallID = functionCallID
    self.value = value
    self.error = nil
  }

  public init(functionCallID: String, error: FunctionErrorPayload) {
    self.functionCallID = functionCallID
    self.value = nil
    self.error = error
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    functionCallID = try container.decode(String.self, forKey: .functionCallID)
    let hasError = container.contains(.error)
    let hasValue = container.contains(.value)
    if hasError && hasValue {
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription: "FunctionResponse cannot contain both 'value' and 'error'"
      )
      throw DecodingError.dataCorrupted(context)
    }
    if hasError {
      error = try container.decode(FunctionErrorPayload.self, forKey: .error)
      value = nil
    } else if hasValue {
      value = try container.decode(JSONValue.self, forKey: .value)
      error = nil
    } else {
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription: "FunctionResponse must contain either 'value' or 'error'"
      )
      throw DecodingError.dataCorrupted(context)
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(functionCallID, forKey: .functionCallID)
    if let error {
      try container.encode(error, forKey: .error)
    } else if let value {
      try container.encode(value, forKey: .value)
    }
  }
}

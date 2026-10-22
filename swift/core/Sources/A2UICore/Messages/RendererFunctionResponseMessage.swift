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

/// Response returned by the renderer for a function invocation requested by the agent.
public struct RendererFunctionResponseMessage: Codable, Sendable, Equatable, ProtocolVersioned {
  public let functionCallID: String
  /// Stored as a sum type so a value with both or neither of `value` and `error` cannot be
  /// represented.
  private let outcome: Outcome
  public var version: A2UIProtocolVersion

  public var value: JSONValue? {
    if case .value(let value) = outcome { return value }
    return nil
  }

  public var error: FunctionErrorPayload? {
    if case .error(let error) = outcome { return error }
    return nil
  }

  /// The result of the function call: exactly one value or one error.
  private enum Outcome: Equatable, Sendable {
    case value(JSONValue)
    case error(FunctionErrorPayload)
  }

  private enum CodingKeys: String, CodingKey {
    case functionCallID = "functionCallId"
    case value
    case error
  }

  public init(
    functionCallID: String,
    value: JSONValue,
    version: A2UIProtocolVersion
  ) {
    self.functionCallID = functionCallID
    self.outcome = .value(value)
    self.version = version
  }

  public init(
    functionCallID: String,
    error: FunctionErrorPayload,
    version: A2UIProtocolVersion
  ) {
    self.functionCallID = functionCallID
    self.outcome = .error(error)
    self.version = version
  }

  public init(from decoder: Decoder, version: A2UIProtocolVersion) throws {
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
      outcome = .error(try container.decode(FunctionErrorPayload.self, forKey: .error))
    } else if hasValue {
      outcome = .value(try container.decode(JSONValue.self, forKey: .value))
    } else {
      let context = DecodingError.Context(
        codingPath: container.codingPath,
        debugDescription: "FunctionResponse must contain either 'value' or 'error'"
      )
      throw DecodingError.dataCorrupted(context)
    }
    self.version = version
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(functionCallID, forKey: .functionCallID)
    switch outcome {
    case .error(let error):
      try container.encode(error, forKey: .error)
    case .value(let value):
      try container.encode(value, forKey: .value)
    }
  }
}

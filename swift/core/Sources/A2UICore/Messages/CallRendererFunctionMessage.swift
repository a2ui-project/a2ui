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

/// A message commanding the renderer to execute a function locally on behalf of the agent.
public struct CallRendererFunctionMessage: Codable, Sendable, Equatable, ProtocolVersioned {
  public let surfaceID: String?
  public let functionCallID: String
  public let callFunction: CallFunctionPayload
  public var version: A2UIProtocolVersion

  private enum CodingKeys: String, CodingKey {
    case surfaceID = "surfaceId"
    case functionCallID = "functionCallId"
    case callFunction
  }

  public init(
    surfaceID: String? = nil,
    functionCallID: String,
    callFunction: CallFunctionPayload,
    version: A2UIProtocolVersion
  ) {
    self.surfaceID = surfaceID
    self.functionCallID = functionCallID
    self.callFunction = callFunction
    self.version = version
  }

  public init(from decoder: Decoder, version: A2UIProtocolVersion) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    surfaceID = try container.decodeIfPresent(String.self, forKey: .surfaceID)
    functionCallID = try container.decode(String.self, forKey: .functionCallID)
    callFunction = try container.decode(CallFunctionPayload.self, forKey: .callFunction)
    self.version = version
  }
}

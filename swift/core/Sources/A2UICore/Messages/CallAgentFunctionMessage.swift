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

/// Signals the agent to execute a function remotely on behalf of the renderer.
public struct CallAgentFunctionMessage: Codable, Sendable, Equatable {
  public let surfaceID: String
  public let functionCallID: String
  public let callFunction: CallFunctionPayload

  private enum CodingKeys: String, CodingKey {
    case surfaceID = "surfaceId"
    case functionCallID = "functionCallId"
    case callFunction
  }

  public init(
    surfaceID: String,
    functionCallID: String,
    callFunction: CallFunctionPayload
  ) {
    self.surfaceID = surfaceID
    self.functionCallID = functionCallID
    self.callFunction = callFunction
  }
}

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

import OrderedJSON

/// Version-neutral internal operation representing a response from an agent function call.
public struct InternalAgentFunctionResponseOp: Sendable, Equatable {
  public let functionCallID: String
  public let version: A2UIProtocolVersion
  public let value: JSONValue?
  public let error: FunctionErrorPayload?

  /// Blueprint-compatible camelCase alias for `functionCallID`.
  public var functionCallId: String { functionCallID }

  public init(
    functionCallID: String,
    version: A2UIProtocolVersion,
    value: JSONValue? = nil,
    error: FunctionErrorPayload? = nil
  ) {
    self.functionCallID = functionCallID
    self.version = version
    self.value = value
    self.error = error
  }
}

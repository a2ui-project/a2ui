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

/// Version-neutral internal operation for invoking a renderer-side function.
public struct InternalCallRendererFunctionOp: Sendable, Equatable {
  public let functionCallID: String
  public let call: String
  public let version: A2UIProtocolVersion
  public let catalogID: String?
  public let args: [String: JSONValue]?
  public let returnType: String?
  public let isUserActivated: Bool

  /// Blueprint-compatible camelCase alias for `functionCallID`.
  public var functionCallId: String { functionCallID }

  /// Blueprint-compatible camelCase alias for `catalogID`.
  public var catalogId: String? { catalogID }

  public init(
    functionCallID: String,
    call: String,
    version: A2UIProtocolVersion,
    catalogID: String? = nil,
    args: [String: JSONValue]? = nil,
    returnType: String? = nil,
    isUserActivated: Bool = false
  ) {
    self.functionCallID = functionCallID
    self.call = call
    self.version = version
    self.catalogID = catalogID
    self.args = args
    self.returnType = returnType
    self.isUserActivated = isUserActivated
  }
}

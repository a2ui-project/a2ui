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

/// Represents an error returned by a function invocation.
public struct FunctionErrorPayload: Codable, Sendable, Equatable {
  /// Known standard machine-readable error codes for function errors.
  public enum Code: String, Codable, Sendable, CaseIterable {
    case invalidFunctionCall = "INVALID_FUNCTION_CALL"
    case executionError = "EXECUTION_ERROR"
    case timeout = "TIMEOUT"
    case unknownFunction = "UNKNOWN_FUNCTION"
  }

  public let code: String
  public let message: String

  /// The strongly typed standard error code, or nil if a custom error code was provided.
  public var structuredCode: Code? {
    Code(rawValue: code)
  }

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }

  public init(code: Code, message: String) {
    self.code = code.rawValue
    self.message = message
  }
}

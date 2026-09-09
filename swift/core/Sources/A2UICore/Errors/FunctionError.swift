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

/// Errors that occur during local or remote function evaluation.
public enum FunctionError: Error, Sendable, Equatable, CustomStringConvertible, LocalizedError {
  case functionNotFound(String)
  case missingArgument(String)
  case invalidArgumentType(expected: String, actual: String)
  case securityConstraintViolation(String)
  case executionFailed(name: String, message: String)
  case timeout(callID: String)
  case callerDisallowed(name: String, caller: String)
  case remoteError(code: String, message: String)

  public var description: String {
    switch self {
    case .functionNotFound(let name):
      return "Function not found: \(name)"
    case .missingArgument(let arg):
      return "Missing argument: \(arg)"
    case .invalidArgumentType(let expected, let actual):
      return "Invalid argument type: expected \(expected), actual \(actual)"
    case .securityConstraintViolation(let message):
      return "Security constraint violation: \(message)"
    case .executionFailed(let name, let message):
      return "Execution failed for \(name): \(message)"
    case .timeout(let callID):
      return "Function call timed out: \(callID)"
    case .callerDisallowed(let name, let caller):
      return "Caller '\(caller)' is not allowed to invoke function '\(name)'"
    case .remoteError(let code, let message):
      return "Remote function error (\(code)): \(message)"
    }
  }

  public var errorDescription: String? {
    description
  }
}

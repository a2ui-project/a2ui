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

/// An error that a local function threw while an action ran, reported as an `EXECUTION_ERROR`.
///
/// Its description is the description of the underlying error.
struct ActionExecutionError: Error, CustomStringConvertible, LocalizedError {
  /// The error the function threw.
  let underlying: any Error

  var description: String {
    if let a2uiError = underlying as? any A2UIError {
      return a2uiError.message
    }
    if let description = (underlying as? any LocalizedError)?.errorDescription {
      return description
    }
    return String(describing: underlying)
  }

  var errorDescription: String? {
    description
  }
}

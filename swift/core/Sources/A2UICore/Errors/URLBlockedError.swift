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

/// Thrown when the URL security policy blocks a URL that a function was asked to open or
/// fetch, such as the URL of `openUrl`. Surfaces report it with the code `URL_BLOCKED`.
public struct URLBlockedError: A2UIError, Equatable {
  /// The code surfaces report this error with, `URL_BLOCKED`.
  public static let code = "URL_BLOCKED"

  public let message: String

  /// The name of the function whose URL was blocked, such as `openUrl`.
  public let functionName: String?

  /// Creates the error.
  ///
  /// - Parameters:
  ///   - message: A description that must not include the blocked URL.
  ///   - functionName: The name of the function whose URL was blocked.
  public init(_ message: String, functionName: String? = nil) {
    self.message = message
    self.functionName = functionName
  }
}

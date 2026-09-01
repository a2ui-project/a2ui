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

/// Raised when an A2UI message payload violates formal schema structural boundaries
/// or type constraints.
public struct A2UIValidationError: A2UIError, Equatable, Sendable {
  /// The error message.
  public let message: String

  /// Specific structured diagnostic failure details.
  public let details: [A2UIErrorDetail]

  /// Creates a validation error with an optional list of structured details.
  public init(_ message: String, details: [A2UIErrorDetail] = []) {
    self.message = message
    self.details = details
  }
}

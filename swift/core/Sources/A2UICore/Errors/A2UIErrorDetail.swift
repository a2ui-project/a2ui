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

/// Represents a single structured diagnostic failure detail within an A2UI operation.
public struct A2UIErrorDetail: Sendable, Equatable {
  /// The JSON path or pointer where the failure occurred.
  public let path: String

  /// The standardized error code (e.g. `missing_field`, `type_mismatch`, `invalid_value`).
  public let code: String

  /// A human-readable diagnostic message explaining the specific failure.
  public let message: String

  /// Creates a structured failure detail.
  public init(path: String, code: String, message: String) {
    self.path = path
    self.code = code
    self.message = message
  }
}

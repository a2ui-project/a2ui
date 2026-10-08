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

/// Dynamic validation result returned by a validation function or condition.
public struct ValidationResult: Sendable, Equatable, Codable {
  public let valid: Bool
  public let code: String?
  public let message: String?
  public let severity: ValidationSeverity?

  public init(
    valid: Bool,
    code: String? = nil,
    message: String? = nil,
    severity: ValidationSeverity? = nil
  ) {
    self.valid = valid
    self.code = code
    self.message = message
    self.severity = severity
  }
}

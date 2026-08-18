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

/// A resolved validation check rule with a dynamic condition and failure message.
public struct ResolvedCheck: Resolved, Equatable, Sendable {
  /// The dynamic boolean condition evaluated against the data model.
  public let condition: DataBinding<Bool>

  /// The error message to display if the check condition evaluates to false.
  public let message: String

  public init(condition: DataBinding<Bool>, message: String) {
    self.condition = condition
    self.message = message
  }

  /// Whether the check passed (condition evaluated to true).
  public var isValid: Bool {
    condition.value ?? false
  }

  public static func == (lhs: ResolvedCheck, rhs: ResolvedCheck) -> Bool {
    lhs.condition == rhs.condition && lhs.message == rhs.message
  }
}

extension Node {
  /// All resolved validation checks for this node.
  public var checks: [ResolvedCheck] {
    (properties["checks"] as? [ResolvedCheck]) ?? []
  }

  /// List of active validation error messages (checks that currently fail).
  public var validationErrors: [String] {
    checks.compactMap { $0.isValid ? nil : $0.message }
  }

  /// Whether all validation checks on this node pass.
  public var isValid: Bool {
    checks.allSatisfy { $0.isValid }
  }
}

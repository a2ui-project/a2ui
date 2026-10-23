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

  /// Optional structured validation result from evaluating a v1.0 function or data model path.
  public let validationResult: ValidationResult?

  public init(
    condition: DataBinding<Bool>,
    message: String,
    validationResult: ValidationResult? = nil
  ) {
    self.condition = condition
    self.message = message
    self.validationResult = validationResult
  }

  /// Whether the check passed (condition evaluated to true).
  public var isValid: Bool {
    if let validationResult {
      return validationResult.valid
    }
    return condition.value ?? false
  }

  /// Whether the check failed with blocking `.error` severity.
  public var isBlockingError: Bool {
    guard !isValid else { return false }
    return (validationResult?.severity ?? .error) == .error
  }

  public static func == (lhs: ResolvedCheck, rhs: ResolvedCheck) -> Bool {
    lhs.condition == rhs.condition && lhs.message == rhs.message
      && lhs.validationResult == rhs.validationResult
  }
}

extension Node {
  /// All resolved validation checks for this node found by scanning the node's properties.
  ///
  /// The A2UI specification identifies validation rules by type (`CheckRule` / `Checkable`),
  /// not by property name. This property scans all resolved property values, collecting
  /// `ResolvedCheck` instances from direct properties, arrays, and nested structures.
  public var checks: [ResolvedCheck] {
    properties.values.flatMap(collectChecks)
  }

  private func collectChecks(from value: any Resolved) -> [ResolvedCheck] {
    if let check = value as? ResolvedCheck {
      return [check]
    } else if let checks = value as? [ResolvedCheck] {
      return checks
    } else if let dict = value as? ResolvedDictionary {
      return dict.values.flatMap(collectChecks)
    } else if let arr = value as? ResolvedArray {
      return arr.elements.flatMap(collectChecks)
    }
    return []
  }

  /// List of active blocking validation error messages (checks that fail with `.error` severity).
  public var validationErrors: [String] {
    checks.compactMap { $0.isBlockingError ? $0.message : nil }
  }

  /// Structured validation results for all failing checks (including `.warning` and `.info`).
  public var validationResults: [ValidationResult] {
    checks.compactMap { check in
      guard !check.isValid else { return nil }
      if let result = check.validationResult {
        return ValidationResult(
          valid: result.valid,
          code: result.code,
          message: result.message ?? check.message,
          severity: result.severity ?? .error
        )
      }
      return ValidationResult(
        valid: false,
        code: nil,
        message: check.message,
        severity: .error
      )
    }
  }

  /// Whether all blocking validation checks on this node pass.
  public var isValid: Bool {
    checks.allSatisfy { !$0.isBlockingError }
  }
}

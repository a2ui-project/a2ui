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

  /// Whether the check's condition passed (evaluated to `true` or to a valid result).
  public var passed: Bool {
    if let validationResult {
      return validationResult.valid
    }
    return condition.value ?? false
  }

  /// The severity of a failure of this check.
  ///
  /// A boolean condition, or a `ValidationResult` without a `severity`, defaults to `.error`.
  public var severity: ValidationSeverity {
    validationResult?.severity ?? .error
  }

  /// Whether the check does not block its component.
  ///
  /// Only an `error`-severity failure makes a check invalid. A failure with `warning` or `info`
  /// severity is a non-blocking hint: it appears in ``Node/validationResults`` but not in
  /// ``Node/validationErrors``, and it neither disables a component nor stops its action.
  public var isValid: Bool {
    passed || severity != .error
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

  /// Messages of the `error`-severity checks that currently fail.
  public var validationErrors: [String] {
    checks.compactMap { $0.isValid ? nil : $0.message }
  }

  /// Every check that currently fails, whatever its severity, in check order.
  ///
  /// Each result carries the check's resolved message and its effective severity (`.error`
  /// when none was given), so a renderer can show `warning` and `info` results as
  /// non-blocking hints.
  public var validationResults: [ValidationResult] {
    checks.compactMap { check in
      guard !check.passed else { return nil }
      return ValidationResult(
        valid: false,
        code: check.validationResult?.code,
        message: check.message,
        severity: check.severity
      )
    }
  }

  /// Whether no `error`-severity check on this node fails.
  ///
  /// Failing `warning` and `info` checks do not make the node invalid.
  public var isValid: Bool {
    checks.allSatisfy { $0.isValid }
  }
}

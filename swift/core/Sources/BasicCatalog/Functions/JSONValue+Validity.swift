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

import A2UICore
import JSONSchema

extension JSONValue {
  /// Reads this value as an operand of the v1.0 `and`, `or` and `not` functions.
  ///
  /// In v1.0 the validation functions return a ValidationResult object, so an object that
  /// carries a `valid` key reads as true only when `valid` is `true`. Every other value falls
  /// back to ``isTruthy``, so a value cannot pass as a check and fail as an operand.
  var isTruthyOrValid: Bool {
    guard case .object(let members) = self, let valid = members["valid"] else {
      return isTruthy
    }
    return valid == .boolean(true)
  }

  /// Reads this value as an operand of `and`, `or` or `not`: as ``isTruthyOrValid`` when
  /// `readsValidationResults` is `true`, as in v1.0, and as ``isTruthy`` otherwise.
  func isTruthy(readsValidationResults: Bool) -> Bool {
    readsValidationResults ? isTruthyOrValid : isTruthy
  }
}

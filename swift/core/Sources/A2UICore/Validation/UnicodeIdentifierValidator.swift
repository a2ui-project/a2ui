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

/// Validates Unicode identifiers according to Unicode Standard Annex #31 (UAX #31).
public enum UnicodeIdentifierValidator {
  /// Returns whether a string is a valid UAX #31 identifier (`[\p{L}\p{Nl}_][\p{XID_Continue}]*`).
  public static func isValidIdentifier(_ string: String) -> Bool {
    guard let firstScalar = string.unicodeScalars.first else { return false }
    guard firstScalar.properties.isXIDStart || firstScalar == "_" else { return false }
    for scalar in string.unicodeScalars.dropFirst() {
      guard scalar.properties.isXIDContinue || scalar == "_" else { return false }
    }
    return true
  }

  /// Returns whether a string is a valid A2UI function identifier (`"@index"` or a UAX #31
  /// identifier).
  public static func isValidFunctionIdentifier(_ string: String) -> Bool {
    string == "@index" || isValidIdentifier(string)
  }
}

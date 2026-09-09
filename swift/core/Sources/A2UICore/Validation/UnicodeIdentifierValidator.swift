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
  /// Returns whether a string is a valid UAX #31 identifier (allowing an optional leading '@').
  public static func isValidIdentifier(_ string: String) -> Bool {
    guard !string.isEmpty else { return false }
    let raw = string.hasPrefix("@") ? String(string.dropFirst()) : string
    guard let firstScalar = raw.unicodeScalars.first else { return false }
    guard firstScalar.properties.isXIDStart || firstScalar == "_" else { return false }
    for scalar in raw.unicodeScalars.dropFirst() {
      guard scalar.properties.isXIDContinue else { return false }
    }
    return true
  }
}

// Copyright 2026 Google LLC
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

/// A marker protocol for resolved A2UI types that are safe to pass
/// across threads.
public protocol Resolved: Sendable {
  /// Compares this resolved value with another for structural equality.
  /// - Parameter other: Another resolved value to compare.
  /// - Returns: True if they are structurally equal, false otherwise.
  func isEqual(to other: any Resolved) -> Bool
}

extension Resolved where Self: Equatable {
  /// Default implementation of isEqual(to:) using the type's Equatable
  /// conformance.
  public func isEqual(to other: any Resolved) -> Bool {
    guard let otherResolved = other as? Self else { return false }
    return self == otherResolved
  }
}
